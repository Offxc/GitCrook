/**
 * Top-level headings only (not ones nested inside Columns/Steppers/
 * Expandables) — those either aren't visible until the reader interacts with
 * something, or read as sub-structure of a block rather than the page's own
 * outline. Matches blockRenderer.tsx's heading case: same id (BlockNote
 * always assigns one), same level cap.
 */
export interface HeadingEntry {
  id: string;
  text: string;
  level: number;
}

export function extractHeadings(blocks: unknown): HeadingEntry[] {
  if (!Array.isArray(blocks)) return [];
  const headings: HeadingEntry[] = [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { id?: string; type?: string; props?: { level?: unknown }; content?: unknown };
    if (b.type === "heading" && b.id) {
      const level = Number(b.props?.level) || 2;
      const text = plainTextOf(b.content);
      if (text) headings.push({ id: b.id, text, level: Math.min(level, 3) });
    }
  }
  return headings;
}

function plainTextOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : ""))
    .join("")
    .trim();
}
