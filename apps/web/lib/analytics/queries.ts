import { prisma } from "@voiddocs/db";

export const RANGE_OPTIONS = ["24h", "7d", "30d", "3mo"] as const;
export type RangeOption = (typeof RANGE_OPTIONS)[number];

const RANGE_DAYS: Record<RangeOption, number> = { "24h": 1, "7d": 7, "30d": 30, "3mo": 90 };

export function rangeStart(range: RangeOption): Date {
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000);
}

export function isRangeOption(value: string | undefined): value is RangeOption {
  return !!value && (RANGE_OPTIONS as readonly string[]).includes(value);
}

interface CountRow {
  key: string;
  count: number;
}

/** Groups AnalyticsEvent rows by one dimension and sorts by count desc in JS — Prisma's groupBy orderBy-by-aggregate is awkward for a handful of small, dashboard-sized result sets like these. */
async function topBy(siteId: string, type: "PAGEVIEW" | "SEARCH" | "LINK_CLICK" | "NOT_FOUND", since: Date, field: "country" | "device" | "browser" | "referrer", limit: number): Promise<CountRow[]> {
  const rows = await prisma.analyticsEvent.groupBy({
    by: [field],
    where: { siteId, type, occurredAt: { gte: since } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ key: (r[field] as string | null) ?? "Unknown", count: r._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface TrafficSummary {
  pageviews: number;
  uniqueVisitors: number;
  byCountry: CountRow[];
  byDevice: CountRow[];
  byBrowser: CountRow[];
  byReferrer: CountRow[];
}

export async function getTrafficSummary(siteId: string, range: RangeOption): Promise<TrafficSummary> {
  const since = rangeStart(range);
  const [pageviews, visitorRows, byCountry, byDevice, byBrowser, byReferrer] = await Promise.all([
    prisma.analyticsEvent.count({ where: { siteId, type: "PAGEVIEW", occurredAt: { gte: since } } }),
    prisma.analyticsEvent.groupBy({ by: ["visitorHash"], where: { siteId, type: "PAGEVIEW", occurredAt: { gte: since } } }),
    topBy(siteId, "PAGEVIEW", since, "country", 6),
    topBy(siteId, "PAGEVIEW", since, "device", 6),
    topBy(siteId, "PAGEVIEW", since, "browser", 6),
    topBy(siteId, "PAGEVIEW", since, "referrer", 8),
  ]);
  return { pageviews, uniqueVisitors: visitorRows.length, byCountry, byDevice, byBrowser, byReferrer };
}

export interface TopPageRow {
  pageId: string;
  title: string;
  path: string;
  views: number;
  helpfulPct: number | null;
  ratingCount: number;
}

export async function getTopPages(siteId: string, range: RangeOption, limit = 20): Promise<TopPageRow[]> {
  const since = rangeStart(range);
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["pageId"],
    where: { siteId, type: "PAGEVIEW", occurredAt: { gte: since }, pageId: { not: null } },
    _count: { _all: true },
  });
  const sorted = grouped
    .filter((r): r is typeof r & { pageId: string } => r.pageId !== null)
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, limit);

  const pages = await prisma.page.findMany({ where: { id: { in: sorted.map((r) => r.pageId) } }, select: { id: true, title: true, slug: true } });
  const pageById = new Map(pages.map((p) => [p.id, p]));

  const ratings = await prisma.pageRating.groupBy({
    by: ["pageId", "rating"],
    where: { pageId: { in: sorted.map((r) => r.pageId) } },
    _count: { _all: true },
  });
  const ratingsByPage = new Map<string, { helpful: number; total: number }>();
  for (const r of ratings) {
    const entry = ratingsByPage.get(r.pageId) ?? { helpful: 0, total: 0 };
    entry.total += r._count._all;
    if (r.rating === 1) entry.helpful += r._count._all;
    ratingsByPage.set(r.pageId, entry);
  }

  return sorted.map((r) => {
    const page = pageById.get(r.pageId);
    const rating = ratingsByPage.get(r.pageId);
    return {
      pageId: r.pageId,
      title: page?.title ?? "(deleted page)",
      path: page?.slug ?? "",
      views: r._count._all,
      helpfulPct: rating && rating.total > 0 ? Math.round((rating.helpful / rating.total) * 100) : null,
      ratingCount: rating?.total ?? 0,
    };
  });
}

export interface FeedbackRow {
  id: string;
  pageTitle: string;
  rating: number;
  feedback: string | null;
  createdAt: Date;
}

export async function getRecentFeedback(siteId: string, limit = 50): Promise<FeedbackRow[]> {
  const rows = await prisma.pageRating.findMany({
    where: { page: { siteId }, feedback: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, rating: true, feedback: true, createdAt: true, page: { select: { title: true } } },
  });
  return rows.map((r) => ({ id: r.id, pageTitle: r.page.title, rating: r.rating, feedback: r.feedback, createdAt: r.createdAt }));
}

export async function getTopSearchQueries(siteId: string, range: RangeOption, limit = 20): Promise<CountRow[]> {
  const since = rangeStart(range);
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["query"],
    where: { siteId, type: "SEARCH", occurredAt: { gte: since }, query: { not: null } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ key: r.query ?? "", count: r._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface LinkClickRow {
  linkTarget: string;
  linkPlacement: string;
  count: number;
}

export async function getTopLinkClicks(siteId: string, range: RangeOption, limit = 20): Promise<LinkClickRow[]> {
  const since = rangeStart(range);
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["linkTarget", "linkPlacement"],
    where: { siteId, type: "LINK_CLICK", occurredAt: { gte: since }, linkTarget: { not: null } },
    _count: { _all: true },
  });
  return rows
    .map((r) => ({ linkTarget: r.linkTarget ?? "", linkPlacement: r.linkPlacement ?? "body", count: r._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface BrokenUrlRow {
  path: string;
  count: number;
  lastSeenAt: Date;
  topReferrer: string | null;
}

export async function getBrokenUrls(siteId: string, range: RangeOption, limit = 30): Promise<BrokenUrlRow[]> {
  const since = rangeStart(range);
  const events = await prisma.analyticsEvent.findMany({
    where: { siteId, type: "NOT_FOUND", occurredAt: { gte: since } },
    select: { path: true, occurredAt: true, referrer: true },
    orderBy: { occurredAt: "desc" },
    take: 2000, // bounded scan for a dashboard-sized rollup, not the full table
  });
  const byPath = new Map<string, BrokenUrlRow>();
  for (const e of events) {
    const existing = byPath.get(e.path);
    if (existing) {
      existing.count += 1;
      if (!existing.topReferrer && e.referrer) existing.topReferrer = e.referrer;
    } else {
      byPath.set(e.path, { path: e.path, count: 1, lastSeenAt: e.occurredAt, topReferrer: e.referrer });
    }
  }
  return [...byPath.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
