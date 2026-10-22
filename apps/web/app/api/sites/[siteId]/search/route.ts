import { NextRequest, NextResponse } from "next/server";
import { computePagePaths, prisma } from "@gitcrook/db";
import { checkRateLimit } from "@gitcrook/shared/server";
import { getVisitorAccess } from "@/lib/tenancy/visitorAccess";
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
  // box just because it skips the normal page-by-page access check.
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ results: [] });
  const access = await getVisitorAccess(site);
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

  const paths = await computePagePaths(rows.map((row) => row.id));
  const results = rows
    .map((row) => ({ id: row.id, title: row.title, snippet: row.contentText.slice(0, 140), path: paths.get(row.id) ?? [] }))
    .filter((r) => r.path.length > 0);

  return NextResponse.json({ results });
}
