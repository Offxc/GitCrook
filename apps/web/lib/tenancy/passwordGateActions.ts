"use server";

import { cookies, headers } from "next/headers";
import { prisma } from "@gitcrook/db";
import { verifySitePassword, signPasswordProof } from "@gitcrook/auth";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

export interface PasswordGateState {
  error?: string;
  redirectTo?: string;
}

/** Password-gate attempts carry a real, readable IP (unlike the rest of this app's
 * analytics, which only ever keep a one-way daily-rotating hash) — this is the one
 * place the site owner explicitly wants to see who's been knocking on a password-
 * protected site and from where. Logged to AuditLog (actorId null: the visitor isn't
 * a member) rather than a dedicated table, reusing its existing ipAddress column and
 * metadata for country/result; see lib/analytics/passwordLog.ts for the 90-day
 * lazy-expiry read side. */
async function logPasswordAttempt(siteId: string, result: "success" | "failure" | "rateLimited") {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { organizationId: true } });
  if (!site) return;
  const meta = await readRequestMeta();
  await prisma.auditLog.create({
    data: {
      organizationId: site.organizationId,
      action: "site.passwordGateAttempt",
      targetType: "site",
      targetId: siteId,
      ipAddress: meta.ip,
      metadata: { result, country: meta.country },
    },
  });
}

const PROOF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Visitor-facing (anonymous) — deliberately separate from the dashboard's
 * member Server Actions (no requireSite/canUserDoX here, no session
 * required at all). Rate-limited per (site, requester) so one guesser can't
 * lock other visitors out of the same site's password gate.
 */
export async function submitSitePassword(siteId: string, _prev: PasswordGateState, formData: FormData): Promise<PasswordGateState> {
  const password = formData.get("password");
  const redirectTo = formData.get("redirectTo");
  if (typeof password !== "string" || !password) return { error: "Enter the password." };
  const target = typeof redirectTo === "string" && redirectTo.startsWith("/") ? redirectTo : "/";

  const forwardedFor = (await headers()).get("x-forwarded-for");
  const visitorKey = forwardedFor?.split(",")[0]?.trim() || "unknown";

  const verification = await verifySitePassword(siteId, password, visitorKey);
  if (verification.rateLimited) {
    await logPasswordAttempt(siteId, "rateLimited");
    return { error: "Too many attempts. Try again in a few minutes." };
  }
  if (!verification.ok) {
    await logPasswordAttempt(siteId, "failure");
    return { error: "Incorrect password." };
  }
  await logPasswordAttempt(siteId, "success");

  const jar = await cookies();
  jar.set(`vd-pw-${siteId}`, signPasswordProof(siteId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PROOF_COOKIE_MAX_AGE_SECONDS,
  });

  // See sites/actions.ts's createSite for why this returns a URL instead of
  // calling redirect() — this exact symptom (404 on first hit, fine on a
  // manual reload) is what led to finding that pattern in the first place.
  return { redirectTo: target };
}
