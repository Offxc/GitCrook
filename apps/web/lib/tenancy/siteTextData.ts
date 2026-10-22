import { prisma } from "@gitcrook/db";
import { basePrefix, buildPageTree, flattenNavigablePages, pathsForTree, type PageTreeNode } from "@gitcrook/shared";
import { sitePublishedUrl } from "@gitcrook/shared/server";
import { blocksToMarkdown } from "@/lib/renderer/toMarkdown";
import { markdownUrl, renderLlmsFull, renderLlmsIndex, renderPageMarkdown, type FullPage, type IndexEntry, type IndexSection } from "./siteText";
import { resolvePublishedPath } from "./resolvePublishedPath";
import type { ResolvedSite } from "./resolveSite";

/**
 * What a text reader is shown of a site: the navigable pages of each space's default variant, in the sidebar's order.
 * Drafts, deleted pages and pages marked hidden are left out of the listings exactly as they are left out of the
 * sidebar; a hidden page can still be fetched by its own address, as it can be opened in a browser.
 */

/** `llms-full.txt` stops before this many characters. */
export const MAX_FULL_TEXT_CHARS = 2_000_000;
const BATCH = 25;

interface Listing {
  heading: string | null;
  prefix: string[];
  tree: PageTreeNode[];
}

async function baseUrlOf(site: ResolvedSite): Promise<string> {
  const customDomain = await prisma.customDomain.findFirst({ where: { siteId: site.id, status: "ACTIVE" }, select: { hostname: true, status: true } });
  return sitePublishedUrl({ slug: site.slug, customDomain });
}

async function loadListings(siteId: string): Promise<{ listings: Listing[]; descriptions: Map<string, string | null> }> {
  const sections = await prisma.section.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
    include: { spaces: { orderBy: { order: "asc" }, include: { variants: { orderBy: { order: "asc" } } } } },
  });

  const chosen: { variantId: string; heading: string | null; prefix: string[] }[] = [];
  for (const section of sections) {
    for (const space of section.spaces) {
      const variant = space.variants.find((v) => v.isDefault) ?? space.variants[0];
      if (!variant) continue;
      const heading = [sections.length > 1 ? section.title : null, section.spaces.length > 1 ? space.title : null].filter(Boolean).join(" — ") || null;
      chosen.push({ variantId: variant.id, heading, prefix: basePrefix({ sections: sections.length, spacesInSection: section.spaces.length }, section, space) });
    }
  }

  const pages = chosen.length
    ? await prisma.page.findMany({
        where: { variantId: { in: chosen.map((c) => c.variantId) }, isDraft: false, deletedAt: null, isHidden: false },
        orderBy: { order: "asc" },
        select: { id: true, variantId: true, parentId: true, title: true, slug: true, icon: true, isGroup: true, description: true },
      })
    : [];

  return {
    listings: chosen.map((c) => ({ heading: c.heading, prefix: c.prefix, tree: buildPageTree(pages.filter((p) => p.variantId === c.variantId)) })),
    descriptions: new Map(pages.map((p) => [p.id, p.description])),
  };
}

/** `llms.txt` */
export async function loadLlmsIndex(site: ResolvedSite): Promise<string> {
  const [base, { listings, descriptions }] = await Promise.all([baseUrlOf(site), loadListings(site.id)]);

  const entryOf = (node: PageTreeNode, paths: Map<string, string[]>): IndexEntry => ({
    title: node.title,
    description: descriptions.get(node.id) ?? null,
    url: node.isGroup ? null : markdownUrl(base, paths.get(node.id)!),
    children: node.children.map((child) => entryOf(child, paths)),
  });

  const sections: IndexSection[] = listings.map((l) => {
    const paths = pathsForTree(l.tree, l.prefix);
    return { heading: l.heading, entries: l.tree.map((node) => entryOf(node, paths)) };
  });
  return renderLlmsIndex({ siteName: site.name, sections });
}

/** `llms-full.txt` */
export async function loadLlmsFull(site: ResolvedSite): Promise<string> {
  const [base, { listings, descriptions }] = await Promise.all([baseUrlOf(site), loadListings(site.id)]);

  const ordered: { id: string; title: string; url: string }[] = [];
  for (const l of listings) {
    const paths = pathsForTree(l.tree, l.prefix);
    for (const node of flattenNavigablePages(l.tree)) ordered.push({ id: node.id, title: node.title, url: markdownUrl(base, paths.get(node.id)!) });
  }

  // Read the pages a few at a time and stop once there is enough: a large site's content is never all in memory.
  const pages: FullPage[] = [];
  let size = 0;
  for (let i = 0; i < ordered.length && size < MAX_FULL_TEXT_CHARS; i += BATCH) {
    const batch = ordered.slice(i, i + BATCH);
    const rows = await prisma.page.findMany({ where: { id: { in: batch.map((p) => p.id) } }, select: { id: true, content: true } });
    const content = new Map(rows.map((r) => [r.id, r.content]));
    for (const entry of batch) {
      const markdown = renderPageMarkdown({ title: entry.title, description: descriptions.get(entry.id) ?? null, body: blocksToMarkdown(content.get(entry.id) ?? []) });
      pages.push({ title: entry.title, url: entry.url, markdown });
      size += markdown.length;
      if (size >= MAX_FULL_TEXT_CHARS) break;
    }
  }

  return renderLlmsFull({ siteName: site.name, pages, totalPages: ordered.length, maxChars: MAX_FULL_TEXT_CHARS, indexUrl: `${base}/llms.txt` });
}

/** One page, by the slug path a browser would use. Null when it does not exist or is not published. */
export async function loadPageMarkdown(site: ResolvedSite, segments: string[]): Promise<string | null> {
  const resolved = await resolvePublishedPath(site, segments);
  if (!resolved) return null;
  const { page } = resolved;
  return renderPageMarkdown({ title: page.title, description: page.description, body: blocksToMarkdown(page.content) });
}
