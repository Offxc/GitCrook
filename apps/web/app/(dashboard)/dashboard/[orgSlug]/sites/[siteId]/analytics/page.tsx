import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsShell } from "../SettingsShell";
import {
  RANGE_OPTIONS,
  isRangeOption,
  getTrafficSummary,
  getTopPages,
  getRecentFeedback,
  getTopSearchQueries,
  getTopLinkClicks,
  getBrokenUrls,
  type RangeOption,
} from "@/lib/analytics/queries";
import { RedirectsSection } from "./RedirectsSection";

const RANGE_LABELS: Record<RangeOption, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "3mo": "3 months" };

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; siteId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { orgSlug, siteId } = await params;
  const { range: rangeParam } = await searchParams;
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.viewAnalytics", { type: "site", id: ctx.site.id });
  if (!allowed) notFound();

  const range: RangeOption = isRangeOption(rangeParam) ? rangeParam : "7d";

  const [traffic, topPages, feedback, searchQueries, linkClicks, brokenUrls, redirects] = await Promise.all([
    getTrafficSummary(ctx.site.id, range),
    getTopPages(ctx.site.id, range),
    getRecentFeedback(ctx.site.id, 20),
    getTopSearchQueries(ctx.site.id, range),
    getTopLinkClicks(ctx.site.id, range),
    getBrokenUrls(ctx.site.id, range),
    prisma.siteRedirect.findMany({ where: { siteId: ctx.site.id }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <SettingsShell orgSlug={orgSlug} siteId={siteId} siteName={ctx.site.name} active="analytics" title="Analytics" wide>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg border border-border p-1 text-sm">
          {RANGE_OPTIONS.map((opt) => (
            <Link
              key={opt}
              href={`/dashboard/${orgSlug}/sites/${siteId}/analytics?range=${opt}`}
              className={`rounded-md px-2.5 py-1 transition ${opt === range ? "bg-brand text-brand-ink" : "text-ink-muted hover:text-ink"}`}
            >
              {RANGE_LABELS[opt]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-6 space-y-6">
        <Section title="Traffic">
          <div className="mb-4 flex gap-6">
            <div>
              <p className="text-2xl font-semibold text-ink">{traffic.pageviews.toLocaleString()}</p>
              <p className="text-xs text-ink-muted">Pageviews</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{traffic.uniqueVisitors.toLocaleString()}</p>
              <p className="text-xs text-ink-muted">Unique visitors</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Breakdown title="Country" rows={traffic.byCountry} />
            <Breakdown title="Device" rows={traffic.byDevice} />
            <Breakdown title="Browser" rows={traffic.byBrowser} />
            <Breakdown title="Referrer" rows={traffic.byReferrer} />
          </div>
        </Section>

        <Section title="Pages & feedback" action={<a href={`/dashboard/${orgSlug}/sites/${siteId}/analytics/export?range=${range}`} className="text-xs text-brand hover:underline">Export CSV</a>}>
          {topPages.length === 0 ? (
            <EmptyState label="No pageviews yet in this range." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="pb-2 font-normal">Page</th>
                  <th className="pb-2 font-normal">Views</th>
                  <th className="pb-2 font-normal">Helpful</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((p) => (
                  <tr key={p.pageId} className="border-b border-border last:border-0">
                    <td className="py-1.5 text-ink">{p.title}</td>
                    <td className="py-1.5 text-ink-muted">{p.views}</td>
                    <td className="py-1.5 text-ink-muted">{p.helpfulPct !== null ? `${p.helpfulPct}% (${p.ratingCount})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {feedback.length > 0 ? (
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-ink-muted">Recent written feedback</p>
              {feedback.map((f) => (
                <div key={f.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="text-xs text-ink-muted">
                    {f.pageTitle} · {f.rating === 1 ? "👍" : "👎"} · {f.createdAt.toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-ink">{f.feedback}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Section>

        <Section title="Search">
          {searchQueries.length === 0 ? (
            <EmptyState label="No searches yet in this range." />
          ) : (
            <ul className="space-y-1.5">
              {searchQueries.map((q) => (
                <li key={q.key} className="flex items-center justify-between text-sm">
                  <span className="text-ink">{q.key}</span>
                  <span className="text-ink-muted">{q.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Links">
          {linkClicks.length === 0 ? (
            <EmptyState label="No outbound clicks tracked yet in this range." />
          ) : (
            <ul className="space-y-1.5">
              {linkClicks.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-ink">{l.linkTarget}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {l.linkPlacement} · {l.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Broken URLs & redirects">
          {brokenUrls.length > 0 ? (
            <ul className="mb-4 space-y-1.5">
              {brokenUrls.map((u) => (
                <li key={u.path} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-mono text-xs text-ink">/{u.path}</span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {u.count} hit{u.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-ink-muted">No 404s in this range.</p>
          )}
          <RedirectsSection orgSlug={orgSlug} siteId={siteId} redirects={redirects} prefillFrom={brokenUrls[0]?.path} />
        </Section>
      </div>
    </SettingsShell>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-canvas p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-muted">—</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between text-xs">
              <span className="min-w-0 truncate text-ink">{r.key}</span>
              <span className="shrink-0 text-ink-muted">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-sm text-ink-muted">{label}</p>;
}
