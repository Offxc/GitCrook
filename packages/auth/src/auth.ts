import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@voiddocs/db";
import { getEnv } from "@voiddocs/shared/server";

// trustHost (below) covers most of Auth.js's own host inference, but that
// inference isn't reliably applied to every internal code path in this
// beta release — observed directly: the initial sign-in redirect correctly
// used the real domain, but the callback's token-exchange redirect_uri and
// its error-page redirect both fell back to the container's own hostname
// instead, which breaks the Discord token exchange (redirect_uri mismatch)
// and produces an unreachable error-page URL. Setting AUTH_URL/AUTH_TRUST_HOST
// as actual env vars (not just config fields) removes the dependency on that
// inference working everywhere. Derived from ROOT_DOMAIN/ROOT_PROTOCOL rather
// than a separate .env value so it can't drift out of sync with them.
// Read raw (not via getEnv()) — this runs at module load, and getEnv()'s
// full-schema validation as an import-time side effect broke Next.js's
// build-time page data collection, which doesn't have every var (e.g.
// AUTH_SECRET) available the same way the running server does.
process.env.AUTH_URL = `${process.env.ROOT_PROTOCOL ?? "http"}://${process.env.ROOT_DOMAIN ?? "localhost:3000"}`;
process.env.AUTH_TRUST_HOST = "true";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Safe here specifically because `web` has no published port (see
  // docker-compose.yml) — it's only reachable through Caddy's reverse_proxy,
  // never directly from the internet, so the Host header Auth.js sees can't
  // be spoofed by an outside request. Without this, every request 404s/500s
  // with UntrustedHost since Auth.js has no way to know Caddy is trustworthy.
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  // Database sessions (not JWT) so a compromised session can be revoked
  // server-side by deleting its row — OWASP A07.
  session: { strategy: "database" },
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID,
      clientSecret: process.env.AUTH_DISCORD_SECRET,
      // We only need identity, not ongoing Discord API access — the adapter would
      // otherwise persist the access/refresh token on the Account row. Returning
      // only these three fields means nothing sensitive is ever stored (OWASP A02).
      account(account: Record<string, unknown>) {
        return {
          provider: account.provider as string,
          type: account.type as string,
          providerAccountId: account.providerAccountId as string,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
    // Temporary pre-launch gate — see ALLOWED_DISCORD_IDS's doc comment in
    // packages/shared/src/env.ts. Denying here (rather than in an
    // afterwards check) means a non-allowlisted account never gets a User
    // row created for it at all.
    signIn({ account }) {
      const allowed = getEnv().ALLOWED_DISCORD_IDS;
      if (!allowed) return true;
      const ids = allowed.split(",").map((id) => id.trim());
      return account?.provider === "discord" && ids.includes(account.providerAccountId ?? "");
    },
  },
  events: {
    /** Fires exactly once, right after the adapter inserts a brand-new User row. */
    async createUser({ user }) {
      if (!user.id) return;
      const baseName = (user.name ?? "My").trim() || "My";
      const slug = await generateUniqueOrgSlug(`${baseName}s-docs`);
      await prisma.organization.create({
        data: {
          name: `${baseName}'s Docs`,
          slug,
          memberships: { create: { userId: user.id, role: "ADMIN" } },
        },
      });
    },
  },
});

async function generateUniqueOrgSlug(seed: string): Promise<string> {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "org";
  let candidate = base;
  let suffix = 0;
  // Collisions are rare (personal org names) — a short bounded loop is fine, no
  // need for a fancier allocation scheme.
  while (await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
