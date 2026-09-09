import { prisma } from "@voiddocs/db";

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
