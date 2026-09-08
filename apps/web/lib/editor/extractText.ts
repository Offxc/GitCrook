/**
 * Best-effort plain-text extraction from a BlockNote document, kept in sync
 * with `Page.content` on every save and stored in `Page.contentText` to feed
 * search (Postgres full-text search lands in Phase 3) without needing to
 * parse the block JSON at query time. Duck-types the content shapes rather
 * than importing BlockNote's types here — this file has to survive
 * additions to the block schema (Phase 3's custom blocks) without changes.
 */
export function extractPlainText(blocks: unknown): string {
  const parts: string[] = [];
  walkBlocks(blocks, parts);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function walkBlocks(blocks: unknown, out: string[]): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { content?: unknown; children?: unknown };
    walkContent(b.content, out);
    walkBlocks(b.children, out);
  }
}

function walkContent(content: unknown, out: string[]): void {
  if (Array.isArray(content)) {
    for (const item of content) walkInline(item, out);
  } else if (content && typeof content === "object" && "rows" in content) {
    // Table content: { type: "tableContent", rows: [{ cells: [...] }] }
    const rows = (content as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const cells = (row as { cells?: unknown })?.cells;
        if (Array.isArray(cells)) for (const cell of cells) walkContent(cell, out);
      }
    }
  } else if (typeof content === "string") {
    out.push(content);
  }
}

function walkInline(item: unknown, out: string[]): void {
  if (typeof item !== "object" || item === null) return;
  const i = item as { type?: string; text?: string; content?: unknown };
  if (typeof i.text === "string") out.push(i.text);
  if (i.content) walkContent(i.content, out);
}
