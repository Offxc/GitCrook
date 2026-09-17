import Link from "next/link";
import { prisma } from "@gitcrook/db";
import { getEnv } from "@gitcrook/shared/server";
import { requireOrgMembership } from "@/lib/dashboard/org";
import { CreateSiteForm } from "./CreateSiteForm";

export default async function SitesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organization } = await requireOrgMembership(orgSlug);
  const env = getEnv();

  const sites = await prisma.site.findMany({
    where: { organizationId: organization.id },
    include: { customDomain: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{organization.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">Sites in this organization.</p>
        </div>
        <Link href={`/dashboard/${orgSlug}/members`} className="text-sm text-brand hover:underline">
          Members
        </Link>
      </div>

      <div className="mt-8 space-y-3">
        {sites.map((site) => {
          const publishedUrl = `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;
          return (
            <Link
              key={site.id}
              href={`/dashboard/${orgSlug}/sites/${site.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-canvas px-5 py-4 transition hover:border-brand"
            >
              <div>
                <p className="text-sm font-medium text-ink">{site.name}</p>
                <p className="text-xs text-ink-muted">
                  {site.customDomain?.status === "ACTIVE" ? site.customDomain.hostname : publishedUrl}
                </p>
              </div>
              <span className="text-xs text-ink-muted">{site.audienceMode.toLowerCase()}</span>
            </Link>
          );
        })}

        {sites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-canvas p-10 text-center">
            <h2 className="text-sm font-medium text-ink">No sites yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Create your first documentation site below.</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-canvas p-5">
        <h2 className="mb-3 text-sm font-medium text-ink">New site</h2>
        <CreateSiteForm orgSlug={orgSlug} />
      </div>
    </div>
  );
}
