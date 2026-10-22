import type { Html, RootContent } from "mdast";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import { fromHtml } from "hast-util-from-html";
import { safeHref, safeMediaUrl } from "@gitcrook/shared";
import type { Block, Inline, Styles, TableCell, TableContent, TextRun } from "../types";
import { createBlock, type ConvertContext, type Place } from "./context";
import { convertNodes } from "./convert";
import { normalizeInline } from "./inline";

/**
 * Raw HTML in a repository's Markdown is untrusted input. We never render it: a small set of tags is mapped to
 * the blocks they mean, everything else is dropped (with a note), and nothing is ever passed on as HTML.
 */

const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "link", "meta", "base", "svg", "math", "template", "noscript", "canvas"]);
const TRANSPARENT = new Set(["div", "span", "center", "section", "article", "main", "header", "footer", "nav", "aside", "font", "small", "abbr", "wbr", "p", "tbody", "thead", "tfoot", "dl", "dt", "dd"]);

/** Count of `<details` openers minus `</details>` closers in some HTML. */
function detailsBalance(html: string): number {
  const opens = (html.match(/<details\b/gi) ?? []).length;
  const closes = (html.match(/<\/details\s*>/gi) ?? []).length;
  return opens - closes;
}

const decode = (html: string): string => {
  const tree = fromHtml(html, { fragment: true });
  return textOf(tree.children as ElementContent[]).replace(/\s+/g, " ").trim();
};

function textOf(nodes: ElementContent[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.value;
    else if (n.type === "element") out += n.tagName === "br" ? "\n" : textOf(n.children);
  }
  return out;
}

/**
 * Handles the HTML node at `nodes[start]` and returns how many sibling nodes it consumed. A `<details>` that
 * is spread over several siblings (the usual way to write one, with blank lines around the Markdown inside)
 * swallows everything up to its matching `</details>`.
 */
export function convertHtml(nodes: RootContent[], start: number, ctx: ConvertContext, place: Place, out: Block[]): number {
  const node = nodes[start] as Html;
  const value = node.value;

  if (/^\s*<!--[\s\S]*-->\s*$/.test(value)) return 1;

  if (/^\s*<details\b/i.test(value) && detailsBalance(value) > 0) {
    // Find the sibling that closes it.
    let depth = detailsBalance(value);
    let end = start;
    for (let j = start + 1; j < nodes.length && depth > 0; j++) {
      const sibling = nodes[j]!;
      if (sibling.type === "html") depth += detailsBalance(sibling.value);
      end = j;
    }
    if (depth > 0) {
      ctx.diags.add("GS-204", "A <details> block was never closed; its content was kept as ordinary content.", node.position);
      return 1;
    }

    const opener = value;
    let title = /<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(opener)?.[1];
    let bodyStart = start + 1;
    if (title === undefined) {
      const next = nodes[start + 1];
      if (next?.type === "html") {
        const m = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>\s*$/i.exec(next.value);
        if (m) {
          title = m[1];
          bodyStart = start + 2;
        }
      }
    }
    const closer = nodes[end]!;
    const body = nodes.slice(bodyStart, closer.type === "html" && /^\s*<\/details\s*>\s*$/i.test(closer.value) ? end : end + 1);
    // An opener that carries inline content after `<summary>…</summary>` (rare) is ignored; only the title matters.
    const toggle = createBlock(ctx, place, out.length, "toggleListItem", {}, title ? textRuns(decode(title)) : [], node);
    if (toggle) {
      out.push(toggle);
      toggle.children = convertNodes(body, ctx, { path: [...place.path, out.length - 1], depth: place.depth + 1 });
    }
    return end - start + 1;
  }

  // Everything else: map what we understand, drop the rest.
  const tree = fromHtml(value, { fragment: true });
  for (const block of hastToBlocks(tree, ctx, place, out.length, node)) out.push(block);
  return 1;
}

function textRuns(text: string): Inline[] {
  return text ? [{ type: "text", text, styles: {} }] : [];
}

// -------------------------------------------------------------------------------------------------
// hast → blocks
// -------------------------------------------------------------------------------------------------

function hastToBlocks(root: HastRoot | Element, ctx: ConvertContext, place: Place, firstIndex: number, at: Html): Block[] {
  const out: Block[] = [];
  const make = (type: string, props: Record<string, unknown>, content?: Block["content"]) => createBlock(ctx, place, firstIndex + out.length, type, props, content, at);
  const push = (b: Block | null) => {
    if (b) out.push(b);
    return b;
  };

  // Loose inline content between block elements is gathered into paragraphs.
  let pending: ElementContent[] = [];
  const flush = () => {
    const inline = inlineOf(pending, ctx, at);
    pending = [];
    if (inline.length > 0 && !(inline.length === 1 && inline[0]!.type === "text" && inline[0]!.text.trim() === "")) push(make("paragraph", {}, inline));
  };

  const visit = (node: ElementContent) => {
    if (node.type === "comment") return;
    if (node.type === "text") {
      pending.push(node);
      return;
    }
    if (node.type !== "element") return;
    const tag = node.tagName;

    if (DROP_WITH_CONTENT.has(tag)) {
      ctx.diags.add("GS-204", `<${tag}> is not allowed and was removed.`, at.position);
      return;
    }

    switch (tag) {
      case "img": {
        flush();
        const src = safeMediaUrl(String(node.properties?.src ?? ""));
        if (!src) return;
        const b = push(make("image", { url: src, caption: String(node.properties?.title ?? ""), name: String(node.properties?.alt ?? "") }));
        if (b) ctx.references.push({ kind: "image", target: src, blockId: b.id, line: at.position?.start.line });
        return;
      }
      case "figure": {
        flush();
        const img = findFirst(node, "img");
        const caption = findFirst(node, "figcaption");
        const src = safeMediaUrl(String(img?.properties?.src ?? ""));
        if (!src) return;
        const b = push(make("image", { url: src, caption: caption ? textOf(caption.children).trim() : String(img?.properties?.title ?? ""), name: String(img?.properties?.alt ?? "") }));
        if (b) ctx.references.push({ kind: "image", target: src, blockId: b.id, line: at.position?.start.line });
        return;
      }
      case "video":
      case "audio": {
        flush();
        const srcProp = node.properties?.src ?? findFirst(node, "source")?.properties?.src;
        const src = safeMediaUrl(String(srcProp ?? ""));
        if (!src) return;
        const b = push(make(tag, { url: src, caption: "", name: "" }));
        if (b) ctx.references.push({ kind: tag, target: src, blockId: b.id, line: at.position?.start.line });
        return;
      }
      case "br":
        pending.push({ type: "text", value: "\n" });
        return;
      case "hr":
        flush();
        push(make("divider", {}));
        return;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        flush();
        push(make("heading", { level: Number(tag[1]) }, inlineOf(node.children, ctx, at)));
        return;
      }
      case "pre": {
        flush();
        const code = findFirst(node, "code");
        const cls = Array.isArray(code?.properties?.className) ? (code!.properties!.className as string[]).find((c) => c.startsWith("language-")) : undefined;
        const text = textOf((code ?? node).children);
        push(make("codeBlock", { language: cls ? cls.slice("language-".length) : "text" }, text ? [{ type: "text", text: text.replace(/\n$/, ""), styles: {} }] : []));
        return;
      }
      case "blockquote": {
        flush();
        const inner = hastToBlocks(node, ctx, { path: [...place.path, firstIndex + out.length], depth: place.depth + 1 }, 0, at);
        const first = inner[0];
        const q = make("quote", {}, first?.type === "paragraph" ? (first.content as Inline[]) : []);
        if (q) {
          q.children = first?.type === "paragraph" ? inner.slice(1) : inner;
          out.push(q);
        }
        return;
      }
      case "ul":
      case "ol": {
        flush();
        for (const li of node.children) {
          if (li.type !== "element" || li.tagName !== "li") continue;
          const nested = li.children.filter((c): c is Element => c.type === "element" && (c.tagName === "ul" || c.tagName === "ol"));
          const text = li.children.filter((c) => !(c.type === "element" && (c.tagName === "ul" || c.tagName === "ol")));
          const item = push(make(tag === "ol" ? "numberedListItem" : "bulletListItem", {}, inlineOf(text, ctx, at)));
          if (item) item.children = nested.flatMap((n) => hastToBlocks({ type: "element", tagName: "div", properties: {}, children: [n] }, ctx, { path: [...place.path, firstIndex + out.length - 1], depth: place.depth + 1 }, item.children.length, at));
        }
        return;
      }
      case "table": {
        flush();
        const cards = String(node.properties?.dataView ?? "") === "cards";
        const b = cards ? cardsFromTable(node, ctx, place, firstIndex + out.length, at) : tableBlock(node, ctx, place, firstIndex + out.length, at);
        if (b) out.push(b);
        return;
      }
      case "details": {
        flush();
        const summary = findFirst(node, "summary");
        const body = node.children.filter((c) => !(c.type === "element" && c.tagName === "summary"));
        const toggle = push(make("toggleListItem", {}, summary ? textRuns(textOf(summary.children).replace(/\s+/g, " ").trim()) : []));
        if (toggle) toggle.children = hastToBlocks({ type: "element", tagName: "div", properties: {}, children: body }, ctx, { path: [...place.path, firstIndex + out.length - 1], depth: place.depth + 1 }, 0, at);
        return;
      }
      case "a": {
        // A linked image is an image (the link is lost, which is noted); a link with text stays inline.
        const img = findFirst(node, "img");
        if (img && textOf(node.children).trim() === "") {
          flush();
          ctx.diags.add("GS-201", "A linked image was imported as a plain image; the link was dropped.", at.position);
          visit(img);
          return;
        }
        pending.push(node);
        return;
      }
      case "li":
      case "summary":
        for (const child of node.children) visit(child);
        return;
      default:
        break;
    }

    if (TRANSPARENT.has(tag)) {
      // Containers are only structure; block children inside break the paragraph, so flush around them.
      const hasBlockChild = node.children.some((c) => c.type === "element" && !INLINE_TAGS.has(c.tagName));
      if (hasBlockChild || tag === "p" || tag === "div") flush();
      for (const child of node.children) visit(child);
      if (hasBlockChild || tag === "p" || tag === "div") flush();
      return;
    }

    if (INLINE_TAGS.has(tag)) {
      pending.push(node);
      return;
    }

    ctx.diags.add("GS-204", `<${tag}> is not allowed and was removed.`, at.position);
    for (const child of node.children) visit(child);
  };

  for (const child of root.children as ElementContent[]) visit(child);
  flush();
  return out;
}

const INLINE_TAGS = new Set(["a", "b", "strong", "i", "em", "u", "s", "del", "strike", "code", "kbd", "mark", "sub", "sup", "br", "tt", "var", "samp", "cite", "q", "span", "small", "abbr", "wbr", "font", "big", "ins"]);

function findFirst(node: Element, tag: string): Element | undefined {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === tag) return child;
    const nested = findFirst(child, tag);
    if (nested) return nested;
  }
  return undefined;
}

// -------------------------------------------------------------------------------------------------
// inline hast → runs
// -------------------------------------------------------------------------------------------------

function inlineOf(nodes: ElementContent[], ctx: ConvertContext, at: Html): Inline[] {
  const out: Inline[] = [];

  const walk = (node: ElementContent, styles: Styles, sink: Inline[], inLink: boolean) => {
    if (node.type === "text") {
      // Whitespace runs collapse as in a browser.
      const text = node.value === "\n" ? "\n" : node.value.replace(/[ \t\r\n]+/g, " ");
      if (text) sink.push({ type: "text", text, styles: { ...styles } });
      return;
    }
    if (node.type !== "element") return;
    const tag = node.tagName;
    if (DROP_WITH_CONTENT.has(tag)) {
      ctx.diags.add("GS-204", `<${tag}> is not allowed and was removed.`, at.position);
      return;
    }
    switch (tag) {
      case "br":
        sink.push({ type: "text", text: "\n", styles: { ...styles } });
        return;
      case "b":
      case "strong":
        for (const c of node.children) walk(c, { ...styles, bold: true }, sink, inLink);
        return;
      case "i":
      case "em":
      case "cite":
        for (const c of node.children) walk(c, { ...styles, italic: true }, sink, inLink);
        return;
      case "u":
      case "ins":
        for (const c of node.children) walk(c, { ...styles, underline: true }, sink, inLink);
        return;
      case "s":
      case "del":
      case "strike":
        for (const c of node.children) walk(c, { ...styles, strike: true }, sink, inLink);
        return;
      case "code":
      case "kbd":
      case "tt":
      case "samp":
        for (const c of node.children) walk(c, { ...styles, code: true }, sink, inLink);
        return;
      case "a": {
        const href = safeHref(String(node.properties?.href ?? ""));
        const runs: Inline[] = [];
        for (const c of node.children) walk(c, styles, runs, true);
        const textRuns = runs.filter((r): r is TextRun => r.type === "text");
        if (!href) ctx.diags.add("GS-132", "A link with an unsafe or missing target was reduced to its text.", at.position);
        if (!href || inLink) sink.push(...textRuns);
        else sink.push({ type: "link", href, content: textRuns });
        return;
      }
      case "img": {
        const alt = String(node.properties?.alt ?? "");
        if (alt) sink.push({ type: "text", text: alt, styles: { ...styles } });
        return;
      }
      default:
        for (const c of node.children) walk(c, styles, sink, inLink);
    }
  };

  for (const n of nodes) walk(n, {}, out, false);
  // Trim the edges: HTML source indentation is not content.
  const first = out[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = out.at(-1);
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return normalizeInline(out);
}

// -------------------------------------------------------------------------------------------------
// tables
// -------------------------------------------------------------------------------------------------

function rowsOf(table: Element): { head: Element[]; body: Element[] } {
  const head: Element[] = [];
  const body: Element[] = [];
  const collect = (node: Element, into: Element[]) => {
    for (const c of node.children) if (c.type === "element" && c.tagName === "tr") into.push(c);
  };
  for (const c of table.children) {
    if (c.type !== "element") continue;
    if (c.tagName === "thead") collect(c, head);
    else if (c.tagName === "tbody" || c.tagName === "tfoot") collect(c, body);
    else if (c.tagName === "tr") body.push(c);
  }
  // A table with no <thead> whose first row is all <th> has a header row too.
  const first = body[0];
  if (head.length === 0 && first && first.children.some((c) => c.type === "element" && c.tagName === "th") && first.children.every((c) => c.type !== "element" || c.tagName === "th")) {
    head.push(body.shift()!);
  }
  return { head, body };
}

function cellsOf(row: Element): Element[] {
  return row.children.filter((c): c is Element => c.type === "element" && (c.tagName === "td" || c.tagName === "th"));
}

function tableBlock(table: Element, ctx: ConvertContext, place: Place, index: number, at: Html): Block | null {
  const { head, body } = rowsOf(table);
  const toRow = (row: Element) => ({
    cells: cellsOf(row).map((cell): TableCell => {
      const props: TableCell["props"] = {};
      const colspan = Number(cell.properties?.colSpan ?? 1);
      const rowspan = Number(cell.properties?.rowSpan ?? 1);
      if (colspan > 1) props.colspan = colspan;
      if (rowspan > 1) props.rowspan = rowspan;
      const align = String(cell.properties?.align ?? "");
      if (align === "center" || align === "right") props.textAlignment = align;
      return { type: "tableCell", content: inlineOf(cell.children, ctx, at), props };
    }),
  });
  const rows = [...head, ...body].map(toRow);
  if (rows.length === 0) return null;
  const content: TableContent = { type: "tableContent", rows, ...(head.length > 0 ? { headerRows: head.length } : {}) };
  return createBlock(ctx, place, index, "table", {}, content, at);
}

/**
 * GitBook's cards are a table with `data-view="cards"`: each row is a card, and the header cells say which
 * column is the link target and which the cover image. The first remaining column is the title, the next the
 * description.
 */
function cardsFromTable(table: Element, ctx: ConvertContext, place: Place, index: number, at: Html): Block | null {
  const { head, body } = rowsOf(table);
  const headerCells = head[0] ? cellsOf(head[0]) : [];
  const targetCol = headerCells.findIndex((c) => c.properties?.dataCardTarget !== undefined && c.properties?.dataCardTarget !== false);
  const coverCol = headerCells.findIndex((c) => c.properties?.dataCardCover !== undefined && c.properties?.dataCardCover !== false);

  const group = createBlock(ctx, place, index, "cardGroup", { size: "medium" }, undefined, at);
  if (!group) return null;
  group.children = [];
  for (const row of body) {
    const cells = cellsOf(row);
    const textCols = cells.map((_, i) => i).filter((i) => i !== targetCol && i !== coverCol);
    const hrefRaw = targetCol >= 0 ? (findFirst(cells[targetCol]!, "a")?.properties?.href ?? textOf(cells[targetCol]!.children).trim()) : "";
    const coverRaw = coverCol >= 0 ? (findFirst(cells[coverCol]!, "a")?.properties?.href ?? findFirst(cells[coverCol]!, "img")?.properties?.src ?? "") : "";
    const href = hrefRaw ? safeHref(String(hrefRaw)) : "";
    const image = coverRaw ? safeMediaUrl(String(coverRaw)) : "";
    const card = createBlock(
      ctx,
      { path: [...place.path, index], depth: place.depth + 1 },
      group.children.length,
      "card",
      {
        title: textCols[0] !== undefined ? textOf(cells[textCols[0]]!.children).trim() : "",
        description: textCols[1] !== undefined ? textOf(cells[textCols[1]]!.children).trim() : "",
        href,
        imageUrl: image,
      },
      undefined,
      at,
    );
    if (!card) continue;
    group.children.push(card);
    if (href) ctx.references.push({ kind: "card-link", target: href, blockId: card.id, line: at.position?.start.line });
    if (image) ctx.references.push({ kind: "card-image", target: image, blockId: card.id, line: at.position?.start.line });
  }
  return group;
}
