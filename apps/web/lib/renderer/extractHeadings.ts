import { collectHeadings } from "@gitcrook/shared";

/**
 * The page outline: headings directly in the document, not ones nested inside Columns/Steppers/
 * Expandables — those either aren't visible until the reader interacts with something, or read as
 * sub-structure of a block rather than the page's own outline.
 *
 * `id` is the heading's anchor (a readable slug, de-duplicated across every heading on the page), the
 * same one the renderer puts on the element, so an outline entry always scrolls to its heading.
 */
export interface HeadingEntry {
  id: string;
  text: string;
  level: number;
}

export function extractHeadings(blocks: unknown): HeadingEntry[] {
  return collectHeadings(blocks)
    .filter((h) => h.depth === 0)
    .map((h) => ({ id: h.anchor, text: h.text, level: Math.min(h.level, 3) }));
}
