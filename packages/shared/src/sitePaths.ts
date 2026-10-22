/**
 * How a published URL maps to the Section → Space → Variant → Page tree, and back.
 *
 * Both directions live here, side by side, because they must stay exact inverses: a page's
 * computed path has to resolve to that same page. They used to be written twice (the request
 * path in apps/web, the reverse in apps/web *and* apps/worker), and the sidebar built a third
 * variant of it that forgot the prefix. Pure functions over plain data, so the same code runs in
 * the web app, the worker, the sync engine and the tests.
 *
 * The rules:
 *  - A level with exactly one child is implicit — it consumes no URL segment. A one-section,
 *    one-space site publishes at `/{siteSlug}/{page-slug}`.
 *  - A level with several children is addressed by slug.
 *  - A non-default variant adds a literal `~v/{variantSlug}` after the section/space segments.
 */

export const VARIANT_SEGMENT = "~v";

export interface StructureVariant {
  id: string;
  slug: string;
  isDefault: boolean;
}

export interface StructureSpace<V extends StructureVariant = StructureVariant> {
  id: string;
  slug: string;
  variants: V[];
}

export interface StructureSection<S extends StructureSpace = StructureSpace> {
  id: string;
  slug: string;
  spaces: S[];
}

export interface StructureMatch<Sec extends StructureSection, Sp extends StructureSpace, V extends StructureVariant> {
  section: Sec;
  space: Sp;
  variant: V;
  /** The section/space segments that were consumed (empty when both levels are implicit). */
  prefix: string[];
  /** Whether the URL spelled the variant out (`~v/slug`). */
  explicitVariant: boolean;
  /** What is left over: the page slug path. */
  rest: string[];
}

/** Resolves the structural part of a URL. Returns null when any segment names nothing. */
export function matchStructure<Sec extends StructureSection>(
  sections: Sec[],
  segments: string[],
): StructureMatch<Sec, Sec["spaces"][number], Sec["spaces"][number]["variants"][number]> | null {
  if (sections.length === 0) return null;

  let rest = segments;
  let section = sections[0]!;
  if (sections.length > 1) {
    const match = sections.find((s) => s.slug === rest[0]);
    if (!match) return null;
    section = match;
    rest = rest.slice(1);
  }

  const spaces = section.spaces;
  if (spaces.length === 0) return null;
  let space = spaces[0]!;
  if (spaces.length > 1) {
    const match = spaces.find((s) => s.slug === rest[0]);
    if (!match) return null;
    space = match;
    rest = rest.slice(1);
  }

  const prefix = segments.slice(0, segments.length - rest.length);

  const variants = space.variants;
  if (variants.length === 0) return null;
  let variant = variants.find((v) => v.isDefault) ?? variants[0]!;
  let explicitVariant = false;
  if (rest[0] === VARIANT_SEGMENT && rest[1]) {
    const match = variants.find((v) => v.slug === rest[1]);
    if (!match) return null;
    variant = match;
    explicitVariant = true;
    rest = rest.slice(2);
  }

  return { section, space, variant, prefix, explicitVariant, rest };
}

/**
 * The section/space segments in front of a variant's pages — the inverse of the first half of
 * `matchStructure`. A level is only spelled out when it has siblings, hence the counts.
 */
export function basePrefix(
  counts: { sections: number; spacesInSection: number },
  section: { slug: string },
  space: { slug: string },
): string[] {
  const out: string[] = [];
  if (counts.sections > 1) out.push(section.slug);
  if (counts.spacesInSection > 1) out.push(space.slug);
  return out;
}

/** `["~v", slug]` for a non-default variant, nothing for the default one. */
export function variantSegments(variant: { slug: string; isDefault: boolean }): string[] {
  return variant.isDefault ? [] : [VARIANT_SEGMENT, variant.slug];
}

/**
 * Every segment in front of a variant's page paths (section, space, `~v/slug`), looked up by
 * variant id. Null when the variant isn't in the structure.
 */
export function variantPrefix(sections: StructureSection[], variantId: string): string[] | null {
  for (const section of sections) {
    for (const space of section.spaces) {
      const variant = space.variants.find((v) => v.id === variantId);
      if (variant) return [...basePrefix({ sections: sections.length, spacesInSection: section.spaces.length }, section, space), ...variantSegments(variant)];
    }
  }
  return null;
}

export interface PublishedBaseInput {
  protocol: string;
  rootDomain: string;
  siteSlug: string;
  customDomain?: { hostname: string; status: string } | null;
}

/**
 * Where a site lives: its verified custom domain if it has one, otherwise
 * `{protocol}://{rootDomain}/{siteSlug}`. Only an ACTIVE domain counts — a pending or failed claim
 * serves nothing.
 */
export function publishedBaseUrl({ protocol, rootDomain, siteSlug, customDomain }: PublishedBaseInput): string {
  if (customDomain && customDomain.status === "ACTIVE") return `https://${customDomain.hostname}`;
  return `${protocol}://${rootDomain}/${siteSlug}`;
}

/** `base` plus path segments, with no trailing slash for an empty path. */
export function joinUrl(base: string, segments: readonly string[]): string {
  return segments.length > 0 ? `${base}/${segments.join("/")}` : base;
}
