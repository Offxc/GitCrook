import { Fragment } from "react";
import katex from "katex";
import { isHintStyle, resolveEmbed } from "@voiddocs/shared";
import { highlightCode, type CodeThemePair } from "./highlightCode";
import { CodeBlockChrome } from "@/app/(published)/_components/CodeBlockChrome";

/**
 * Read-only renderer for BlockNote's default blocks plus VoidDocs' custom
 * ones (lib/editor/blocks/*, assembled in lib/editor/schema.ts). Duck-types
 * the block shapes (same reasoning as lib/editor/extractText.ts) rather than
 * importing BlockNote's editor types into a route that ships zero editor JS
 * to visitors — every case here must stay in sync with its editor-side block
 * definition.
 */

interface RenderBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RenderBlock[];
}

const DEFAULT_CODE_THEME: CodeThemePair = { light: "github-light", dark: "github-dark" };

export async function BlockNoteRenderer({ content, codeTheme }: { content: unknown; codeTheme?: CodeThemePair }) {
  const blocks = Array.isArray(content) ? (content as RenderBlock[]) : [];
  const codeHtml = await collectHighlightedCode(blocks, codeTheme ?? DEFAULT_CODE_THEME);
  return <div className="prose-content">{renderBlockList(blocks, codeHtml)}</div>;
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

function renderBlockList(blocks: RenderBlock[], codeHtml: Map<string, string>) {
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
      const Tag = groupType === "bulletListItem" ? "ul" : "ol";
      nodes.push(
        <Tag key={`list-${i}`} className={Tag === "ul" ? "mb-4 list-disc pl-6" : "mb-4 list-decimal pl-6"}>
          {group.map((item, idx) => (
            <li key={item.id ?? idx} className="text-[15px] leading-7 text-site-ink">
              {renderInline(item.content)}
              {item.children && item.children.length > 0 ? renderBlockList(item.children, codeHtml) : null}
            </li>
          ))}
        </Tag>,
      );
      continue;
    }
    nodes.push(<Fragment key={block.id ?? i}>{renderBlock(block, codeHtml)}</Fragment>);
    i++;
  }
  return nodes;
}

function renderBlock(block: RenderBlock, codeHtml: Map<string, string>) {
  const props = block.props ?? {};
  switch (block.type) {
    case "heading": {
      const level = Number(props.level) || 2;
      const className = { 1: "text-2xl font-semibold", 2: "text-xl font-semibold", 3: "text-lg font-semibold" }[level] ?? "text-base font-semibold";
      const Tag = (`h${Math.min(level, 6)}` as unknown) as keyof React.JSX.IntrinsicElements;
      return (
        <Tag className={`${className} mb-3 mt-8 text-site-ink first:mt-0`}>
          {renderInline(block.content)}
          {block.children?.length ? renderBlockList(block.children, codeHtml) : null}
        </Tag>
      );
    }
    case "hint": {
      const style = isHintStyle(props.hintStyle) ? props.hintStyle : "info";
      return (
        <div className={`hint-block hint-${style} mb-4 flex gap-2 rounded-lg border px-3.5 py-3`}>
          <span aria-hidden className="hint-dot mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" />
          <p className="hint-text text-[15px] leading-7">{renderInline(block.content)}</p>
        </div>
      );
    }
    case "checkListItem":
      return (
        <div className="mb-2 flex items-start gap-2">
          <input type="checkbox" checked={Boolean(props.checked)} readOnly disabled className="mt-1.5" />
          <p className="text-[15px] leading-7 text-site-ink">{renderInline(block.content)}</p>
        </div>
      );
    case "toggleListItem":
      // GitBook's "Expandable" — collapsed by default, matching GitBook's own
      // stated default behavior. The editor's open/closed state is a
      // per-browser localStorage preference (BlockNote's own ToggleWrapper),
      // not part of the saved document, so a fresh visitor always sees it
      // closed — there's no "expanded by default" prop to read here.
      return (
        <details className="mb-2 rounded-lg border border-site-border px-3.5 py-2.5">
          <summary className="cursor-pointer select-none text-[15px] font-medium text-site-ink">{renderInline(block.content)}</summary>
          {block.children?.length ? <div className="mt-2 pl-1">{renderBlockList(block.children, codeHtml)}</div> : null}
        </details>
      );
    case "columnList":
      return <div className="mb-4 flex flex-col gap-4 sm:flex-row">{block.children?.length ? renderBlockList(block.children, codeHtml) : null}</div>;
    case "column": {
      const width = typeof props.width === "number" ? props.width : 1;
      return (
        <div className="min-w-0" style={{ flex: `${width} 1 0%` }}>
          {block.children?.length ? renderBlockList(block.children, codeHtml) : null}
        </div>
      );
    }
    case "codeBlock": {
      const html = (block.id && codeHtml.get(block.id)) || null;
      const language = typeof props.language === "string" ? props.language : "text";
      return <CodeBlockChrome html={html} code={plainTextOf(block.content)} language={language} />;
    }
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const caption = typeof props.caption === "string" ? props.caption : "";
      if (!url) return null;
      return (
        <figure className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded/embedded image URLs, arbitrary origins */}
          <img src={url} alt={caption} className="rounded-lg" />
          {caption ? <figcaption className="mt-1 text-center text-xs text-site-ink-muted">{caption}</figcaption> : null}
        </figure>
      );
    }
    case "file": {
      const url = typeof props.url === "string" ? props.url : "";
      const name = typeof props.name === "string" && props.name ? props.name : "Download file";
      if (!url) return null;
      return (
        <a href={url} className="mb-4 block rounded-lg border border-site-border px-4 py-3 text-sm text-site-primary hover:underline">
          {name}
        </a>
      );
    }
    case "divider":
      return <hr className="my-6 border-site-border" />;
    case "table":
      return renderTable(block.content);
    case "stepper":
      return <div className="mb-4 flex flex-col gap-4">{block.children?.length ? renderBlockList(block.children, codeHtml) : null}</div>;
    case "step": {
      const index = typeof props.index === "number" ? props.index : 1;
      return (
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-site-surface text-xs font-semibold text-site-ink">
            {index}
          </span>
          <div className="flex-1">
            <p className="font-semibold text-site-ink">{renderInline(block.content)}</p>
            {block.children?.length ? <div className="mt-1">{renderBlockList(block.children, codeHtml)}</div> : null}
          </div>
        </div>
      );
    }
    case "pageLink": {
      const href = typeof props.href === "string" ? props.href : "";
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
      const href = typeof props.href === "string" ? props.href : "";
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
            className="aspect-video w-full rounded-lg border border-site-border"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      );
    }
    case "cardGroup": {
      const isLarge = props.size === "large";
      return (
        <div className={`mb-4 grid gap-3 ${isLarge ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          {block.children?.length ? renderBlockList(block.children, codeHtml) : null}
        </div>
      );
    }
    case "card": {
      const cardHref = typeof props.href === "string" ? props.href : "";
      const cardTitle = typeof props.title === "string" ? props.title : "";
      const cardDescription = typeof props.description === "string" ? props.description : "";
      const cardImage = typeof props.imageUrl === "string" ? props.imageUrl : "";
      const Tag = cardHref ? "a" : "div";
      return (
        <Tag
          {...(cardHref ? { href: cardHref } : {})}
          className="block overflow-hidden rounded-lg border border-site-border transition hover:border-site-primary"
        >
          {cardImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- author-entered cover image URL, arbitrary origin
            <img src={cardImage} alt="" className="aspect-video w-full object-cover" />
          ) : null}
          <div className="p-3">
            {cardTitle ? <p className="text-sm font-semibold text-site-ink">{cardTitle}</p> : null}
            {cardDescription ? <p className="mt-0.5 text-xs text-site-ink-muted">{cardDescription}</p> : null}
          </div>
        </Tag>
      );
    }
    case "updates":
      return <div className="mb-4 flex flex-col gap-6">{block.children?.length ? renderBlockList(block.children, codeHtml) : null}</div>;
    case "update": {
      const date = typeof props.date === "string" ? props.date : "";
      const tags = typeof props.tags === "string" && props.tags ? props.tags.split(",").map((t) => t.trim()) : [];
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
          {block.children?.length ? <div className="mt-1">{renderBlockList(block.children, codeHtml)}</div> : null}
        </div>
      );
    }
    case "paragraph":
    default:
      return (
        <p className="mb-4 text-[15px] leading-7 text-site-ink">
          {renderInline(block.content)}
          {block.children?.length ? renderBlockList(block.children, codeHtml) : null}
        </p>
      );
  }
}

function renderTable(content: unknown) {
  const rows = (content as { rows?: { cells?: unknown[] }[] } | undefined)?.rows;
  if (!Array.isArray(rows)) return null;
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse border border-site-border text-sm">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(row.cells ?? []).map((cell, ci) => (
                <td key={ci} className="border border-site-border px-3 py-2 text-site-ink">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderKatex(formula: string): string {
  try {
    return katex.renderToString(formula || "", { throwOnError: false, displayMode: true });
  } catch {
    return "";
  }
}

function renderInline(content: unknown): React.ReactNode {
  if (!Array.isArray(content)) return null;
  return content.map((item, i) => {
    if (typeof item !== "object" || item === null) return null;
    const it = item as { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown };
    if (it.type === "link") {
      return (
        <a key={i} href={it.href} className="text-site-primary hover:underline">
          {renderInline(it.content)}
        </a>
      );
    }
    const styles = it.styles ?? {};
    let node: React.ReactNode = it.text ?? "";
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
    return <Fragment key={i}>{node}</Fragment>;
  });
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
