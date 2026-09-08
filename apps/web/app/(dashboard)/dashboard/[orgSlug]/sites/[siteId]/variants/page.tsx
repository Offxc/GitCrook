import Link from "next/link";
import { prisma } from "@voiddocs/db";
import { getEnv } from "@voiddocs/shared/server";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsTabs } from "../SettingsTabs";
import { CreateVariantForm } from "./CreateVariantForm";

export default async function VariantsPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);
  const env = getEnv();

  const section = await prisma.section.findFirst({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  const space = section && (await prisma.space.findFirst({ where: { sectionId: section.id }, orderBy: { order: "asc" } }));
  const variants = space ? await prisma.variant.findMany({ where: { spaceId: space.id }, orderBy: { order: "asc" } }) : [];

  const publishedBase = site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites/${siteId}`} className="hover:text-ink">
          ← {site.name}
        </Link>
      </p>
      <SettingsTabs orgSlug={orgSlug} siteId={siteId} />
      <h1 className="text-2xl font-semibold text-ink">Variants</h1>
      <p className="mt-1 text-sm text-ink-muted">Parallel versions of this site's content — e.g. v1/v2 of an API, or per-region docs. Visitors switch between them from the published site's header.</p>

      <div className="mt-6 space-y-2">
        {variants.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-lg border border-border bg-canvas px-4 py-3">
            <div>
              <p className="text-sm text-ink">
                {v.name}
                {v.isDefault ? <span className="ml-1.5 text-xs text-ink-muted">(default)</span> : null}
              </p>
              <p className="text-xs text-ink-muted">{v.slug}</p>
            </div>
            <a href={v.isDefault ? publishedBase : `${publishedBase}/~v/${v.slug}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
              View ↗
            </a>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-canvas p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">New variant</h2>
        <CreateVariantForm orgSlug={orgSlug} siteId={siteId} />
      </div>
    </div>
  );
}
