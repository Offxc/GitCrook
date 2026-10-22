import type { PhrasingContent } from "mdast";
import type { Inline, Styles, TextRun } from "../types";

/**
 * Inline runs → Markdown phrasing nodes.
 *
 * Runs that share a style are grouped under one node (`**bold _and italic_**`, not `**bold**_**and
 * italic**_`), always in the same nesting order, so equivalent documents serialise identically and what
 * we write reads back as the same runs. Whitespace at the edge of a styled span is moved outside it,
 * because `**word **` is not bold in Markdown.
 */

/** Outermost first. */
const ORDER = ["underline", "strike", "bold", "italic"] as const;
type Wrapper = (typeof ORDER)[number];

const WRAPPERS: Record<Wrapper, (children: PhrasingContent[]) => PhrasingContent[]> = {
  underline: (children) => [{ type: "html", value: "<u>" }, ...children, { type: "html", value: "</u>" }],
  strike: (children) => [{ type: "delete", children }],
  bold: (children) => [{ type: "strong", children }],
  italic: (children) => [{ type: "emphasis", children }],
};

function leaf(run: TextRun, inTable: boolean): PhrasingContent[] {
  if (run.styles.code) return [{ type: "inlineCode", value: run.text.replace(/\n/g, " ") }];
  const parts = run.text.split("\n");
  const out: PhrasingContent[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(inTable ? { type: "html", value: "<br>" } : { type: "break" });
    out.push(...escapeAngles(part));
  });
  return out;
}

/**
 * A `<` that is followed by something other than whitespace can open an HTML tag or an autolink (`<a@b>`), and the
 * Markdown writer doesn't escape every form of that. A character reference always reads back as the plain `<`.
 */
function escapeAngles(text: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let rest = text;
  for (let m = /<(?=\S)/.exec(rest); m; m = /<(?=\S)/.exec(rest)) {
    if (m.index > 0) out.push({ type: "text", value: rest.slice(0, m.index) });
    out.push({ type: "html", value: "&lt;" });
    rest = rest.slice(m.index + 1);
  }
  if (rest) out.push({ type: "text", value: rest });
  return out;
}

function group(runs: TextRun[], from: number, inTable: boolean, used: Set<Wrapper>): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let i = 0;
  while (i < runs.length) {
    const run = runs[i]!;
    // The outermost wrapper (in ORDER) that this run has and that isn't already open around us.
    const wrapper = ORDER.slice(from).find((w) => run.styles[w] && !used.has(w));
    if (!wrapper) {
      out.push(...leaf(run, inTable));
      i++;
      continue;
    }
    // Take every following run that shares it.
    let j = i;
    while (j < runs.length && runs[j]!.styles[wrapper]) j++;
    const span = runs.slice(i, j);
    const inner = group(span, ORDER.indexOf(wrapper) + 1, inTable, new Set([...used, wrapper]));
    out.push(...hoistEdgeWhitespace(wrapper, inner));
    i = j;
  }
  return out;
}

/** `**word **` doesn't parse as bold; `**word** ` does. */
function hoistEdgeWhitespace(wrapper: Wrapper, children: PhrasingContent[]): PhrasingContent[] {
  if (wrapper === "underline") return WRAPPERS.underline(children);
  const before: PhrasingContent[] = [];
  const after: PhrasingContent[] = [];
  const first = children[0];
  if (first?.type === "text") {
    const lead = /^\s+/.exec(first.value)?.[0];
    if (lead) {
      before.push({ type: "text", value: lead });
      first.value = first.value.slice(lead.length);
      if (first.value === "") children.shift();
    }
  }
  const last = children.at(-1);
  if (last?.type === "text") {
    const trail = /\s+$/.exec(last.value)?.[0];
    if (trail) {
      after.push({ type: "text", value: trail });
      last.value = last.value.slice(0, -trail.length);
      if (last.value === "") children.pop();
    }
  }
  if (children.length === 0) return [...before, ...after];
  return [...before, ...WRAPPERS[wrapper](children), ...after];
}

export function inlineToMdast(content: readonly Inline[] | undefined, inTable = false, notes?: Set<string>): PhrasingContent[] {
  if (!content) return [];
  const out: PhrasingContent[] = [];
  let pending: TextRun[] = [];
  const flush = () => {
    if (pending.length) out.push(...group(pending, 0, inTable, new Set()));
    pending = [];
  };

  for (const run of content) {
    if (run.type === "text") {
      if ((run.styles as Styles).textColor || (run.styles as Styles).backgroundColor) notes?.add("Text and background colours are not part of Markdown and were dropped.");
      pending.push(run);
    } else {
      flush();
      out.push({ type: "link", url: run.href, title: null, children: group(run.content, 0, inTable, new Set()) });
    }
  }
  flush();
  return out;
}

export function plainText(content: readonly Inline[] | undefined): string {
  if (!content) return "";
  return content.map((r) => (r.type === "text" ? r.text : plainText(r.content))).join("");
}

/** True when the runs carry no formatting a plain attribute value would lose. */
export function isPlain(content: readonly Inline[] | undefined): boolean {
  return !content || content.every((r) => r.type === "text" && Object.keys(r.styles).length === 0 && !r.text.includes("\n"));
}
