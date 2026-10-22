import { prisma } from "@gitcrook/db";

export interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  icon: string | null;
  isGroup: boolean;
  children: PageTreeNode[];
}

/** Full page tree for a variant's sidebar — small per site, fetched flat and nested in memory. */
export async function getPageTree(variantId: string): Promise<PageTreeNode[]> {
  const pages = await prisma.page.findMany({
    where: { variantId, isDraft: false },
    orderBy: { order: "asc" },
    select: { id: true, parentId: true, title: true, slug: true, icon: true, isGroup: true },
  });

  const byParent = new Map<string | null, typeof pages>();
  for (const page of pages) {
    const list = byParent.get(page.parentId) ?? [];
    list.push(page);
    byParent.set(page.parentId, list);
  }

  function build(parentId: string | null): PageTreeNode[] {
    return (byParent.get(parentId) ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      icon: p.icon,
      isGroup: p.isGroup,
      children: build(p.id),
    }));
  }

  return build(null);
}

/** Flattens the tree in display order for prev/next pagination. */
export function flattenPageTree(nodes: PageTreeNode[]): PageTreeNode[] {
  const out: PageTreeNode[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenPageTree(node.children));
  }
  return out;
}

/**
 * The pages a reader can actually land on, in display order. A group is only a
 * sidebar header: its own URL resolves to its first child, so including it in
 * prev/next made the first page of every group offer "Previous: <its own
 * group>", which led straight back to the page being read.
 */
export function flattenNavigablePages(nodes: PageTreeNode[]): PageTreeNode[] {
  return flattenPageTree(nodes).filter((node) => !node.isGroup);
}

/**
 * `pathsForTree` knows only page slugs. A site with several sections or spaces
 * (or a non-default variant) needs those segments in front of every link, or
 * following a sidebar link 404s / silently leaves the variant being read.
 */
export function prefixPaths(paths: Map<string, string[]>, prefix: string[]): Map<string, string[]> {
  if (prefix.length === 0) return paths;
  return new Map([...paths].map(([id, path]) => [id, [...prefix, ...path]] as const));
}

/**
 * The chain of groups/pages above `pageId`, outermost first, excluding the
 * page itself — GitBook's breadcrumb is this ancestor path, not the
 * section/space the page happens to live in.
 */
export function ancestorsOf(nodes: PageTreeNode[], pageId: string): PageTreeNode[] {
  for (const node of nodes) {
    if (node.id === pageId) return [];
    const below = ancestorsOf(node.children, pageId);
    if (below.length > 0 || node.children.some((c) => c.id === pageId)) return [node, ...below];
  }
  return [];
}

/** Builds each node's full slug path (joined by "/") from the tree root. */
export function pathsForTree(nodes: PageTreeNode[], prefix: string[] = []): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    const path = [...prefix, node.slug];
    map.set(node.id, path);
    for (const [id, childPath] of pathsForTree(node.children, path)) map.set(id, childPath);
  }
  return map;
}
