import { cache } from "react";
import { prisma } from "@gitcrook/db";
import { buildPageTree, type PageTreeNode } from "@gitcrook/shared";
import { findPageIcon } from "@/lib/editor/pageIcons";
import type { ShellNode, ShellSection } from "./siteLocation";

const iconPathsFor = (slug: string | null): string[] | null => (slug ? (findPageIcon(slug)?.paths ?? null) : null);

function toShellNodes(nodes: PageTreeNode[]): ShellNode[] {
  return nodes.map((n) => ({
    id: n.id,
    title: n.title,
    slug: n.slug,
    icon: n.icon,
    iconPaths: iconPathsFor(n.icon),
    isGroup: n.isGroup,
    children: toShellNodes(n.children),
  }));
}

/**
 * A site's whole navigable structure — every section, space, variant and each variant's page tree —
 * loaded once for the layout. It is what lets the shell stay mounted across navigations: the browser
 * works out the active section, variant and page from the URL against this, so a click does not
 * have to re-fetch or rebuild any of it. Two queries however many pages there are. Memoised per request.
 *
 * Icons are resolved to SVG path data here so that no client component imports the icon table (it is
 * ~600 KB of source and used to ship to every reader).
 */
export const loadShellStructure = cache(async (siteId: string): Promise<ShellSection[]> => {
  const [sections, pages] = await Promise.all([
    prisma.section.findMany({
      where: { siteId },
      orderBy: { order: "asc" },
      include: { spaces: { orderBy: { order: "asc" }, include: { variants: { orderBy: { order: "asc" } } } } },
    }),
    prisma.page.findMany({
      // Hidden pages are published but not in the navigation; pages whose file left a repository are gone.
      where: { siteId, isDraft: false, deletedAt: null, isHidden: false },
      orderBy: { order: "asc" },
      select: { id: true, variantId: true, parentId: true, title: true, slug: true, icon: true, isGroup: true },
    }),
  ]);

  const byVariant = new Map<string, typeof pages>();
  for (const page of pages) {
    const list = byVariant.get(page.variantId) ?? [];
    list.push(page);
    byVariant.set(page.variantId, list);
  }

  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    slug: section.slug,
    icon: section.icon,
    iconPaths: iconPathsFor(section.icon),
    spaces: section.spaces.map((space) => ({
      id: space.id,
      title: space.title,
      slug: space.slug,
      variants: space.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        slug: variant.slug,
        isDefault: variant.isDefault,
        tree: toShellNodes(buildPageTree(byVariant.get(variant.id) ?? [])),
      })),
    })),
  }));
});
