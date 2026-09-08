import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@voiddocs/db";
import { checkRateLimit } from "@voiddocs/shared/server";
import { getSessionUserId, resolveVisitorAccess } from "@voiddocs/auth";
import { computePagePath } from "@/lib/tenancy/computePagePath";
import { trackEvent } from "@/lib/analytics/track";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

interface SearchRow {
  id: string;
  title: string;
  contentText: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  // Same rule as the page itself: search results are content, and a
  // Private/Password site's content shouldn't be readable through the search
  // box just because it skips the normal page-by-page access check. (Share
  // links aren't threaded through here — a share-link visitor can still
  // browse via the sidebar/direct links, just not search; failing closed
  // rather than open for that one path is the safe tradeoff.)
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ results: [] });
  const [userId, jar] = await Promise.all([getSessionUserId(), cookies()]);
  const access = await resolveVisitorAccess({ site, userId, passwordProofCookie: jar.get(`vd-pw-${site.id}`)?.value, shareLinkToken: undefined });
  if (access.status !== "allow") return NextResponse.json({ results: [] });

  const meta = await readRequestMeta();

  // OWASP A04 — an unauthenticated, DB-hitting endpoint with no limit is a
  // standing invitation to script; generous enough that no real visitor
  // typing a search ever notices it.
  const rl = checkRateLimit(`search:${siteId}:${meta.ip}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ results: [] }, { status: 429 });

  trackEvent({ siteId, type: "SEARCH", path: req.nextUrl.pathname, query: q, ...meta });

  // Tagged-template $queryRaw (never $queryRawUnsafe) — the only raw-SQL path
  // in the app, needed because Postgres FTS operators aren't expressible
  // through Prisma's query builder. `q` is passed as a bound parameter, not
  // interpolated into the SQL string, so this isn't an injection vector.
  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT id, title, "contentText"
    FROM "Page"
    WHERE "siteId" = ${siteId}
      AND "isDraft" = false
      AND "searchVector" @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('english', ${q})) DESC
    LIMIT 10
  `;

  const results = await Promise.all(
    rows.map(async (row) => {
      const path = await computePagePath(row.id);
      return {
        id: row.id,
        title: row.title,
        snippet: row.contentText.slice(0, 140),
        path: path ?? [],
      };
    }),
  );

  return NextResponse.json({ results: results.filter((r) => r.path.length > 0) });
}
