/** The sidebar's view of a variant's pages, and the helpers that walk it. Pure data in, pure data out. */

/** What the walkers below need of a node. Richer node types (the sidebar's carries icon paths) satisfy it. */
export interface TreeNodeLike {
  id: string;
  slug: string;
  isGroup: boolean;
  children: TreeNodeLike[];
}

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
export function flattenPageTree<N extends TreeNodeLike>(nodes: N[]): N[] {
  const out: N[] = [];
  for (const node of nodes) {
    out.push(node);
    out.push(...flattenPageTree(node.children as N[]));
  }
  return out;
}

/**
 * The pages a reader can actually land on, in display order. A group is only a
 * sidebar header: its own URL resolves to its first child, so including it in
 * prev/next made the first page of every group offer "Previous: <its own
 * group>", which led straight back to the page being read.
 */
export function flattenNavigablePages<N extends TreeNodeLike>(nodes: N[]): N[] {
  return flattenPageTree(nodes).filter((node) => !node.isGroup);
}

/**
 * The chain of groups/pages above `pageId`, outermost first, excluding the
 * page itself — GitBook's breadcrumb is this ancestor path, not the
 * section/space the page happens to live in.
 */
export function ancestorsOf<N extends TreeNodeLike>(nodes: N[], pageId: string): N[] {
  for (const node of nodes) {
    if (node.id === pageId) return [];
    const below = ancestorsOf(node.children as N[], pageId);
    if (below.length > 0 || node.children.some((c) => c.id === pageId)) return [node, ...below];
  }
  return [];
}

/** Builds each node's slug path (without any section/space/variant prefix) from the tree root. */
export function pathsForTree(nodes: readonly TreeNodeLike[], prefix: string[] = []): Map<string, string[]> {
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

/**
 * Finds the page a slug path leads to, the way the server resolves a URL: a group has no content of
 * its own, so landing on one means landing on its first child, and an empty path means the first page
 * a reader can open (skipping groups with nothing in them). Null when nothing matches.
 *
 * The sidebar uses this in the browser to know which page is active from the URL alone, so it must
 * agree with the server's `resolvePageBySlugPath`; an integration test compares the two.
 */
export function resolveTreePath<N extends TreeNodeLike>(tree: N[], slugs: readonly string[]): N | null {
  const firstChild = (node: N) => (node.children[0] as N | undefined) ?? null;
  const settle = (node: N | null): N | null => (node?.isGroup ? firstChild(node) : node);

  if (slugs.length === 0) {
    for (const candidate of tree) {
      const resolved = settle(candidate);
      if (resolved) return resolved;
    }
    return null;
  }

  let level: N[] = tree;
  let node: N | null = null;
  for (const slug of slugs) {
    node = level.find((n) => n.slug === slug) ?? null;
    if (!node) return null;
    level = node.children as N[];
  }
  return settle(node);
}

/** The ids of every node above `id` (not `id` itself), outermost first; empty if it is top-level or unknown. */
export function ancestorIds(tree: TreeNodeLike[], id: string): string[] {
  return ancestorsOf(tree, id).map((n) => n.id);
}
