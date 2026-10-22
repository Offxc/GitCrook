/** The sidebar's view of a variant's pages, and the helpers that walk it. Pure data in, pure data out. */

export interface PageTreeNode {
  id: string;
  title: string;
  slug: string;
  icon: string | null;
  isGroup: boolean;
  children: PageTreeNode[];
}

export interface PageTreeRow {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
  isGroup: boolean;
}

/** Nests flat rows. The rows must already be in display order; siblings keep that order. */
export function buildPageTree(rows: readonly PageTreeRow[]): PageTreeNode[] {
  const byParent = new Map<string | null, PageTreeRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  // `seen` guards against a parent cycle in corrupt data: without it a loop would recurse forever.
  const seen = new Set<string>();
  function build(parentId: string | null): PageTreeNode[] {
    const out: PageTreeNode[] = [];
    for (const p of byParent.get(parentId) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, title: p.title, slug: p.slug, icon: p.icon, isGroup: p.isGroup, children: build(p.id) });
    }
    return out;
  }

  return build(null);
}

/** Flattens the tree in display order. */
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

/** Builds each node's slug path (without any section/space/variant prefix) from the tree root. */
export function pathsForTree(nodes: PageTreeNode[], prefix: string[] = []): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    const path = [...prefix, node.slug];
    map.set(node.id, path);
    for (const [id, childPath] of pathsForTree(node.children, path)) map.set(id, childPath);
  }
  return map;
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
