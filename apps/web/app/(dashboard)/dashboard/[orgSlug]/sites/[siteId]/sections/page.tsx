import { prisma } from "@voiddocs/db";
import { requireSite } from "@/lib/dashboard/site";
import { SettingsShell } from "../SettingsShell";
import { SectionsManager, type SectionRow } from "./SectionsManager";

export default async function SectionsPage({ params }: { params: Promise<{ orgSlug: string; siteId: string }> }) {
  const { orgSlug, siteId } = await params;
  const { site } = await requireSite(orgSlug, siteId);

  const sections = await prisma.section.findMany({
    where: { siteId: site.id },
    orderBy: { order: "asc" },
    select: { id: true, title: true, slug: true, spaces: { select: { variants: { select: { _count: { select: { pages: true } } } } } } },
  });

  const rows: SectionRow[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    slug: section.slug,
    pageCount: section.spaces.reduce((total, space) => total + space.variants.reduce((n, variant) => n + variant._count.pages, 0), 0),
  }));

  return (
    <SettingsShell
      orgSlug={orgSlug}
      siteId={siteId}
      siteName={site.name}
      active="sections"
      title="Sections"
      description="Top-level divisions of this site — each has its own page tree, and visitors switch between them from a row of tabs under the header. A site with one section doesn't show the tabs at all."
    >
      <SectionsManager orgSlug={orgSlug} siteId={siteId} sections={rows} />
    </SettingsShell>
  );
}
