import GithubSlugger, { slug as baseSlug } from "github-slugger";

/**
 * Heading anchors that read like the heading. `#installing-on-linux`, not `#b9`.
 *
 * Slugs follow GitHub's algorithm (via github-slugger), so a link written in a README or a Markdown
 * file in a synced repository - `[see](#installing-on-linux)` - lands on the same heading here as it
 * does on GitHub. Repeated headings are numbered in document order (`intro`, `intro-1`, ...), the same
 * way GitHub does it.
 *
 * Block ids stay what they are (random, regenerated whenever a document is re-imported), which is why
 * they make poor anchors: a link to one breaks the moment the page is re-synced. A slug only changes
 * when the heading's own text changes.
 */

interface AnchorBlock {
  id?: unknown;
  type?: unknown;
  props?: { level?: unknown };
  content?: unknown;
  children?: unknown;
}

export interface HeadingAnchor {
  blockId: string;
  anchor: string;
  text: string;
  /** 1-6 as authored. */
  level: number;
  /** 0 for a heading directly in the document, 1+ when nested inside another block (a column, an expandable...). */
  depth: number;
}

/** The text of inline content, looking inside links. */
export function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as { text?: unknown; content?: unknown };
    if (typeof it.text === "string") out += it.text;
    else if (it.content !== undefined) out += inlineText(it.content);
  }
  return out;
}

/**
 * Every non-empty heading in the document, in reading order, with a unique anchor each. Headings nested
 * in other blocks are included (they have ids on the page, and a link may point at one); the outline
 * decides separately which of them to show.
 */
export function collectHeadings(blocks: unknown): HeadingAnchor[] {
  const slugger = new GithubSlugger();
  const out: HeadingAnchor[] = [];

  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null) continue;
      const block = raw as AnchorBlock;
      if (block.type === "heading" && typeof block.id === "string") {
        const text = inlineText(block.content).trim();
        if (text) {
          const level = Math.min(Math.max(Number(block.props?.level) || 1, 1), 6);
          // Punctuation-only headings slug to nothing; an id is still needed to link to. Deriving the
          // base first keeps the numbering clean ("section", "section-1") instead of "" then "-1".
          const anchor = slugger.slug(baseSlug(text) || "section");
          out.push({ blockId: block.id, anchor, text, level, depth });
        }
      }
      walk(block.children, depth + 1);
    }
  };
  walk(blocks, 0);
  return out;
}

/** blockId → anchor, for the renderer. */
export function anchorMap(blocks: unknown): Map<string, string> {
  return new Map(collectHeadings(blocks).map((h) => [h.blockId, h.anchor]));
}
