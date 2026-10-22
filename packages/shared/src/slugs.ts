import { isValidSlugFormat, validateSlug } from "./reservedSlugs";

const MAX_SLUG_LENGTH = 96;

/** A URL segment from free text: lowercase ASCII words joined by hyphens, accents folded. Falls back to "page" when nothing survives. */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // "é" → "e": drop the combining accent left by decomposition
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/g, "") || "page"
  );
}

/**
 * The first of `base`, `base-1`, `base-2`, … that is valid, not reserved and not in `taken`.
 * Suffixed candidates are trimmed so they stay within the length limit.
 */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  let candidate = isValidSlugFormat(base) ? base : slugify(base);
  for (let suffix = 1; taken.has(candidate) || !validateSlug(candidate).ok; suffix++) {
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, MAX_SLUG_LENGTH - tail.length).replace(/-+$/g, "")}${tail}`;
    if (!isValidSlugFormat(candidate)) candidate = `${slugify(base).slice(0, MAX_SLUG_LENGTH - tail.length)}${tail}`;
  }
  return candidate;
}
