import Link from "next/link";
import { prisma } from "@voiddocs/db";
import { getEnv } from "@voiddocs/shared/server";
import { requireSite } from "@/lib/dashboard/site";
import { NewPageForm } from "./NewPageForm";

export default async function SiteOverviewPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const env = getEnv();

  const publishedBase = site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;

  const pages = await prisma.page.findMany({
    where: { siteId: site.id },
    orderBy: { order: "asc" },
    select: { id: true, title: true, slug: true },
  });

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
      </div>

      <h2 className="mt-8 text-sm font-medium text-ink">Pages</h2>
      <div className="mt-3 space-y-2">
        {pages.map((page) => (
          <div key={page.id} className="flex items-center justify-between rounded-lg border border-border bg-canvas px-4 py-3 transition hover:border-brand">
            <Link href={`/dashboard/${orgSlug}/sites/${site.id}/pages/${page.id}`} className="text-sm text-ink">
              {page.title}
            </Link>
            <a href={`${publishedBase}/${page.slug}`} target="_blank" rel="noreferrer" className="text-xs text-ink-muted hover:text-brand">
              View ↗
            </a>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <NewPageForm orgSlug={orgSlug} siteId={site.id} />
      </div>
    </div>
  );
}
