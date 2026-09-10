import { prisma, type Section, type Space, type Variant, type Page } from "@voiddocs/db";
import type { ResolvedSite } from "./resolveSite";

export interface VariantOption {
  variant: Variant;
  /** Same page-slug path resolved against this variant, or null when no equivalent page exists (link falls back to the variant's root page). */
  pagePath: string[] | null;
}

export interface ResolvedPath {
  section: Section;
  space: Space;
  variant: Variant;
  page: Page;
  /** All variants of `space`; length 1 when there's nothing to switch between. */
  variantOptions: VariantOption[];
  /** Section/space segments consumed before the `~v` (or page) segment — empty for the common implicit single-section/single-space case. */
  pathPrefix: string[];
  /** Every section on the site, in order — the published header renders these as tabs when there's more than one. Already loaded to resolve the path, so this costs no extra query. */
  sections: Section[];
}

type SectionWithTree = Section & { spaces: (Space & { variants: Variant[] })[] };

async function loadSiteTree(siteId: string): Promise<SectionWithTree[]> {
  return prisma.section.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
    include: {
      spaces: {
        orderBy: { order: "asc" },
        include: { variants: { orderBy: { order: "asc" } } },
      },
    },
  });
}

/**
 * Resolves `{...rest}` in `yourdomain.com/{siteSlug}/{...rest}` against the
 * site's Section -> Space -> Variant -> Page tree, one segment at a time.
 *
 * A level with exactly one child is implicit (no path segment consumed) — a
 * one-section, one-space site (the common case) publishes at exactly
 * `yourdomain.com/{slug}/{page-slug}`, matching GitBook's own simplicity. A
 * site that actually has multiple sections/spaces addresses them explicitly.
 * A literal `~v/{variantSlug}` segment switches to a non-default variant.
 *
 * Returns null on any unresolvable segment (renders as a 404), rather than
 * guessing — an ambiguous path is a content-authoring problem to fix (the
 * site-creation UI prevents slug collisions that would make this ambiguous),
 * not something to paper over here.
 */
export async function resolvePublishedPath(site: ResolvedSite, segments: string[]): Promise<ResolvedPath | null> {
  const sections = await loadSiteTree(site.id);
  if (sections.length === 0) return null;

  let remaining = segments;
  let section = sections[0]!;
  if (sections.length > 1) {
    const match = sections.find((s) => s.slug === remaining[0]);
    if (!match) return null;
    section = match;
    remaining = remaining.slice(1);
  }

  const spaces = section.spaces;
  if (spaces.length === 0) return null;
  let space = spaces[0]!;
  if (spaces.length > 1) {
    const match = spaces.find((s) => s.slug === remaining[0]);
    if (!match) return null;
    space = match;
    remaining = remaining.slice(1);
  }

  const pathPrefix = segments.slice(0, segments.length - remaining.length);

  const variants = space.variants;
  if (variants.length === 0) return null;
  let variant = variants.find((v) => v.isDefault) ?? variants[0]!;
  if (remaining[0] === "~v" && remaining[1]) {
    const match = variants.find((v) => v.slug === remaining[1]);
    if (!match) return null;
    variant = match;
    remaining = remaining.slice(2);
  }

  const page = await resolvePageBySlugPath(variant.id, remaining);
  if (!page) return null;

  const variantOptions: VariantOption[] =
    variants.length <= 1
      ? []
      : await Promise.all(
          variants.map(async (v): Promise<VariantOption> => {
            if (v.id === variant.id) return { variant: v, pagePath: remaining };
            const equivalent = remaining.length === 0 ? null : await resolvePageBySlugPath(v.id, remaining);
            return { variant: v, pagePath: equivalent ? remaining : null };
          }),
        );

  return { section, space, variant, page, variantOptions, pathPrefix, sections };
}

/** Walks a page-slug path (e.g. ["getting-started", "install"]) within one variant; empty path resolves to that variant's root page. */
async function resolvePageBySlugPath(variantId: string, slugPath: string[]): Promise<Page | null> {
  if (slugPath.length === 0) {
    return resolveThroughGroup(
      await prisma.page.findFirst({
        where: { variantId, parentId: null, isDraft: false },
        orderBy: { order: "asc" },
      }),
    );
  }
  let parentId: string | null = null;
  let page: Page | null = null;
  for (const seg of slugPath) {
    const match: Page | null = await prisma.page.findFirst({ where: { variantId, parentId, slug: seg, isDraft: false } });
    if (!match) return null;
    page = match;
    parentId = match.id;
  }
  return resolveThroughGroup(page);
}

/** A page group has no content of its own (see schema.prisma), unlike a regular page with children (which has real content and renders normally even when it also has subpages) — landing on a group's own URL resolves to its first real child instead. Groups can't nest, so this never needs to recurse more than once. */
async function resolveThroughGroup(page: Page | null): Promise<Page | null> {
  if (!page?.isGroup) return page;
  return prisma.page.findFirst({
    where: { variantId: page.variantId, parentId: page.id, isDraft: false },
    orderBy: { order: "asc" },
  });
}
