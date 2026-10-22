import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { prisma, type AudienceMode } from "@gitcrook/db";
import { getEnv, checkRateLimit } from "@gitcrook/shared/server";
import { canUserDoX } from "./rbac";

/**
 * Anonymous doc-site *visitors* (as opposed to signed-in org members) never
 * have a userId — this is deliberately a separate function from rbac.ts's
 * canUserDoX so a null userId can never accidentally fall through into an
 * "allow" branch meant for members (see rbac.ts's own doc comment, which
 * named this exact function before it existed).
 */
export type VisitorAccessResult = { status: "allow" } | { status: "passwordRequired" } | { status: "denied" };

const PASSWORD_PROOF_TTL_MS = 1000 * 60 * 60 * 24 * 7; // a week — re-prompting every page load defeats the point of a password gate

export async function resolveVisitorAccess(params: {
  site: { id: string; audienceMode: AudienceMode };
  userId: string | null;
  passwordProofCookie: string | undefined;
  shareLinkToken: string | undefined;
}): Promise<VisitorAccessResult> {
  const { site, userId, passwordProofCookie, shareLinkToken } = params;

  if (site.audienceMode === "PUBLIC") return { status: "allow" };

  if (shareLinkToken && (await isShareLinkValid(site.id, shareLinkToken))) return { status: "allow" };

  if (userId && (await canUserDoX(userId, "content.view", { type: "site", id: site.id }))) return { status: "allow" };

  if (site.audienceMode === "PASSWORD") {
    // The proof is bound to the password's current version, so changing the password
    // (or the audience) signs everyone out; a site with no password set can't be proven.
    const record = passwordProofCookie ? await prisma.sitePassword.findUnique({ where: { siteId: site.id }, select: { version: true } }) : null;
    if (record && verifyPasswordProof(site.id, record.version, passwordProofCookie)) return { status: "allow" };
    return { status: "passwordRequired" };
  }

  return { status: "denied" };
}

async function isShareLinkValid(siteId: string, token: string): Promise<boolean> {
  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || link.siteId !== siteId) return false;
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt < new Date()) return false;
  return true;
}

// ----------------------------------------------------------------------
// Site password: argon2id hash at rest, HMAC-signed proof cookie so a
// correct password isn't re-checked (and re-hashed — argon2 is deliberately
// slow) on every single page navigation within the same visit.
// ----------------------------------------------------------------------

export async function hashSitePassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { type: argon2.argon2id });
}

const PASSWORD_ATTEMPT_LIMIT = 10;
const PASSWORD_ATTEMPT_WINDOW_MS = 1000 * 60 * 15;

/** Rate-limited by visitorKey (caller supplies the requester's IP or similar) — never by siteId alone, or one visitor could lock out every other visitor to the same site. */
export async function verifySitePassword(
  siteId: string,
  plaintext: string,
  visitorKey: string,
): Promise<{ ok: boolean; rateLimited: boolean; version: number }> {
  const rl = checkRateLimit(`password-gate:${siteId}:${visitorKey}`, PASSWORD_ATTEMPT_LIMIT, PASSWORD_ATTEMPT_WINDOW_MS);
  if (!rl.allowed) return { ok: false, rateLimited: true, version: 0 };

  const record = await prisma.sitePassword.findUnique({ where: { siteId } });
  if (!record) return { ok: false, rateLimited: false, version: 0 };

  const ok = await argon2.verify(record.passwordHash, plaintext).catch(() => false);
  return { ok, rateLimited: false, version: record.version };
}

function proofSecret(): Buffer {
  return createHash("sha256").update(`gitcrook-password-proof:${getEnv().AUTH_SECRET}`).digest();
}

/**
 * `{expiryMs}.{hmac(siteId + version + expiryMs)}` — an opaque bearer token, not a JWT (no
 * need for the extra format/library for one signed field). `version` is the site password's
 * current version, so a token issued before a password or audience change no longer verifies.
 */
export function signPasswordProof(siteId: string, version: number): string {
  const expiry = Date.now() + PASSWORD_PROOF_TTL_MS;
  const signature = createHmac("sha256", proofSecret()).update(`${siteId}.${version}.${expiry}`).digest("base64url");
  return `${expiry}.${signature}`;
}

export function verifyPasswordProof(siteId: string, version: number, token: string | undefined): boolean {
  if (!token) return false;
  const [expiryStr, signature] = token.split(".");
  if (!expiryStr || !signature) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = createHmac("sha256", proofSecret()).update(`${siteId}.${version}.${expiry}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
