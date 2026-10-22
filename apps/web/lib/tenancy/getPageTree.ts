import { prisma } from "@gitcrook/db";
import { buildPageTree, type PageTreeNode } from "@gitcrook/shared";

// The tree types and walkers are pure and shared (the sync engine and tests use them too);
// re-exported so reader components keep one import site.
export {
  ancestorsOf,
  buildPageTree,
  flattenNavigablePages,
  flattenPageTree,
  pathsForTree,
  prefixPaths,
  type PageTreeNode,
} from "@gitcrook/shared";

/** Full page tree for a variant's sidebar — small per site, fetched flat and nested in memory. */
export async function getPageTree(variantId: string): Promise<PageTreeNode[]> {
  const pages = await prisma.page.findMany({
    where: { variantId, isDraft: false },
    orderBy: { order: "asc" },
    select: { id: true, parentId: true, title: true, slug: true, icon: true, isGroup: true },
  });
  return buildPageTree(pages);
}
