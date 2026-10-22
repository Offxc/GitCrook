import { cache } from "react";
import { cookies } from "next/headers";
import type { AudienceMode } from "@gitcrook/db";
import { getSessionUserId, resolveVisitorAccess, type VisitorAccessResult } from "@gitcrook/auth";
import { SHARE_COOKIE, parseShareCookie } from "@gitcrook/shared";

/** The signed-in user for this request, or null. Memoised per request, so a layout and its page ask the database once. */
export const getViewerId = cache(async (): Promise<string | null> => getSessionUserId());

/**
 * Whether the current request may see `site`: the one place that gathers everything the decision
 * needs (the session, the password-proof cookie, the share-link cookie) so that pages, API routes
 * and server actions can't each assemble it slightly differently, which is how a share link ended up
 * working for one page only.
 *
 * Memoised per request by site object, so the layout, the page and `generateMetadata` of one request
 * share a single answer. Route handlers aren't deduplicated, which is fine: each makes one call.
 */
export const getVisitorAccess = cache(async (site: { id: string; audienceMode: AudienceMode }): Promise<VisitorAccessResult> => {
  const [userId, jar] = await Promise.all([getViewerId(), cookies()]);
  return resolveVisitorAccess({
    site,
    userId,
    passwordProofCookie: jar.get(`vd-pw-${site.id}`)?.value,
    shareLinkTokens: parseShareCookie(jar.get(SHARE_COOKIE)?.value),
  });
});
