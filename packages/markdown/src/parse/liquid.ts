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

const TAG = /^(\s*)\{%-?\s*(\/?[a-zA-Z][\w-]*)\s*([\s\S]*?)\s*-?%\}\s*$/;
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

export interface LiquidOptions {
  diags: Diagnostics;
  resolveInclude?: (path: string) => string | null;
  /** Guards against an include that includes itself. */
  includeDepth?: number;
}

export function hasLiquid(source: string): boolean {
  return /\{%-?\s*\/?[a-zA-Z]/.test(source);
}

export function translateLiquid(source: string, options: LiquidOptions): string {
  const lines = source.split("\n");
  const out: string[] = [];
  const stack: string[] = [];
  let fence: string | null = null;
  let codeTitle: string | null = null;

  const colons = (depth: number) => ":".repeat(Math.max(3, 3 + MAX_DEPTH - depth));

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

    const match = TAG.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const indent = match[1]!;
    const rawName = match[2]!.toLowerCase();
    const closing = rawName.startsWith("/") || rawName.startsWith("end");
    const name = rawName.replace(/^\/|^end/, "");
    const args = parseArgs(match[3] ?? "");

    if (name === "code") {
      if (!closing) codeTitle = args.title ?? null;
      out.push(""); // the wrapper lines vanish; the fenced block inside stays
      continue;
    }

    if (name === "include") {
      const path = (match[3] ?? "").replace(/^["']|["']$/g, "").trim();
      const text = path && options.resolveInclude && (options.includeDepth ?? 0) < 5 ? options.resolveInclude(path) : null;
      if (text === null) {
        options.diags.add("GS-131", `{% include %} of "${path}" could not be resolved${options.resolveInclude ? "" : " (includes are not followed here)"}.`, { start: { line: i + 1 } });
        out.push("");
      } else {
        out.push(translateLiquid(text.replace(/\r\n/g, "\n"), { ...options, includeDepth: (options.includeDepth ?? 0) + 1 }));
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
        out.push(`${indent}${colons(stack.length)}${name}${attrString(args)}`);
        stack.push(name);
      } else {
        const at = stack.lastIndexOf(name);
        if (at === -1) {
          options.diags.add("GS-204", `{% end${name} %} has no matching opening tag.`, { start: { line: i + 1 } });
          out.push("");
        } else {
          // Anything left open inside it is closed first, so the structure stays balanced.
          while (stack.length - 1 > at) {
            stack.pop();
            out.push(`${indent}${colons(stack.length)}`);
          }
          stack.pop();
          out.push(`${indent}${colons(stack.length)}`);
        }
      }
      continue;
    }

    options.diags.add("GS-203", `The GitBook tag {% ${match[2]} %} is not supported; it was removed.`, { start: { line: i + 1 } });
    out.push("");
  }

  while (stack.length > 0) {
    options.diags.add("GS-204", `{% ${stack.pop()} %} was never closed.`, { start: { line: lines.length } });
    out.push(colons(stack.length));
  }
  return out.join("\n");
}
