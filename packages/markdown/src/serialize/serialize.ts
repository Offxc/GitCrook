import { toMarkdown } from "mdast-util-to-markdown";
import { directiveToMarkdown } from "mdast-util-directive";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import type { BlockContent, DefinitionContent, ListItem, Paragraph, PhrasingContent, Root, TableRow } from "mdast";
import type { ContainerDirective, LeafDirective, TextDirective } from "mdast-util-directive";
import YAML from "yaml";
import type { FrontMatter } from "../frontMatter";
import type { Block, Inline, TableCell, TableContent, TextRun } from "../types";
import { inlineToMdast, isPlain, plainText } from "./inline";

export interface SerializeOptions {
  /** Written as a YAML block at the top. Only keys with a value are emitted. */
  frontMatter?: Partial<Omit<FrontMatter, "extra">> & { extra?: Record<string, unknown> };
}

export interface SerializeResult {
  markdown: string;
  /**
   * Things the Markdown could not carry, in plain words: an empty list means what you get back from parsing
   * this is the same page. Used to decide whether a page may be written back to a repository.
   */
  lossy: string[];
}

const ALERT = { info: "NOTE", success: "TIP", warning: "WARNING", danger: "CAUTION" } as const;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

interface Ctx {
  notes: Set<string>;
}

type Attributes = Record<string, string | null | undefined>;
type Flow = BlockContent | DefinitionContent;

function attrs(values: Record<string, unknown>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(values)) {
    const s = str(v);
    if (s !== "") out[k] = s;
  }
  return out;
}

function leafDirective(name: string, attributes: Attributes): LeafDirective {
  return { type: "leafDirective", name, attributes, children: [] };
}

/** The containers whose title the reader may also find as a leading heading. */
const TITLED = new Set(["step", "update"]);

function containerDirective(name: string, attributes: Attributes, children: Flow[], title?: Inline[], ctx?: Ctx): ContainerDirective {
  // A title is an attribute (`title="Install"`), so it is plain text. (The directive label syntax could
  // carry formatting, but the Markdown toolchain doesn't escape inside it reliably, and a title that needs
  // bold or links is rare enough that saying so is better than a page that doesn't read back the same.)
  if (title && title.length > 0) {
    if (!isPlain(title)) ctx?.notes.add("Formatting in a step, update or tab title was dropped.");
    attributes = { title: plainText(title), ...attributes };
  } else if (TITLED.has(name) && children[0]?.type === "heading") {
    // GitBook writes a title as the heading inside the block, so a leading heading under no title would be read as
    // one. An explicit empty title says there isn't one.
    attributes = { title: "", ...attributes };
  }
  return { type: "containerDirective", name, attributes, children } as ContainerDirective;
}

const inline = (content: Block["content"], ctx: Ctx, inTable = false): PhrasingContent[] =>
  inlineToMdast(Array.isArray(content) ? content : undefined, inTable, ctx.notes);

const text = (b: Block): Inline[] | undefined => (Array.isArray(b.content) ? b.content : undefined);

// -------------------------------------------------------------------------------------------------

function blocksToMdast(blocks: Block[], ctx: Ctx): Flow[] {
  const out: Flow[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;

    if (block.type === "bulletListItem" || block.type === "checkListItem" || block.type === "numberedListItem") {
      const ordered = block.type === "numberedListItem";
      const items: ListItem[] = [];
      while (i < blocks.length && (ordered ? blocks[i]!.type === "numberedListItem" : blocks[i]!.type === "bulletListItem" || blocks[i]!.type === "checkListItem")) {
        items.push(listItem(blocks[i]!, ctx));
        i++;
      }
      const start = ordered && typeof block.props.start === "number" ? block.props.start : 1;
      out.push({ type: "list", ordered, start: ordered ? start : null, spread: false, children: items });
      continue;
    }

    out.push(...convert(block, ctx));
    i++;
  }
  return out;
}

function listItem(block: Block, ctx: Ctx): ListItem {
  const children: Flow[] = [];
  const content = inline(block.content, ctx);
  children.push({ type: "paragraph", children: content });
  children.push(...blocksToMdast(block.children, ctx));
  note(block, ctx);
  return { type: "listItem", spread: false, checked: block.type === "checkListItem" ? block.props.checked === true : null, children } as ListItem;
}

/** Records the presentation the editor allows on a text block but Markdown cannot hold. */
function note(block: Block, ctx: Ctx) {
  const p = block.props;
  if ((p.textColor && p.textColor !== "default") || (p.backgroundColor && p.backgroundColor !== "default")) ctx.notes.add("Block colours are not part of Markdown and were dropped.");
  if (p.textAlignment && p.textAlignment !== "left") ctx.notes.add("Text alignment is not part of Markdown and was dropped.");
}

function convert(block: Block, ctx: Ctx): Flow[] {
  note(block, ctx);
  const p = block.props;
  const kids = () => blocksToMdast(block.children, ctx);

  switch (block.type) {
    case "paragraph": {
      const content = inline(block.content, ctx);
      const out: Flow[] = content.length ? [{ type: "paragraph", children: content }] : [];
      if (block.children.length) {
        ctx.notes.add("Blocks nested under a paragraph were flattened.");
        out.push(...kids());
      }
      return out;
    }
    case "heading": {
      if (p.isToggleable === true) ctx.notes.add("A toggleable heading was written as an ordinary heading.");
      const out: Flow[] = [{ type: "heading", depth: clampLevel(p.level), children: inline(block.content, ctx) }];
      if (block.children.length) out.push(...kids());
      return out;
    }
    case "quote":
      return [{ type: "blockquote", children: [...(inline(block.content, ctx).length ? [{ type: "paragraph", children: inline(block.content, ctx) } as Paragraph] : []), ...kids()] }];
    case "hint": {
      const style = (str(p.hintStyle) in ALERT ? str(p.hintStyle) : "info") as keyof typeof ALERT;
      const title = str(p.hintTitle).trim();
      const head: PhrasingContent[] = [{ type: "html", value: `[!${ALERT[style]}]` }];
      if (title) head.push({ type: "text", value: ` ${title}` });
      const body = inline(block.content, ctx);
      return [{ type: "blockquote", children: [{ type: "paragraph", children: head }, ...(body.length ? [{ type: "paragraph", children: body } as Paragraph] : []), ...kids()] }];
    }
    case "toggleListItem": {
      if (!isPlain(text(block))) ctx.notes.add("Formatting in an expandable section's title was dropped.");
      const title = escapeHtml(plainText(text(block)));
      return [
        { type: "html", value: `<details>\n<summary>${title}</summary>` },
        ...kids(),
        { type: "html", value: "</details>" },
      ];
    }
    case "codeBlock": {
      const language = str(p.language);
      const code = Array.isArray(block.content) ? block.content.map((r) => (r.type === "text" ? r.text : "")).join("") : "";
      return [{ type: "code", lang: language && language !== "text" ? language : null, meta: p.title ? `title="${str(p.title).replace(/"/g, "'")}"` : null, value: code }];
    }
    case "divider":
      return [{ type: "thematicBreak" }];
    case "image": {
      if (p.previewWidth) ctx.notes.add("An image's preview width was dropped.");
      return [{ type: "paragraph", children: [{ type: "image", url: str(p.url), alt: str(p.name), title: str(p.caption) || null }] }];
    }
    case "video":
      return [leafDirective("video", attrs({ src: p.url, caption: p.caption, name: p.name, width: p.previewWidth }))];
    case "audio":
      return [leafDirective("audio", attrs({ src: p.url, caption: p.caption, name: p.name }))];
    case "file":
      return [leafDirective("file", attrs({ src: p.url, name: p.name, caption: p.caption }))];
    case "embed":
      return [leafDirective("embed", attrs({ url: p.url }))];
    case "pageLink":
      return [leafDirective("page-link", attrs({ href: p.href, title: p.title, description: p.description }))];
    case "math":
      return [{ type: "math", value: str(p.formula) }];
    case "button": {
      const button: TextDirective = {
        type: "textDirective",
        name: "button",
        attributes: attrs({ href: p.href, style: p.style === "secondary" ? "secondary" : "" }),
        children: [{ type: "text", value: str(p.label) }],
      };
      return [{ type: "paragraph", children: [button] }];
    }
    case "table":
      return tableToMdast(block, ctx);
    case "columnList":
      return [
        containerDirective(
          "columns",
          {},
          block.children.map((col) => containerDirective("column", attrs({ width: typeof col.props.width === "number" && col.props.width !== 1 ? col.props.width : "" }), blocksToMdast(col.children, ctx))),
        ),
      ];
    case "column":
      return blocksToMdast(block.children, ctx); // a column outside a column list: its content, on its own
    case "cardGroup":
      return [
        containerDirective(
          "cards",
          attrs({ size: p.size === "large" ? "large" : "" }),
          block.children.map((card) => leafDirective("card", attrs({ title: card.props.title, description: card.props.description, href: card.props.href, image: card.props.imageUrl }))),
        ),
      ];
    case "card":
      return [leafDirective("card", attrs({ title: p.title, description: p.description, href: p.href, image: p.imageUrl }))];
    case "stepper":
      return [containerDirective("stepper", {}, block.children.map((step) => containerDirective("step", {}, blocksToMdast(step.children, ctx), text(step), ctx)))];
    case "step":
      return [containerDirective("step", {}, kids(), text(block), ctx)];
    case "updates":
      return [
        containerDirective(
          "updates",
          {},
          block.children.map((u) => containerDirective("update", attrs({ date: u.props.date, tags: u.props.tags }), blocksToMdast(u.children, ctx), text(u), ctx)),
        ),
      ];
    case "update":
      return [containerDirective("update", attrs({ date: p.date, tags: p.tags }), kids(), text(block), ctx)];
    default: {
      ctx.notes.add(`A "${block.type}" block is not part of Markdown; its text was kept as a paragraph.`);
      const content = inline(block.content, ctx);
      return content.length ? [{ type: "paragraph", children: content }, ...kids()] : kids();
    }
  }
}

const clampLevel = (level: unknown): 1 | 2 | 3 | 4 | 5 | 6 => {
  const n = Math.round(Number(level) || 1);
  return Math.min(Math.max(n, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tableToMdast(block: Block, ctx: Ctx): Flow[] {
  const content = block.content as TableContent | undefined;
  if (!content || content.type !== "tableContent" || content.rows.length === 0) return [];
  const rows = content.rows;

  const headerRows = content.headerRows ?? 0;
  if (headerRows !== 1) ctx.notes.add(headerRows === 0 ? "A table without a header row was written with its first row as the header." : "A table with several header rows was written with one.");
  if (content.headerCols) ctx.notes.add("A table's header column was not kept.");
  if (rows.some((r) => r.cells.some((c) => (c.props.colspan ?? 1) > 1 || (c.props.rowspan ?? 1) > 1))) ctx.notes.add("Merged table cells were split.");
  if (rows.some((r) => r.cells.some((c) => c.props.backgroundColor || c.props.textColor))) ctx.notes.add("Table cell colours were dropped.");

  const columns = Math.max(...rows.map((r) => r.cells.length));
  const align = Array.from({ length: columns }, (_, ci) => {
    const a = rows[0]!.cells[ci]?.props.textAlignment;
    return a === "center" || a === "right" || a === "left" ? a : null;
  });
  const toRow = (row: TableContent["rows"][number]): TableRow => ({
    type: "tableRow",
    children: Array.from({ length: columns }, (_, ci) => ({ type: "tableCell" as const, children: inlineToMdast(row.cells[ci]?.content, true, ctx.notes) })),
  });
  return [{ type: "table", align, children: rows.map(toRow) }];
}

// -------------------------------------------------------------------------------------------------

function frontMatterYaml(fm: NonNullable<SerializeOptions["frontMatter"]>): string {
  const ordered: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && v !== false) ordered[k] = v;
  };
  put("title", fm.title);
  put("description", fm.description);
  put("icon", fm.icon);
  put("slug", fm.slug);
  put("order", fm.order);
  put("draft", fm.draft);
  put("hidden", fm.hidden);
  put("nav_title", fm.nav_title);
  put("id", fm.id);
  put("redirect_from", fm.redirect_from);
  for (const [k, v] of Object.entries(fm.extra ?? {})) put(k, v);
  if (Object.keys(ordered).length === 0) return "";
  return `---\n${YAML.stringify(ordered, { lineWidth: 0 }).trimEnd()}\n---\n\n`;
}

/** Blocks → GitCrook Markdown. Deterministic: the same blocks always produce the same text. */
/**
 * Stored page JSON is written by the editor, but it is still data from a database: an older page may lack
 * `props`, `children` or `styles`, and nothing guarantees an entry is an object. Fill in what the rest of the
 * serializer takes for granted rather than letting one odd block fail a whole page.
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function tidyInline(input: unknown): Inline[] {
  if (!Array.isArray(input)) return [];
  const out: Inline[] = [];
  for (const raw of input) {
    if (!isObject(raw)) continue;
    if (raw.type === "text" && typeof raw.text === "string") {
      out.push({ type: "text", text: raw.text, styles: isObject(raw.styles) ? (raw.styles as TextRun["styles"]) : {} });
    } else if (raw.type === "link" && typeof raw.href === "string") {
      out.push({ type: "link", href: raw.href, content: tidyInline(raw.content).filter((r): r is TextRun => r.type === "text") });
    }
  }
  return out;
}

function tidyContent(content: unknown): Block["content"] {
  if (Array.isArray(content)) return tidyInline(content);
  if (isObject(content) && content.type === "tableContent" && Array.isArray(content.rows)) {
    const rows = (content.rows as unknown[]).filter(isObject).map((row) => ({
      cells: (Array.isArray(row.cells) ? (row.cells as unknown[]) : []).map((cell): TableCell => {
        // Older documents store a cell as its bare inline content.
        if (Array.isArray(cell)) return { type: "tableCell", content: tidyInline(cell), props: {} };
        const c = isObject(cell) ? cell : {};
        return { type: "tableCell", content: tidyInline(c.content), props: isObject(c.props) ? (c.props as TableCell["props"]) : {} };
      }),
    }));
    return { ...(content as unknown as TableContent), type: "tableContent", rows };
  }
  return undefined;
}

function tidy(input: unknown, depth = 0): Block[] {
  if (!Array.isArray(input) || depth > 50) return [];
  const out: Block[] = [];
  for (const raw of input) {
    if (!isObject(raw) || typeof raw.type !== "string") continue;
    const content = tidyContent(raw.content);
    out.push({
      id: typeof raw.id === "string" ? raw.id : "",
      type: raw.type,
      props: isObject(raw.props) ? raw.props : {},
      ...(content !== undefined ? { content } : {}),
      children: tidy(raw.children, depth + 1),
    });
  }
  return out;
}

export function serializeBlocks(blocks: readonly Block[] | unknown, options: SerializeOptions = {}): SerializeResult {
  const ctx: Ctx = { notes: new Set() };
  const root: Root = { type: "root", children: blocksToMdast(tidy(blocks), ctx) };

  const body = toMarkdown(root, {
    extensions: [gfmToMarkdown(), directiveToMarkdown(), mathToMarkdown()],
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fences: true,
    rule: "-",
    listItemIndent: "one",
    incrementListMarker: true,
    resourceLink: true,
  });

  const head = options.frontMatter ? frontMatterYaml(options.frontMatter) : "";
  // A file that opens with `---` looks like the start of front matter; write a leading divider differently.
  const safeBody = head === "" ? body.replace(/^---(\r?\n|$)/, "***$1") : body;
  return { markdown: head + safeBody, lossy: [...ctx.notes] };
}
