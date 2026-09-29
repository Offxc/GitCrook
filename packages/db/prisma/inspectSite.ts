/**
 * Read-only diagnostic: lists every section/space/variant under a site and
 * the pages each variant currently holds. No content, safe to commit.
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/inspectSite.ts <siteSlug>
 */
import { prisma } from "../src/client";

async function main() {
  const siteSlug = process.argv[2];
  if (!siteSlug) throw new Error("Usage: tsx prisma/inspectSite.ts <siteSlug>");

  const site = await prisma.site.findUnique({ where: { slug: siteSlug } });
  if (!site) throw new Error(`No site with slug "${siteSlug}"`);
  console.log(`Site: ${site.name} (${site.id}), slug="${site.slug}"`);

  const sections = await prisma.section.findMany({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  for (const section of sections) {
    console.log(`\nSection: "${section.title}" (${section.id}) slug=${section.slug} order=${section.order}`);
    const spaces = await prisma.space.findMany({ where: { sectionId: section.id }, orderBy: { order: "asc" } });
    for (const space of spaces) {
      console.log(`  Space: "${space.title}" (${space.id}) slug=${space.slug} order=${space.order}`);
      const variants = await prisma.variant.findMany({ where: { spaceId: space.id }, orderBy: { order: "asc" } });
      for (const variant of variants) {
        console.log(`    Variant: "${variant.name}" (${variant.id}) slug=${variant.slug} isDefault=${variant.isDefault}`);
        const pages = await prisma.page.findMany({
          where: { variantId: variant.id },
          orderBy: [{ parentId: "asc" }, { order: "asc" }],
          select: { id: true, title: true, slug: true, parentId: true, isGroup: true },
        });
        if (pages.length === 0) {
          console.log("      (no pages)");
        }
        for (const p of pages) {
          console.log(`      ${p.isGroup ? "[group]" : "       "} "${p.title}" (${p.id}) slug=${p.slug} parentId=${p.parentId ?? "null"}`);
        }
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
