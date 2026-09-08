import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@voiddocs/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
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
