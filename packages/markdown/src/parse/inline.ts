import type { Definition, PhrasingContent, Text } from "mdast";
import { safeHref } from "@gitcrook/shared";
import type { Diagnostics } from "../diagnostics";
import type { Inline, LinkRun, Styles, TextRun } from "../types";

/** Compares two style sets irrespective of key order. */
export function sameStyles(a: Styles, b: Styles): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Styles>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Joins neighbouring runs that look the same and drops empty ones. The editor does the same, and the round trip depends on it. */
export function normalizeInline(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const run of runs) {
    if (run.type === "text") {
      if (run.text === "") continue;
      const last = out.at(-1);
      if (last?.type === "text" && sameStyles(last.styles, run.styles)) last.text += run.text;
      else out.push({ type: "text", text: run.text, styles: { ...run.styles } });
    } else {
      const content = normalizeInline(run.content) as TextRun[];
      if (content.length === 0) continue;
      const last = out.at(-1);
      if (last?.type === "link" && last.href === run.href) last.content = normalizeInline([...last.content, ...content]) as TextRun[];
      else out.push({ type: "link", href: run.href, content });
    }
  }
  return out;
}

/** A soft line break inside a paragraph is a space, as in HTML; only an explicit break is a newline. */
const softBreaksToSpaces = (text: string) => text.replace(/[ \t]*\r?\n[ \t]*/g, " ");

interface InlineContext {
  diags: Diagnostics;
  /** The document text, so an inline directive we don't know can be shown exactly as it was written. */
  source?: string;
  /** `[label]: url` definitions in the document, so `[text][label]` becomes the link it was meant to be. */
  definitions?: Map<string, Definition>;
}

const TAG = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>$/;

/** Inline HTML we understand: `<br>`, `<u>`, and tags that only affect presentation (dropped with a note). */
function inlineHtml(value: string, state: { underline: number }, ctx: InlineContext, position: Text["position"]): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("<!--")) return ""; // a comment: nothing to show, nothing to warn about
  const match = TAG.exec(trimmed);
  if (!match) {
    ctx.diags.add("GS-204", "Inline HTML was removed.", position);
    return "";
  }
  const closing = match[1] === "/";
  const tag = match[2]!.toLowerCase();
  switch (tag) {
    case "br":
      return "\n";
    case "u":
      state.underline = Math.max(0, state.underline + (closing ? -1 : 1));
      return "";
    case "kbd":
    case "mark":
    case "span":
    case "b":
    case "i":
    case "em":
    case "strong":
    case "sub":
    case "sup":
    case "small":
    case "abbr":
    case "a":
    case "wbr":
      // Their text is kept; the presentation isn't representable, which is worth a quiet note.
      if (!closing && (tag === "sub" || tag === "sup" || tag === "mark" || tag === "kbd")) ctx.diags.add("GS-201", `<${tag}> formatting was simplified to plain text.`, position);
      return "";
    default:
      ctx.diags.add("GS-204", `<${tag}> is not allowed and was removed.`, position);
      return "";
  }
}

const NAMED_REFERENCES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: "\u00a0" };

/**
 * Markdown source → the text it stands for, for the places where a slice of the source is shown as written: a
 * backslash escape (`\~`) and a character reference (`&lt;`) are each read once, so `\&lt;` stays the literal `&lt;`.
 */
function unescapeSource(source: string): string {
  return source.replace(/\\([!-/:-@[-`{-~])|&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z]+));/g, (whole, escaped?: string, hex?: string, dec?: string, name?: string) => {
    if (escaped !== undefined) return escaped;
    const code = hex !== undefined ? parseInt(hex, 16) : dec !== undefined ? parseInt(dec, 10) : undefined;
    if (code !== undefined) return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
    return NAMED_REFERENCES[name!] ?? whole;
  });
}

export interface ImageRef {
  url: string;
  alt: string;
  title: string | null;
}

/**
 * Phrasing content → inline runs. An image inside a sentence becomes its alt text (an image that is the
 * whole paragraph is handled earlier, as a block).
 */
export function phrasingToInline(nodes: PhrasingContent[], ctx: InlineContext): Inline[] {
  const out: Inline[] = [];
  const state = { underline: 0 };

  const emit = (sink: Inline[], text: string, styles: Styles) => {
    if (state.underline > 0) styles = { ...styles, underline: true };
    // `{ bold: undefined }` and `{}` are the same style set, and JSON would keep the former.
    const clean: Styles = {};
    for (const [k, v] of Object.entries(styles)) if (v !== undefined && v !== false) (clean as Record<string, unknown>)[k] = v;
    sink.push({ type: "text", text, styles: clean });
  };

  const walk = (node: PhrasingContent, styles: Styles, sink: Inline[], inLink: boolean) => {
    switch (node.type) {
      case "text":
        emit(sink, softBreaksToSpaces(node.value), styles);
        return;
      case "strong":
        for (const child of node.children) walk(child, { ...styles, bold: true }, sink, inLink);
        return;
      case "emphasis":
        for (const child of node.children) walk(child, { ...styles, italic: true }, sink, inLink);
        return;
      case "delete":
        for (const child of node.children) walk(child, { ...styles, strike: true }, sink, inLink);
        return;
      case "inlineCode":
        emit(sink, node.value, { ...styles, code: true });
        return;
      case "break":
        emit(sink, "\n", styles);
        return;
      case "link": {
        // A bare `a@b.co` or `https://…` is turned into a link by the autolink extension, and so is one that
        // was written with an escape (`a\@b.co`), but only the latter has no source position. Writing the
        // escape is how a document says "this is text", so that is how it is read.
        const only = node.children.length === 1 ? node.children[0] : undefined;
        if (!node.position && only?.type === "text" && /^(mailto:|https?:\/\/)?/.test(node.url) && node.url.replace(/^mailto:/, "").endsWith(only.value.replace(/^https?:\/\//, ""))) {
          emit(sink, only.value, styles);
          return;
        }
        const href = safeHref(node.url);
        if (!href) {
          ctx.diags.add("GS-132", `Link target "${node.url}" is not allowed; the link text was kept.`, node.position);
          for (const child of node.children) walk(child, styles, sink, inLink);
          return;
        }
        const runs: Inline[] = [];
        for (const child of node.children) walk(child, styles, runs, true);
        const textRuns = runs.filter((r): r is TextRun => r.type === "text");
        // A link never nests inside another, so there is nothing to wrap when we are already inside one.
        if (inLink) sink.push(...textRuns);
        else sink.push({ type: "link", href, content: textRuns } satisfies LinkRun);
        return;
      }
      case "image":
        if (node.alt) emit(sink, node.alt, styles);
        return;
      case "html": {
        const text = inlineHtml(node.value, state, ctx, node.position);
        if (text) emit(sink, text, styles);
        return;
      }
      case "linkReference": {
        const definition = ctx.definitions?.get(node.identifier);
        if (definition) {
          walk({ type: "link", url: definition.url, title: definition.title, children: node.children, position: node.position }, styles, sink, inLink);
          return;
        }
        // A reference whose definition is missing is just text that happens to look like a link.
        emit(sink, `[${node.children.map((c) => (c.type === "text" ? c.value : "")).join("")}]`, styles);
        return;
      }
      case "imageReference": {
        const definition = ctx.definitions?.get(node.identifier);
        if (definition && node.alt) emit(sink, node.alt, styles);
        else emit(sink, `[${node.alt ?? ""}]`, styles);
        return;
      }
      case "footnoteReference":
        emit(sink, `[${node.label ?? node.identifier}]`, styles);
        return;
      case "textDirective": {
        ctx.diags.add("GS-203", `Inline directive ":${node.name}" is not supported here; it is shown as text.`, node.position);
        const { start, end } = node.position ?? {};
        const written = ctx.source !== undefined && start?.offset !== undefined && end?.offset !== undefined ? unescapeSource(ctx.source.slice(start.offset, end.offset)) : null;
        emit(sink, written ?? `:${node.name}`, styles);
        return;
      }
      default:
        return;
    }
  };

  for (const node of nodes) walk(node, {}, out, false);
  return normalizeInline(out);
}

/** Plain text of some inline content, for titles, labels and attribute values. */
export function inlineToPlainText(runs: readonly Inline[] | undefined): string {
  if (!runs) return "";
  return runs.map((r) => (r.type === "text" ? r.text : inlineToPlainText(r.content))).join("");
}

/** Whether a paragraph's children are nothing but images (and whitespace), and if so which. */
export function onlyImages(nodes: PhrasingContent[]): ImageRef[] | null {
  const images: ImageRef[] = [];
  for (const node of nodes) {
    if (node.type === "image") images.push({ url: node.url, alt: node.alt ?? "", title: node.title ?? null });
    else if (node.type === "text" && node.value.trim() === "") continue;
    else if (node.type === "break") continue;
    else return null;
  }
  return images.length > 0 ? images : null;
}
