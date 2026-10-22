import { basePrefix, variantSegments } from "@gitcrook/shared";
import { prisma } from "./client";

interface PageRow {
  id: string;
  parentId: string | null;
  slug: string;
  variantId: string;
}

/**
 * Inverse of `matchStructure` (packages/shared): the URL path segments that reach each page.
 * A page's computed path must always resolve back to that same page, so the prefix rules come from
 * the shared module rather than being restated here.
 *
 * One implementation for the web app, the worker and the sync engine. It is batched: the number of
 * queries depends on how many *sites* are involved, not on how many pages or how deep they nest, so
 * search results and feeds don't pay a handful of queries per item.
 */
export async function computePagePaths(pageIds: readonly string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (pageIds.length === 0) return result;

  const wanted = await prisma.page.findMany({
    where: { id: { in: [...new Set(pageIds)] } },
    select: { id: true, parentId: true, slug: true, variantId: true },
  });
  if (wanted.length === 0) return result;

  // Ancestors are always in the same variant, so one query for the variants involved gives every
  // slug chain without walking parent by parent.
  const variantIds = [...new Set(wanted.map((p) => p.variantId))];
  const siblings: PageRow[] = await prisma.page.findMany({
    where: { variantId: { in: variantIds } },
    select: { id: true, parentId: true, slug: true, variantId: true },
  });
  const byId = new Map(siblings.map((p) => [p.id, p]));

  const variants = await prisma.variant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      slug: true,
      isDefault: true,
      space: {
        select: {
          id: true,
          slug: true,
          section: { select: { id: true, slug: true, siteId: true, spaces: { select: { id: true } } } },
        },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const siteIds = [...new Set(variants.map((v) => v.space.section.siteId))];
  const sectionCounts = new Map<string, number>();
  for (const row of await prisma.section.groupBy({ by: ["siteId"], where: { siteId: { in: siteIds } }, _count: { _all: true } })) {
    sectionCounts.set(row.siteId, row._count._all);
  }

  for (const page of wanted) {
    const variant = variantById.get(page.variantId);
    if (!variant) continue;

    const slugs: string[] = [];
    let cursor: PageRow | undefined = page;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      slugs.unshift(cursor.slug);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    const { section, ...space } = variant.space;
    const sectionCount = sectionCounts.get(section.siteId) ?? 1;
    result.set(page.id, [
      ...basePrefix({ sections: sectionCount, spacesInSection: section.spaces.length }, section, space),
      ...variantSegments(variant),
      ...slugs,
    ]);
  }

  return result;
}

/** Single-page convenience over `computePagePaths`. Null when the page no longer exists. */
export async function computePagePath(pageId: string): Promise<string[] | null> {
  return (await computePagePaths([pageId])).get(pageId) ?? null;
}
