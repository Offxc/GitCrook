import { NextRequest, NextResponse } from "next/server";
import { canUserDoX } from "@gitcrook/auth";
import { requireSite } from "@/lib/dashboard/site";
import { getTopPages, getRecentFeedback, isRangeOption } from "@/lib/analytics/queries";

/** CSV cell — quotes when needed, and neutralizes formula injection (a leading =, +, -, @ is a live formula to Excel/Sheets when it opens visitor-submitted feedback text). */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.viewAnalytics", { type: "site", id: ctx.site.id });
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const rangeParam = req.nextUrl.searchParams.get("range") ?? undefined;
  const range = isRangeOption(rangeParam) ? rangeParam : "30d";

  const [pages, feedback] = await Promise.all([getTopPages(ctx.site.id, range, 200), getRecentFeedback(ctx.site.id, 500)]);

  const pagesCsv = toCsv([
    ["Page", "Path", "Views", "Helpful %", "Rating count"],
    ...pages.map((p) => [p.title, p.path, p.views, p.helpfulPct ?? "", p.ratingCount]),
  ]);
  const feedbackCsv = toCsv([["Page", "Rating", "Feedback", "Submitted at"], ...feedback.map((f) => [f.pageTitle, f.rating === 1 ? "Helpful" : "Not helpful", f.feedback ?? "", f.createdAt.toISOString()])]);

  const csv = `Pages (${range})\r\n${pagesCsv}\r\n\r\nFeedback\r\n${feedbackCsv}\r\n`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.site.slug}-analytics-${range}.csv"`,
    },
  });
}
