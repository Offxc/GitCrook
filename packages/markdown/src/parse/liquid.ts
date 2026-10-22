import type { Diagnostics } from "../diagnostics";

/**
 * GitBook writes its own blocks as Liquid-style tags:
 *
 *   {% hint style="info" %}
 *   Text
 *   {% endhint %}
 *
 * Repositories synced from GitBook are full of them, so we read them. Before the Markdown is parsed, each tag
 * line is rewritten to the directive syntax the rest of the parser already understands (`:::hint{style="info"}`).
 * Lines are kept one-to-one wherever possible, so diagnostics still point at the right line of the original.
 * We never write this syntax; the serializer always emits the directive form.
 */

/** The longest line that is read as a tag. A real tag is a few dozen characters; a longer "tag" is hostile or is prose. */
const MAX_TAG_LINE = 2_000;
const TAG_NAME = /^\/?[a-zA-Z][\w-]*/;

interface Tag {
  indent: string;
  name: string;
  args: string;
}

/**
 * `  {% name args %}` → its parts, or null if the line is not a tag. Written by hand because the one-regex form of this
 * (nested `\s*` and a lazy group around the same characters) takes time cubic in the line's length to *fail* on a
 * line like `{% a` followed by thousands of spaces.
 */
function matchTag(line: string): Tag | null {
  if (line.length > MAX_TAG_LINE) return null;
  const body = line.trim();
  if (!body.startsWith("{%") || !body.endsWith("%}") || body.length < 4) return null;
  const indent = line.slice(0, line.length - line.trimStart().length);
  let inner = body.slice(2, -2);
  if (inner.startsWith("-")) inner = inner.slice(1);
  if (inner.endsWith("-")) inner = inner.slice(0, -1);
  inner = inner.trim();
  const name = TAG_NAME.exec(inner)?.[0];
  if (!name) return null;
  return { indent, name, args: inner.slice(name.length).trim() };
}

const FENCE = /^\s*(`{3,}|~{3,})/;

/** Nested containers need fewer colons than the ones around them, so outer levels start high. */
const MAX_DEPTH = 8;

const CONTAINERS = new Set(["hint", "tabs", "tab", "stepper", "step", "columns", "column", "updates", "update"]);

function parseArgs(raw: string): Record<string, string> {
  const args: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g)) args[m[1]!] = m[2] ?? m[3] ?? m[4] ?? "";
  return args;
}

const quote = (v: string) => `"${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
const attrString = (args: Record<string, string>, keep?: string[]) => {
  const parts = Object.entries(args)
    .filter(([k]) => !keep || keep.includes(k))
    .map(([k, v]) => `${k}=${quote(v)}`);
  return parts.length ? `{${parts.join(" ")}}` : "";
};

/** What every include in one page may add up to. Includes nest, so without a shared limit a few small files multiply. */
const MAX_INCLUDES = 200;
const MAX_INCLUDED_CHARS = 1_000_000;

interface IncludeBudget {
  includes: number;
  chars: number;
  reported: boolean;
}

export interface LiquidOptions {
  diags: Diagnostics;
  resolveInclude?: (path: string) => string | null;
  /** Guards against an include that includes itself. */
  includeDepth?: number;
  /** Shared by an include and everything it includes; made by the outermost call. */
  budget?: IncludeBudget;
}

export function hasLiquid(source: string): boolean {
  return /\{%-?\s*\/?[a-zA-Z]/.test(source);
}

interface Open {
  name: string;
  /** False for a container nested deeper than is kept: its tags are removed, but its closing tag must still match it. */
  real: boolean;
}

export function translateLiquid(source: string, options: LiquidOptions): string {
  const lines = source.split("\n");
  const out: string[] = [];
  const stack: Open[] = [];
  const budget: IncludeBudget = options.budget ?? { includes: MAX_INCLUDES, chars: MAX_INCLUDED_CHARS, reported: false };
  let fence: string | null = null;
  let codeTitle: string | null = null;

  const colons = (depth: number) => ":".repeat(Math.max(3, 3 + MAX_DEPTH - depth));
  const realDepth = () => stack.reduce((n, o) => n + (o.real ? 1 : 0), 0);
  /** Closes the innermost open container, if it is one that was written out. */
  const closeTop = (indent: string) => {
    const top = stack.pop()!;
    out.push(top.real ? `${indent}${colons(realDepth())}` : "");
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) {
        fence = marker[0]!.repeat(3);
        // A pending {% code title="…" %} attaches to the fence that follows it.
        out.push(codeTitle !== null ? `${line.trimEnd()} title=${quote(codeTitle)}` : line);
        codeTitle = null;
      } else {
        if (marker[0] === fence[0]) fence = null;
        out.push(line);
      }
      continue;
    }
    if (fence !== null) {
      out.push(line);
      continue;
    }

    const match = matchTag(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const indent = match.indent;
    const rawName = match.name.toLowerCase();
    const closing = rawName.startsWith("/") || rawName.startsWith("end");
    const name = rawName.replace(/^\/|^end/, "");
    const args = parseArgs(match.args);

    if (name === "code") {
      if (!closing) codeTitle = args.title ?? null;
      out.push(""); // the wrapper lines vanish; the fenced block inside stays
      continue;
    }

    if (name === "include") {
      const path = match.args.replace(/^["']|["']$/g, "").trim();
      if (budget.includes <= 0 || budget.chars <= 0) {
        if (!budget.reported) {
          budget.reported = true;
          options.diags.add("GS-207", `This page includes too much: the includes add up to more than ${MAX_INCLUDES} files or ${MAX_INCLUDED_CHARS} characters, so the rest were skipped.`, { start: { line: i + 1 } });
        }
        out.push("");
        continue;
      }
      const text = path && options.resolveInclude && (options.includeDepth ?? 0) < 5 ? options.resolveInclude(path) : null;
      if (text === null) {
        options.diags.add("GS-131", `{% include %} of "${path}" could not be resolved${options.resolveInclude ? "" : " (includes are not followed here)"}.`, { start: { line: i + 1 } });
        out.push("");
      } else {
        budget.includes--;
        budget.chars -= text.length;
        out.push(translateLiquid(text.replace(/\r\n/g, "\n"), { ...options, budget, includeDepth: (options.includeDepth ?? 0) + 1 }));
      }
      continue;
    }

    if (name === "file") {
      out.push(`${indent}::file${attrString(args, ["src", "name", "caption"])}`);
      continue;
    }
    if (name === "embed") {
      out.push(`${indent}::embed${attrString(args, ["url"])}`);
      continue;
    }
    if (name === "content-ref" && !closing) {
      // {% content-ref url="page.md" %}\n[Title](page.md)\n{% endcontent-ref %}
      let j = i + 1;
      let title = "";
      while (j < lines.length && !/\{%-?\s*\/?end?content-ref/.test(lines[j]!)) {
        const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(lines[j]!);
        if (link && !title) title = link[1]!;
        j++;
      }
      out.push(`${indent}::page-link${attrString({ href: args.url ?? "", ...(title ? { title } : {}) })}`);
      for (let k = i + 1; k <= j && k < lines.length; k++) out.push("");
      i = j;
      continue;
    }

    if (CONTAINERS.has(name)) {
      if (!closing) {
        const depth = realDepth();
        if (depth >= MAX_DEPTH) {
          options.diags.add("GS-207", `{% ${name} %} is nested more than ${MAX_DEPTH} levels deep; it was removed.`, { start: { line: i + 1 } });
          stack.push({ name, real: false });
          out.push("");
        } else {
          out.push(`${indent}${colons(depth)}${name}${attrString(args)}`);
          stack.push({ name, real: true });
        }
      } else {
        const at = stack.map((o) => o.name).lastIndexOf(name);
        if (at === -1) {
          options.diags.add("GS-204", `{% end${name} %} has no matching opening tag.`, { start: { line: i + 1 } });
          out.push("");
        } else {
          // Anything left open inside it is closed first, so the structure stays balanced.
          while (stack.length - 1 > at) closeTop(indent);
          closeTop(indent);
        }
      }
      continue;
    }

    options.diags.add("GS-203", `The GitBook tag {% ${match.name} %} is not supported; it was removed.`, { start: { line: i + 1 } });
    out.push("");
  }

  while (stack.length > 0) {
    options.diags.add("GS-204", `{% ${stack[stack.length - 1]!.name} %} was never closed.`, { start: { line: lines.length } });
    closeTop("");
  }
  return out.join("\n");
}
