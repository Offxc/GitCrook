import Link from "next/link";
import { prisma } from "@voiddocs/db";
import { getEnv } from "@voiddocs/shared/server";
import { requireSite } from "@/lib/dashboard/site";
import { DeleteSiteSection } from "./DeleteSiteSection";

export default async function SiteOverviewPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const env = getEnv();

  const publishedBase = site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;

  const [pageCount, sectionCount] = await Promise.all([
    prisma.page.count({ where: { siteId: site.id, isGroup: false } }),
    prisma.section.count({ where: { siteId: site.id } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites`} className="hover:text-ink">
          ← Sites
        </Link>
      </p>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">{site.name}</h1>
        <a href={publishedBase} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
          View site ↗
        </a>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{publishedBase}</p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/domain`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Custom domain</h2>
          <p className="mt-1 text-sm text-ink-muted">{site.customDomain ? site.customDomain.hostname : "Not configured"}</p>
        </Link>
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/theme`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Theme</h2>
          <p className="mt-1 text-sm text-ink-muted">Colors, fonts, layout & more</p>
        </Link>
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/access`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Audience</h2>
          <p className="mt-1 text-sm text-ink-muted capitalize">{site.audienceMode.toLowerCase()}</p>
        </Link>
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/analytics`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Analytics</h2>
          <p className="mt-1 text-sm text-ink-muted">Traffic, search, feedback & more</p>
        </Link>
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/variants`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Variants</h2>
          <p className="mt-1 text-sm text-ink-muted">Parallel versions, e.g. v1/v2</p>
        </Link>
        <Link href={`/dashboard/${orgSlug}/sites/${site.id}/sections`} className="rounded-xl border border-border bg-canvas p-5 transition hover:border-brand">
          <h2 className="text-sm font-medium text-ink">Sections</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {sectionCount} top-level tab{sectionCount === 1 ? "" : "s"}
          </p>
        </Link>
      </div>

      {/* Pages are written, created, reordered and grouped on the site
          itself now (see the live sidebar's Add new / drag-to-reorder), so
          this used to be a second, worse copy of that. What's left is the
          count and a way in. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-canvas p-5">
        <div>
          <h2 className="text-sm font-medium text-ink">Content</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {pageCount} page{pageCount === 1 ? "" : "s"} across {sectionCount} section{sectionCount === 1 ? "" : "s"} — edit them on the site itself.
          </p>
        </div>
        <a href={publishedBase} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90">
          Open site ↗
        </a>
      </div>

      <div className="mt-10">
        <DeleteSiteSection orgSlug={orgSlug} siteId={site.id} siteSlug={site.slug} />
      </div>
    </div>
  );
}
