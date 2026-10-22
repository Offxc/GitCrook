import type { Blockquote, Code, Heading, List, ListItem, Paragraph, PhrasingContent, RootContent, Table } from "mdast";
import { toString } from "mdast-util-to-string";
import { isHintStyle, safeMediaUrl } from "@gitcrook/shared";
import type { Block, Inline, TableCell, TableContent } from "../types";
import { createBlock, type ConvertContext, type Place } from "./context";
import { convertDirective } from "./directives";
import { convertHtml } from "./html";
import { inlineToPlainText, normalizeInline, onlyImages, phrasingToInline } from "./inline";

/** Languages the way authors write them → the identifiers the highlighter knows. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  golang: "go",
  rs: "rust",
  py: "python",
  rb: "ruby",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  kt: "kotlin",
  dockerfile: "docker",
  txt: "text",
  plaintext: "text",
  "": "text",
};

export function normalizeLanguage(lang: string | null | undefined): string {
  const key = (lang ?? "").trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

const ALERT_STYLES = { note: "info", tip: "success", important: "info", warning: "warning", caution: "danger" } as const;
const ALERT_RE = /^\[!(note|tip|important|warning|caution)\][ \t]*/i;

function inlineCtx(ctx: ConvertContext) {
  return { diags: ctx.diags, definitions: ctx.definitions, source: ctx.source };
}

/** Converts a run of sibling nodes into blocks. This is the heart of the parser; everything else feeds it. */
export function convertNodes(nodes: RootContent[], ctx: ConvertContext, place: Place): Block[] {
  const out: Block[] = [];
  if (place.depth > ctx.options.maxDepth) {
    ctx.diags.add("GS-207", `Content is nested more than ${ctx.options.maxDepth} levels deep; it was skipped.`, nodes[0]?.position);
    return out;
  }

  const add = (block: Block | null) => {
    if (block) out.push(block);
    return block;
  };
  const make = (type: string, props: Record<string, unknown>, content?: Block["content"], node?: RootContent) =>
    createBlock(ctx, place, out.length, type, props, content, node);
  const childPlace = (): Place => ({ path: [...place.path, out.length], depth: place.depth + 1 });

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    switch (node.type) {
      case "heading": {
        const inline = phrasingToInline((node as Heading).children, inlineCtx(ctx));
        const block = add(make("heading", { level: (node as Heading).depth }, inline, node));
        if (block) collectLinkReferences(inline, block.id, ctx, node.position?.start.line);
        break;
      }
      case "paragraph":
        for (const b of convertParagraph(node as Paragraph, ctx, place, out.length)) out.push(b);
        break;
      case "list": {
        for (const b of convertList(node as List, ctx, place, out.length)) out.push(b);
        break;
      }
      case "blockquote": {
        const block = convertBlockquote(node as Blockquote, ctx, place, out.length);
        if (block) out.push(block);
        break;
      }
      case "code":
        add(convertCode(node as Code, ctx, place, out.length));
        break;
      case "thematicBreak":
        add(make("divider", {}, undefined, node));
        break;
      case "table": {
        const block = convertTable(node as Table, ctx, place, out.length);
        if (block) out.push(block);
        break;
      }
      case "math":
        add(make("math", { formula: node.value }, undefined, node));
        break;
      case "html": {
        const consumed = convertHtml(nodes, i, ctx, place, out);
        i += consumed - 1;
        break;
      }
      case "containerDirective":
      case "leafDirective":
        for (const b of convertDirective(node, ctx, place, out.length)) out.push(b);
        break;
      case "definition":
      case "yaml":
        break; // consumed elsewhere (link references, front matter)
      case "footnoteDefinition": {
        ctx.diags.add("GS-206", "A footnote was converted to an ordinary paragraph.", node.position);
        for (const b of convertNodes(node.children as RootContent[], ctx, childPlace())) out.push(b);
        break;
      }
      case "textDirective":
        // A block-level text directive that is not a button: show it rather than lose it.
        ctx.diags.add("GS-203", `Directive ":${node.name}" is not supported; it is shown as text.`, node.position);
        add(make("paragraph", {}, [{ type: "text", text: `:${node.name}${toString(node as never) ? `[${toString(node as never)}]` : ""}`, styles: {} }], node));
        break;
      default:
        break;
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------------

function convertParagraph(node: Paragraph, ctx: ConvertContext, place: Place, index: number): Block[] {
  const out: Block[] = [];
  const make = (type: string, props: Record<string, unknown>, content?: Block["content"]) =>
    createBlock(ctx, place, index + out.length, type, props, content, node);

  /** An image as a block, or nothing (and a message) if its address is not one a page may point at. */
  const pushImage = (image: { url: string; alt: string; title: string | null }) => {
    const url = safeMediaUrl(image.url);
    if (!url) {
      ctx.diags.add("GS-132", `Image address "${image.url.slice(0, 80)}" is not allowed; the image was left out.`, node.position);
      return;
    }
    const block = make("image", { url, caption: image.title ?? "", name: image.alt });
    if (block) {
      out.push(block);
      ctx.references.push({ kind: "image", target: url, blockId: block.id, line: node.position?.start.line });
    }
  };

  const images = onlyImages(node.children);
  if (images) {
    for (const image of images) pushImage(image);
    return out;
  }

  // `:button[Label]{href="…"}` alone in a paragraph is a button block.
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type === "textDirective" && only.name === "button") {
    const label = toString(only as never).trim();
    const href = String(only.attributes?.href ?? "");
    const style = only.attributes?.style === "secondary" ? "secondary" : "primary";
    if (!label || !href) {
      ctx.diags.add("GS-205", "A button needs a label and an href: :button[Label]{href=\"…\"}.", node.position);
      return out;
    }
    const block = make("button", { label, href, style });
    if (block) {
      out.push(block);
      ctx.references.push({ kind: "button", target: href, blockId: block.id, line: node.position?.start.line });
    }
    return out;
  }

  // An image in the middle of a sentence cannot stay in it (the editor's images are blocks): the paragraph is split
  // around it, so the text before, the image and the text after all survive, in order.
  const pieces = splitAtImages(node.children as PhrasingContent[]);
  if (pieces.length > 1) ctx.diags.add("GS-206", "An image in the middle of a paragraph was moved onto its own line.", node.position);
  for (const piece of pieces) {
    if ("image" in piece) {
      pushImage(piece.image);
      continue;
    }
    const inline = phrasingToInline(piece.text, inlineCtx(ctx));
    if (inline.length === 0) continue;
    const block = make("paragraph", {}, inline);
    if (block) {
      out.push(block);
      collectLinkReferences(inline, block.id, ctx, node.position?.start.line);
    }
  }
  return out;
}

type Piece = { text: PhrasingContent[] } | { image: { url: string; alt: string; title: string | null } };

/**
 * A paragraph's children cut at each image that is a direct child. Text on either side stays text, with the space
 * that only separated it from the image trimmed off; a paragraph without images comes back whole.
 */
function splitAtImages(children: PhrasingContent[]): Piece[] {
  const pieces: Piece[] = [];
  let run: PhrasingContent[] = [];
  const flush = () => {
    const trimmed = run.slice();
    const first = trimmed[0];
    if (first?.type === "text") trimmed[0] = { ...first, value: first.value.trimStart() };
    const last = trimmed[trimmed.length - 1];
    if (last?.type === "text") trimmed[trimmed.length - 1] = { ...last, value: last.value.trimEnd() };
    const meaningful = trimmed.filter((n) => !(n.type === "text" && n.value === ""));
    if (meaningful.length > 0) pieces.push({ text: meaningful });
    run = [];
  };
  for (const child of children) {
    if (child.type === "image") {
      flush();
      pieces.push({ image: { url: child.url, alt: child.alt ?? "", title: child.title ?? null } });
    } else {
      run.push(child);
    }
  }
  if (pieces.length === 0) return [{ text: children }];
  flush();
  return pieces;
}

/** Notes every link in some inline content so relative ones can be resolved to pages later. */
export function collectLinkReferences(inline: Inline[], blockId: string, ctx: ConvertContext, line?: number) {
  for (const run of inline) if (run.type === "link") ctx.references.push({ kind: "link", target: run.href, blockId, line });
}

function convertList(list: List, ctx: ConvertContext, place: Place, index: number): Block[] {
  const out: Block[] = [];
  list.children.forEach((item: ListItem, itemIndex) => {
    const type = item.checked !== null && item.checked !== undefined ? "checkListItem" : list.ordered ? "numberedListItem" : "bulletListItem";
    const props: Record<string, unknown> = {};
    if (type === "checkListItem") props.checked = item.checked === true;
    if (type === "numberedListItem" && itemIndex === 0 && list.start != null && list.start !== 1) props.start = list.start;

    // The item's own text is its first paragraph; everything after it (more paragraphs, a nested list, code)
    // nests beneath it.
    const [first, ...rest] = item.children;
    let content: Inline[] = [];
    let remaining: RootContent[] = rest as RootContent[];
    if (first?.type === "paragraph" && !onlyImages(first.children)) {
      content = phrasingToInline(first.children as PhrasingContent[], inlineCtx(ctx));
    } else if (first) {
      remaining = item.children as RootContent[];
    }

    const block = createBlock(ctx, place, index + out.length, type, props, content, item);
    if (!block) return;
    out.push(block);
    collectLinkReferences(content, block.id, ctx, item.position?.start.line);
    block.children = convertNodes(remaining, ctx, { path: [...place.path, index + out.length - 1], depth: place.depth + 1 });
  });
  return out;
}

function convertBlockquote(node: Blockquote, ctx: ConvertContext, place: Place, index: number): Block | null {
  const [first, ...rest] = node.children;

  // GitHub's alert syntax: `> [!NOTE]`, optionally followed by a title on the same line.
  if (first?.type === "paragraph") {
    const head = first.children[0];
    if (head?.type === "text") {
      const match = ALERT_RE.exec(head.value);
      if (match) {
        const style = ALERT_STYLES[match[1]!.toLowerCase() as keyof typeof ALERT_STYLES];
        if (match[1]!.toLowerCase() === "important") ctx.diags.add("GS-206", "[!IMPORTANT] is shown as a note: GitCrook has no separate style for it.", node.position);
        const afterMarker = head.value.slice(match[0].length);
        const newline = afterMarker.indexOf("\n");
        const title = (newline === -1 ? afterMarker : afterMarker.slice(0, newline)).trim();
        const bodyStart = newline === -1 ? "" : afterMarker.slice(newline + 1);

        const bodyChildren: PhrasingContent[] = [...(bodyStart ? [{ ...head, value: bodyStart }] : []), ...first.children.slice(1)];
        // A title written on the marker line only counts as a title if it is plain text.
        let content = phrasingToInline(bodyChildren, inlineCtx(ctx));
        let after = rest as RootContent[];
        // The marker on a line of its own, then the text as the next paragraph: that paragraph is the callout's text.
        if (bodyChildren.length === 0 && after[0]?.type === "paragraph") {
          content = phrasingToInline(after[0].children as PhrasingContent[], inlineCtx(ctx));
          after = after.slice(1);
        }
        const props: Record<string, unknown> = { hintStyle: isHintStyle(style) ? style : "info" };
        if (title) props.hintTitle = title;
        const block = createBlock(ctx, place, index, "hint", props, content, node);
        if (!block) return null;
        collectLinkReferences(content, block.id, ctx, node.position?.start.line);
        block.children = convertNodes(after, ctx, { path: [...place.path, index], depth: place.depth + 1 });
        return block;
      }
    }
  }

  let content: Inline[] = [];
  let remaining: RootContent[] = rest as RootContent[];
  if (first?.type === "paragraph") content = phrasingToInline(first.children as PhrasingContent[], inlineCtx(ctx));
  else if (first) remaining = node.children as RootContent[];

  const block = createBlock(ctx, place, index, "quote", {}, content, node);
  if (!block) return null;
  collectLinkReferences(content, block.id, ctx, node.position?.start.line);
  block.children = convertNodes(remaining, ctx, { path: [...place.path, index], depth: place.depth + 1 });
  return block;
}

function convertCode(node: Code, ctx: ConvertContext, place: Place, index: number): Block | null {
  const props: Record<string, unknown> = { language: normalizeLanguage(node.lang) };
  const title = /\btitle=(?:"([^"]*)"|'([^']*)')/.exec(node.meta ?? "");
  if (title) props.title = title[1] ?? title[2] ?? "";
  const text = node.value;
  return createBlock(ctx, place, index, "codeBlock", props, text === "" ? [] : [{ type: "text", text, styles: {} }], node);
}

function convertTable(node: Table, ctx: ConvertContext, place: Place, index: number): Block | null {
  const rows = node.children.map((row) => ({
    cells: row.children.map((cell, ci): TableCell => {
      const props: TableCell["props"] = {};
      const align = node.align?.[ci];
      if (align) props.textAlignment = align;
      return { type: "tableCell", content: phrasingToInline(cell.children as PhrasingContent[], inlineCtx(ctx)), props };
    }),
  }));
  const content: TableContent = { type: "tableContent", headerRows: 1, rows };
  const block = createBlock(ctx, place, index, "table", {}, content, node);
  if (block) for (const row of rows) for (const cell of row.cells) collectLinkReferences(cell.content, block.id, ctx, node.position?.start.line);
  return block;
}

export { inlineToPlainText, normalizeInline };
