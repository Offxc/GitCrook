"use server";

import { cookies, headers } from "next/headers";
import { verifySitePassword, signPasswordProof } from "@gitcrook/auth";

export interface PasswordGateState {
  error?: string;
  redirectTo?: string;
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

  const result = await verifySitePassword(siteId, password, visitorKey);
  if (result.rateLimited) return { error: "Too many attempts. Try again in a few minutes." };
  if (!result.ok) return { error: "Incorrect password." };

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
