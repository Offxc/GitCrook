import { Fragment } from "react";
import katex from "katex";
import { anchorMap, isHintStyle, resolveEmbed, safeHref, safeMediaUrl } from "@gitcrook/shared";
import { highlightCode, type CodeThemePair } from "./highlightCode";
import { CodeBlockChrome } from "@/app/(published)/_components/CodeBlockChrome";

/**
 * Read-only renderer for BlockNote's default blocks plus GitCrook's custom
 * ones (lib/editor/blocks/*, assembled in lib/editor/schema.ts). Duck-types
 * the block shapes (same reasoning as lib/editor/extractText.ts) rather than
 * importing BlockNote's editor types into a route that ships zero editor JS
 * to visitors — every case here must stay in sync with its editor-side block
 * definition. renderer.parity.test.ts enforces that: a block type in the schema
 * with no case here fails the build.
 */

export interface RenderBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RenderBlock[];
}

export interface RenderContext {
  /** Pre-highlighted code, by block id (Shiki is async; the renderer itself is not). */
  codeHtml: Map<string, string>;
  /** Heading anchors, by block id; see @gitcrook/shared anchors. */
  anchors: Map<string, string>;
}

const DEFAULT_CODE_THEME: CodeThemePair = { light: "github-light", dark: "github-dark" };

export async function BlockNoteRenderer({ content, codeTheme }: { content: unknown; codeTheme?: CodeThemePair }) {
  const blocks = Array.isArray(content) ? (content as RenderBlock[]) : [];
  const codeHtml = await collectHighlightedCode(blocks, codeTheme ?? DEFAULT_CODE_THEME);
  return <div className="prose-content">{renderBlocks(blocks, { codeHtml, anchors: anchorMap(blocks) })}</div>;
}

/**
 * One pre-pass collects every codeBlock and highlights them all up front
 * (Shiki's codeToHtml is async; the renderer below stays a plain sync
 * function so every other block type — the vast majority — is untouched).
 * Keyed by block.id, which BlockNote always assigns.
 */
async function collectHighlightedCode(blocks: RenderBlock[], theme: CodeThemePair): Promise<Map<string, string>> {
  const pending: { id: string; code: string; language: string }[] = [];
  const walk = (list: RenderBlock[]) => {
    for (const block of list) {
      if (block.type === "codeBlock" && block.id) {
        const language = typeof block.props?.language === "string" ? block.props.language : "text";
        pending.push({ id: block.id, code: plainTextOf(block.content), language });
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  if (pending.length === 0) return new Map();

  const results = await Promise.all(pending.map((p) => highlightCode(p.code, p.language, theme)));
  return new Map(pending.map((p, i) => [p.id, results[i]!]));
}

/** The block types this renderer has a case for. The parity test compares it with the editor schema. */
export const RENDERED_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "quote",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "codeBlock",
  "divider",
  "image",
  "video",
  "audio",
  "file",
  "table",
  "columnList",
  "column",
  "hint",
  "stepper",
  "step",
  "pageLink",
  "math",
  "button",
  "embed",
  "cardGroup",
  "card",
  "updates",
  "update",
] as const;

// ---------------------------------------------------------------------------------------------
// Small helpers shared by the cases below
// ---------------------------------------------------------------------------------------------

const COLORS = new Set(["gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"]);
const colorName = (value: unknown): string | undefined => (typeof value === "string" && COLORS.has(value) ? value : undefined);

type Alignment = "center" | "right" | "justify";
const alignment = (value: unknown): Alignment | undefined => (value === "center" || value === "right" || value === "justify" ? value : undefined);

/** Colour and alignment attributes for a block that has them (see the data-tc / data-bg rules in globals.css). */
function look(props: Record<string, unknown>) {
  const align = alignment(props.textAlignment);
  return {
    "data-tc": colorName(props.textColor),
    "data-bg": colorName(props.backgroundColor),
    style: align ? ({ textAlign: align } as const) : undefined,
  };
}

/** Alignment for something that isn't text (an image, a video): flex placement instead of text-align. */
function placement(value: unknown) {
  const align = alignment(value);
  if (align === "center") return "mx-auto";
  if (align === "right") return "ml-auto";
  return "";
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Block lists
// ---------------------------------------------------------------------------------------------

export function renderBlocks(blocks: RenderBlock[], ctx: RenderContext): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i]!;
    if (block.type === "bulletListItem" || block.type === "numberedListItem") {
      const groupType = block.type;
      const group: RenderBlock[] = [];
      while (i < blocks.length && blocks[i]!.type === groupType) {
        group.push(blocks[i]!);
        i++;
      }
      const ordered = groupType === "numberedListItem";
      const Tag = ordered ? "ol" : "ul";
      const start = ordered ? positiveInt(group[0]!.props?.start) : undefined;
      nodes.push(
        <Tag
          key={`list-${i}`}
          {...(start && start !== 1 ? { start } : {})}
          className={ordered ? "mb-4 list-decimal pl-6" : "mb-4 list-disc pl-6"}
        >
          {group.map((item, idx) => (
            <li key={item.id ?? idx} className="text-[15px] leading-7 text-site-ink" {...look(item.props ?? {})}>
              {renderInline(item.content)}
              {item.children && item.children.length > 0 ? renderBlocks(item.children, ctx) : null}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    nodes.push(<Fragment key={block.id ?? i}>{renderBlock(block, ctx)}</Fragment>);
    i++;
  }
  return nodes;
}

const children = (block: RenderBlock, ctx: RenderContext) => (block.children?.length ? renderBlocks(block.children, ctx) : null);

function renderBlock(block: RenderBlock, ctx: RenderContext): React.ReactNode {
  const props = block.props ?? {};
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(props.level) || 2, 1), 6);
      // One step up across the board — with the page title now at 36px
      // (GitBook's measured size), the old scale left in-content headings
      // barely distinguishable from body copy.
      const className = { 1: "text-[28px] font-bold tracking-tight", 2: "text-2xl font-bold tracking-tight", 3: "text-xl font-semibold" }[level] ?? "text-lg font-semibold";
      const Tag = `h${level}` as "h1";
      const anchor = block.id ? ctx.anchors.get(block.id) : undefined;
      const heading = (
        <Tag id={anchor} className={`${className} mb-3 mt-10 scroll-mt-24 text-site-ink first:mt-0`} {...look(props)}>
          {renderInline(block.content)}
          {anchor ? (
            <a href={`#${anchor}`} className="heading-anchor" aria-label="Link to this section">
              #
            </a>
          ) : null}
        </Tag>
      );
      // A toggleable heading folds its children away; otherwise they follow it as ordinary siblings
      // (never inside the heading element — block content isn't valid there).
      if (props.isToggleable === true) {
        return (
          <details className="group/toggle mb-2">
            <summary className="flex cursor-pointer list-none items-baseline gap-1.5 marker:content-none [&::-webkit-details-marker]:hidden">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 translate-y-0.5 text-site-ink-muted transition group-open/toggle:rotate-90">
                <path d="m9 6 6 6-6 6" />
              </svg>
              {heading}
            </summary>
            {block.children?.length ? <div className="pl-1">{renderBlocks(block.children, ctx)}</div> : null}
          </details>
        );
      }
      return (
        <>
          {heading}
          {block.children?.length ? <div>{renderBlocks(block.children, ctx)}</div> : null}
        </>
      );
    }
    case "quote":
      return (
        <blockquote className="mb-5 border-l-[3px] border-site-border pl-4 text-base leading-7 text-site-ink-muted" {...look(props)}>
          {renderInline(block.content)}
          {block.children?.length ? <div className="mt-2">{renderBlocks(block.children, ctx)}</div> : null}
        </blockquote>
      );
    case "hint": {
      const style = isHintStyle(props.hintStyle) ? props.hintStyle : "info";
      const title = typeof props.hintTitle === "string" ? props.hintTitle.trim() : "";
      return (
        <div className={`hint-block hint-${style} mb-4 overflow-hidden rounded-xl border`}>
          {title ? (
            <p className="hint-header flex items-center gap-2 px-4 py-3 text-sm font-semibold">
              <span className="hint-icon shrink-0">
                <HintIcon style={style} />
              </span>
              {title}
            </p>
          ) : null}
          <div className="flex items-start gap-2.5 px-4 py-3.5">
            {title ? null : (
              <span className="hint-icon mt-0.5 shrink-0">
                <HintIcon style={style} />
              </span>
            )}
            <p className="hint-text text-[15px] leading-7">{renderInline(block.content)}</p>
          </div>
        </div>
      );
    }
    case "checkListItem":
      return (
        <div className="mb-2" {...look(props)}>
          <div className="flex items-start gap-2">
            <input type="checkbox" checked={Boolean(props.checked)} readOnly disabled aria-label={Boolean(props.checked) ? "Done" : "Not done"} className="mt-1.5" />
            <p className="text-[15px] leading-7 text-site-ink">{renderInline(block.content)}</p>
          </div>
          {block.children?.length ? <div className="pl-6">{renderBlocks(block.children, ctx)}</div> : null}
        </div>
      );
    case "toggleListItem":
      // GitBook's "Expandable" — collapsed by default, matching GitBook's own
      // stated default behavior. The editor's open/closed state is a
      // per-browser localStorage preference (BlockNote's own ToggleWrapper),
      // not part of the saved document, so a fresh visitor always sees it
      // closed — there's no "expanded by default" prop to read here.
      return (
        <details className="mb-2 rounded-lg border border-site-border px-3.5 py-2.5" {...look(props)}>
          <summary className="cursor-pointer select-none text-[15px] font-medium text-site-ink">{renderInline(block.content)}</summary>
          {block.children?.length ? <div className="mt-2 pl-1">{renderBlocks(block.children, ctx)}</div> : null}
        </details>
      );
    case "columnList":
      return <div className="mb-4 flex flex-col gap-4 sm:flex-row">{children(block, ctx)}</div>;
    case "column": {
      const width = typeof props.width === "number" ? props.width : 1;
      return (
        <div className="min-w-0" style={{ flex: `${width} 1 0%` }}>
          {children(block, ctx)}
        </div>
      );
    }
    case "codeBlock": {
      const html = (block.id && ctx.codeHtml.get(block.id)) || null;
      const language = typeof props.language === "string" ? props.language : "text";
      return <CodeBlockChrome html={html} code={plainTextOf(block.content)} language={language} />;
    }
    case "image": {
      const url = safeMediaUrl(props.url);
      const caption = typeof props.caption === "string" ? props.caption : "";
      const name = typeof props.name === "string" ? props.name : "";
      if (!url) return null;
      const width = positiveInt(props.previewWidth);
      return (
        <figure className={`mb-4 ${placement(props.textAlignment)}`} style={width ? { width, maxWidth: "100%" } : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded/embedded image URLs, arbitrary origins */}
          <img src={url} alt={caption || name} loading="lazy" decoding="async" className="rounded-lg" />
          {caption ? <figcaption className="mt-1 text-center text-xs text-site-ink-muted">{caption}</figcaption> : null}
        </figure>
      );
    }
    case "video": {
      const url = safeMediaUrl(props.url);
      if (!url) return null;
      const caption = typeof props.caption === "string" ? props.caption : "";
      const width = positiveInt(props.previewWidth);
      return (
        <figure className={`mb-4 ${placement(props.textAlignment)}`} style={width ? { width, maxWidth: "100%" } : undefined}>
          <video controls preload="metadata" src={url} className="w-full rounded-lg">
            <a href={url}>{typeof props.name === "string" && props.name ? props.name : "Download the video"}</a>
          </video>
          {caption ? <figcaption className="mt-1 text-center text-xs text-site-ink-muted">{caption}</figcaption> : null}
        </figure>
      );
    }
    case "audio": {
      const url = safeMediaUrl(props.url);
      if (!url) return null;
      const caption = typeof props.caption === "string" ? props.caption : "";
      return (
        <figure className="mb-4">
          <audio controls preload="metadata" src={url} className="w-full">
            <a href={url}>{typeof props.name === "string" && props.name ? props.name : "Download the audio"}</a>
          </audio>
          {caption ? <figcaption className="mt-1 text-center text-xs text-site-ink-muted">{caption}</figcaption> : null}
        </figure>
      );
    }
    case "file": {
      const url = safeHref(props.url);
      const name = typeof props.name === "string" && props.name ? props.name : "Download file";
      const caption = typeof props.caption === "string" ? props.caption : "";
      if (!url) return null;
      return (
        <a href={url} className="mb-4 block rounded-lg border border-site-border px-4 py-3 text-sm text-site-primary hover:underline">
          {name}
          {caption ? <span className="mt-0.5 block text-xs text-site-ink-muted">{caption}</span> : null}
        </a>
      );
    }
    case "divider":
      return <hr className="my-6 border-site-border" />;
    case "table":
      return renderTable(block.content);
    case "stepper":
      return <div className="mb-4 flex flex-col gap-4">{children(block, ctx)}</div>;
    case "step": {
      const index = typeof props.index === "number" ? props.index : 1;
      return (
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-site-primary text-xs font-semibold text-white">
            {index}
          </span>
          <div className="flex-1">
            <p className="font-semibold text-site-ink">{renderInline(block.content)}</p>
            {block.children?.length ? <div className="mt-1">{renderBlocks(block.children, ctx)}</div> : null}
          </div>
        </div>
      );
    }
    case "pageLink": {
      const href = safeHref(props.href);
      const title = typeof props.title === "string" && props.title ? props.title : href;
      const description = typeof props.description === "string" ? props.description : "";
      if (!href) return null;
      return (
        <a href={href} className="mb-4 block rounded-lg border border-site-border px-4 py-3 transition hover:border-site-primary">
          <p className="text-sm font-medium text-site-ink">{title}</p>
          {description ? <p className="mt-0.5 text-xs text-site-ink-muted">{description}</p> : null}
        </a>
      );
    }
    case "math": {
      const formula = typeof props.formula === "string" ? props.formula : "";
      const html = renderKatex(formula);
      return <div className="mb-4 overflow-x-auto py-2 text-center text-site-ink" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case "button": {
      const href = safeHref(props.href);
      const label = typeof props.label === "string" && props.label ? props.label : "Button";
      const isPrimary = props.style !== "secondary";
      if (!href) return null;
      return (
        <a
          href={href}
          className={
            isPrimary
              ? "mb-4 inline-block rounded-md bg-site-primary px-4 py-2 text-sm font-medium text-white no-underline"
              : "mb-4 inline-block rounded-md border border-site-primary px-4 py-2 text-sm font-medium text-site-primary no-underline"
          }
        >
          {label}
        </a>
      );
    }
    case "embed": {
      const url = typeof props.url === "string" ? props.url : "";
      const match = url ? resolveEmbed(url) : null;
      if (!match) return null;
      return (
        <div className="mb-4">
          <iframe
            src={match.embedUrl}
            title={typeof props.title === "string" && props.title ? props.title : "Embedded content"}
            className="aspect-video w-full rounded-lg border border-site-border"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      );
    }
    case "cardGroup": {
      const isLarge = props.size === "large";
      return <div className={`mb-4 grid gap-3 ${isLarge ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>{children(block, ctx)}</div>;
    }
    case "card": {
      const cardHref = safeHref(props.href);
      const cardTitle = typeof props.title === "string" ? props.title : "";
      const cardDescription = typeof props.description === "string" ? props.description : "";
      const cardImage = safeMediaUrl(props.imageUrl);
      const Tag = cardHref ? "a" : "div";
      return (
        <Tag
          {...(cardHref ? { href: cardHref } : {})}
          className="block overflow-hidden rounded-lg border border-site-border transition hover:border-site-primary"
        >
          {cardImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- author-entered cover image URL, arbitrary origin
            <img src={cardImage} alt="" loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
          ) : null}
          <div className="p-3">
            {cardTitle ? <p className="text-sm font-semibold text-site-ink">{cardTitle}</p> : null}
            {cardDescription ? <p className="mt-0.5 text-xs text-site-ink-muted">{cardDescription}</p> : null}
          </div>
        </Tag>
      );
    }
    case "updates":
      return <div className="mb-4 flex flex-col gap-6">{children(block, ctx)}</div>;
    case "update": {
      const date = typeof props.date === "string" ? props.date : "";
      const tags = typeof props.tags === "string" && props.tags ? props.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      return (
        <div className="border-l-2 border-site-border pl-4">
          <div className="mb-1 flex items-center gap-2">
            {date ? <span className="text-xs text-site-ink-muted">{date}</span> : null}
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-site-surface px-2 py-0.5 text-[10px] text-site-ink-muted">
                {tag}
              </span>
            ))}
          </div>
          <p className="font-semibold text-site-ink">{renderInline(block.content)}</p>
          {block.children?.length ? <div className="mt-1">{renderBlocks(block.children, ctx)}</div> : null}
        </div>
      );
    }
    case "paragraph":
      return (
        <>
          <p className="mb-5 text-base leading-7 text-site-ink" {...look(props)}>
            {renderInline(block.content)}
          </p>
          {block.children?.length ? <div className="pl-6">{renderBlocks(block.children, ctx)}</div> : null}
        </>
      );
    default:
      // A block type this renderer has never heard of. If it carries inline text, show that rather
      // than dropping the words; if it is a leaf with nothing to show, render nothing.
      return Array.isArray(block.content) && block.content.length > 0 ? (
        <p className="mb-5 text-base leading-7 text-site-ink">{renderInline(block.content)}</p>
      ) : null;
  }
}

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

interface TableCell {
  content?: unknown;
  props?: Record<string, unknown>;
}

interface TableContent {
  columnWidths?: (number | null | undefined)[];
  headerRows?: number;
  headerCols?: number;
  rows?: { cells?: unknown[] }[];
}

function renderTable(content: unknown) {
  const table = (content ?? {}) as TableContent;
  const rows = table.rows;
  if (!Array.isArray(rows)) return null;

  const headerRows = Math.max(0, Math.min(Number(table.headerRows) || 0, rows.length));
  const headerCols = Math.max(0, Number(table.headerCols) || 0);
  const widths = Array.isArray(table.columnWidths) ? table.columnWidths : [];
  const hasWidths = widths.some((w) => typeof w === "number" && w > 0);

  const renderRow = (row: { cells?: unknown[] }, ri: number) => (
    <tr key={ri}>
      {(row.cells ?? []).map((cell, ci) => {
        const cellProps = ((cell as TableCell | null)?.props ?? {}) as Record<string, unknown>;
        const isHead = ri < headerRows || ci < headerCols;
        const Cell = isHead ? "th" : "td";
        const colSpan = positiveInt(cellProps.colspan);
        const rowSpan = positiveInt(cellProps.rowspan);
        return (
          <Cell
            key={ci}
            {...(isHead ? { scope: ri < headerRows ? "col" : "row" } : {})}
            {...(colSpan && colSpan > 1 ? { colSpan } : {})}
            {...(rowSpan && rowSpan > 1 ? { rowSpan } : {})}
            className={`border border-site-border px-3 py-2 align-top text-site-ink ${isHead ? "bg-site-surface text-left font-semibold" : ""}`}
            {...look(cellProps)}
          >
            {renderInline(tableCellContent(cell))}
          </Cell>
        );
      })}
    </tr>
  );

  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse border border-site-border text-sm">
        {hasWidths ? (
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={typeof w === "number" && w > 0 ? { width: `${w}px` } : undefined} />
            ))}
          </colgroup>
        ) : null}
        {headerRows > 0 ? <thead>{rows.slice(0, headerRows).map((row, ri) => renderRow(row, ri))}</thead> : null}
        <tbody>{rows.slice(headerRows).map((row, ri) => renderRow(row, ri + headerRows))}</tbody>
      </table>
    </div>
  );
}

// A real BlockNote table cell is { type: "tableCell", content: Inline[], props }
// — renderInline only accepts a bare Inline[], so unwrap it here. Also
// accepts a bare array directly (the shape hand-written content used before
// this was found to be wrong), so already-saved pages using either shape
// keep rendering.
function tableCellContent(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell;
  if (cell && typeof cell === "object" && "content" in cell) return (cell as { content?: unknown }).content;
  return cell;
}

function renderKatex(formula: string): string {
  try {
    return katex.renderToString(formula || "", { throwOnError: false, displayMode: true });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------------------------

/** Text with its newlines kept: a hard break typed in the editor (Shift+Enter) is a "\n" in the text. */
function textWithBreaks(text: string): React.ReactNode {
  if (!text.includes("\n")) return text;
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

function renderInline(content: unknown): React.ReactNode {
  if (!Array.isArray(content)) return null;
  return content.map((item, i) => {
    if (typeof item !== "object" || item === null) return null;
    const it = item as { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown };
    if (it.type === "link") {
      const href = safeHref(it.href);
      // A link whose target was refused still shows its words, just not as a link.
      return href ? (
        <a key={i} href={href} className="text-site-primary hover:underline">
          {renderInline(it.content)}
        </a>
      ) : (
        <Fragment key={i}>{renderInline(it.content)}</Fragment>
      );
    }
    const styles = it.styles ?? {};
    let node: React.ReactNode = textWithBreaks(it.text ?? "");
    if (styles.code)
      node = (
        <code className="rounded bg-site-surface px-1 py-0.5 text-[0.9em]" style={{ fontFamily: "var(--site-font-mono)" }}>
          {node}
        </code>
      );
    if (styles.bold) node = <strong>{node}</strong>;
    if (styles.italic) node = <em>{node}</em>;
    if (styles.strike) node = <s>{node}</s>;
    if (styles.underline) node = <u>{node}</u>;
    const tc = colorName(styles.textColor);
    const bg = colorName(styles.backgroundColor);
    if (tc || bg) {
      node = (
        <span data-tc={tc} data-bg={bg}>
          {node}
        </span>
      );
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

/** One glyph per hint style, matching what a reader expects from the semantic colour (a triangle for warning/danger, a circled "i" for info, a tick for success). */
function HintIcon({ style }: { style: "info" | "success" | "warning" | "danger" }) {
  const common = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (style === "warning" || style === "danger") {
    return (
      <svg {...common}>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  if (style === "success") {
    return (
      <svg {...common}>
        <path d="M21.8 10A10 10 0 1 1 15.9 2.6" />
        <path d="m9 11 3 3L22 4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function plainTextOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === "object" && item !== null && "text" in item ? String((item as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}
