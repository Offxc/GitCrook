import { matchStructure, prefixPaths, pathsForTree, resolveTreePath, variantSegments } from "@gitcrook/shared";

/**
 * What the reader shell knows about a site: sections → spaces → variants → page trees, as plain data.
 * Everything here is serialisable and import-free of server code, so the same module runs when the
 * layout builds it and when the browser reads the active location out of it.
 */

export interface ShellNode {
  id: string;
  title: string;
  slug: string;
  /** The stored slug (what the icon picker needs to show a selection). */
  icon: string | null;
  /** SVG path data for `icon`, resolved on the server so no client component has to ship the icon table. Null for an unknown/legacy icon. */
  iconPaths: string[] | null;
  isGroup: boolean;
  children: ShellNode[];
}

export interface ShellVariant {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  tree: ShellNode[];
}

export interface ShellSpace {
  id: string;
  title: string;
  slug: string;
  variants: ShellVariant[];
}

export interface ShellSection {
  id: string;
  title: string;
  slug: string;
  icon: string | null;
  iconPaths: string[] | null;
  spaces: ShellSpace[];
}

export interface SiteLocation {
  section: ShellSection;
  space: ShellSpace;
  variant: ShellVariant;
  /** Section and space segments (the part of the URL before `~v`/the page). */
  base: string[];
  /** `base` plus `~v/<slug>` for a non-default variant: what every link into this variant starts with. */
  prefix: string[];
  /** The page-slug part of the URL. */
  rest: string[];
  /** The page being read, or null on a URL that names none (a 404 inside the site, say). */
  activeNode: ShellNode | null;
  /** Whether the URL named a real section/space/variant. False means this is the fallback. */
  matched: boolean;
}

/** The URL's path segments below the site's own base path, decoded. */
export function segmentsFromPathname(pathname: string, baseHref: string): string[] {
  const below = baseHref && pathname.startsWith(baseHref) ? pathname.slice(baseHref.length) : pathname;
  return below
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

/**
 * Works out where in the site a URL points, using nothing but the structure. The page resolution is
 * `resolveTreePath`, which mirrors the server's own, so the sidebar highlights the page the server
 * actually rendered.
 *
 * A URL that doesn't resolve (a mistyped path, a deleted page) still gets a usable location — the
 * first section's default variant, with nothing active — so the sidebar stays populated on a 404
 * page instead of vanishing.
 */
export function deriveLocation(sections: ShellSection[], segments: string[]): SiteLocation | null {
  const match = matchStructure(sections, segments);
  if (match) {
    // Links into a variant always use its canonical form: the default variant needs no `~v` segment.
    const prefix = [...match.prefix, ...variantSegments(match.variant)];
    return {
      section: match.section,
      space: match.space,
      variant: match.variant,
      base: match.prefix,
      prefix,
      rest: match.rest,
      activeNode: resolveTreePath(match.variant.tree, match.rest),
      matched: true,
    };
  }

  const section = sections[0];
  const space = section?.spaces[0];
  const variant = space?.variants.find((v) => v.isDefault) ?? space?.variants[0];
  if (!section || !space || !variant) return null;
  const base = [...(sections.length > 1 ? [section.slug] : []), ...(section.spaces.length > 1 ? [space.slug] : [])];
  return { section, space, variant, base, prefix: [...base, ...variantSegments(variant)], rest: [], activeNode: null, matched: false };
}

/** Full slug path for every node of the active variant, ready to be joined onto the site's base URL. */
export function pathsFor(location: SiteLocation): Map<string, string[]> {
  return prefixPaths(pathsForTree(location.variant.tree), location.prefix);
}
