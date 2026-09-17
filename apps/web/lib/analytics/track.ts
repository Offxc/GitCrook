import { after } from "next/server";
import { createHash } from "node:crypto";
import { prisma, type AnalyticsEventType } from "@gitcrook/db";

/**
 * Rotates daily so a visitorHash can't be correlated across days (no
 * persistent cross-session tracking), while same-day pageviews from one
 * visitor still collapse into one "unique visitor" for that day — matches
 * the schema's own comment: sha256(dailySalt + siteId + ip + userAgent).
 */
function dailySalt(): string {
  const day = new Date().toISOString().slice(0, 10);
  return `gitcrook-analytics-salt:${day}`;
}

export function computeVisitorHash(siteId: string, ip: string, userAgent: string): string {
  return createHash("sha256").update(`${dailySalt()}:${siteId}:${ip}:${userAgent}`).digest("hex");
}

function parseDevice(userAgent: string): string {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|iphone|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function parseBrowser(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) return "Chrome";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return "Safari";
  return "Other";
}

export interface TrackEventInput {
  siteId: string;
  type: AnalyticsEventType;
  pageId?: string | null;
  path: string;
  ip: string;
  userAgent: string;
  acceptLanguage?: string | null;
  referrer?: string | null;
  country?: string | null;
  query?: string | null;
  linkTarget?: string | null;
  linkPlacement?: string | null;
}

/**
 * Fire-and-forget, via Next's `after()` so it never adds latency to the
 * actual page response. Must be called with request data already read (not
 * inside a closure that calls headers()/cookies() itself — Server Components
 * can't use those inside `after`, per Next's docs) and BEFORE any
 * notFound()/redirect() in the caller — `after` still runs in that case,
 * which is exactly what NOT_FOUND tracking needs.
 */
export function trackEvent(input: TrackEventInput): void {
  after(async () => {
    try {
      await prisma.analyticsEvent.create({
        data: {
          siteId: input.siteId,
          type: input.type,
          pageId: input.pageId ?? null,
          path: input.path,
          country: input.country ?? null,
          language: input.acceptLanguage?.split(",")[0]?.split(";")[0]?.trim() ?? null,
          browser: parseBrowser(input.userAgent),
          device: parseDevice(input.userAgent),
          referrer: input.referrer ?? null,
          query: input.query ?? null,
          linkTarget: input.linkTarget ?? null,
          linkPlacement: input.linkPlacement ?? null,
          visitorHash: computeVisitorHash(input.siteId, input.ip, input.userAgent),
        },
      });
    } catch {
      // Analytics must never break the actual page or API response.
    }
  });
}
