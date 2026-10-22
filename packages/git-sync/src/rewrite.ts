import { resolveRepoLink, type Block, type DiagnosticCode, type Inline } from "@gitcrook/markdown";

/**
 * A page written in a repository points at its neighbours by file (`./install.md`, `../img/a.png`). On the site those
 * must become URLs: other pages by a path relative to this page's own, which keeps working on the platform's
 * `/<site>/…` addresses and on a custom domain alike, and assets by the address they were imported to.
 *
 * This module only rewrites; it does not know where anything lives. The caller says, for each repository path
 * a page refers to, what it is now.
 */

export type Target =
  /** A page: the URL path segments that reach it. */
  | { kind: "page"; segments: readonly string[] }
  /** An imported file: the URL to put in `src`/`href`. */
  | { kind: "asset"; url: string };

export interface Problem {
  code: DiagnosticCode;
  message: string;
}

export interface RewriteInput {
  /** The file the blocks were read from. */
  fromPath: string;
  /** The URL segments of the page being written. */
  pageSegments: readonly string[];
  /** What a repository path is now, or undefined if nothing there is published. */
  lookup: (repoPath: string) => Target | undefined;
}

export interface RewriteResult {
  blocks: Block[];
  /** Repository paths of other pages this one links to (existing or not): when one of them moves, this page is rewritten. */
  pageLinks: string[];
  /** Repository paths of assets this page uses. */
  assets: string[];
  problems: Problem[];
}

/** The props that hold a URL: media sources, and where a button, card or page link goes. */
const REWRITTEN_PROPS = new Set(["url", "imageUrl", "href"]);

/** Splits `path/to.md#heading?x=1` into the path and the `#…`/`?…` tail. */
function splitTail(value: string): [string, string] {
  const i = value.search(/[?#]/);
  return i === -1 ? [value, ""] : [value.slice(0, i), value.slice(i)];
}

/** The URL of `target` as seen from `from`, both being path segments of pages. No trailing slash, as everywhere on the site. */
export function relativeUrl(from: readonly string[], target: readonly string[]): string {
  const fromDir = from.slice(0, -1);
  const targetDir = target.slice(0, -1);
  let common = 0;
  while (common < fromDir.length && common < targetDir.length && fromDir[common] === targetDir[common]) common++;
  const up = fromDir.length - common;
  const rest = target.slice(common);
  if (up === 0 && rest.length > 0 && rest.length === 1) return rest[0]!;
  const parts = [...Array<string>(up).fill(".."), ...rest];
  return parts.length === 0 ? "." : parts.join("/");
}

export function rewriteBlocks(blocks: readonly Block[], input: RewriteInput): RewriteResult {
  const pageLinks = new Set<string>();
  const assets = new Set<string>();
  const problems: Problem[] = [];
  const seenProblems = new Set<string>();
  const report = (code: DiagnosticCode, message: string) => {
    if (seenProblems.has(message)) return;
    seenProblems.add(message);
    problems.push({ code, message });
  };

  /** The new value for a link or media reference, or null to leave it as written. */
  const rewrite = (value: string): string | null => {
    const resolved = resolveRepoLink(input.fromPath, value);
    if (resolved === null) return null; // external, an anchor on this page, or not a path at all
    if ("escapes" in resolved) {
      report("GS-170", `"${value}" leaves the repository; it was left out.`);
      return "";
    }
    const path = resolved.path;
    const [, tail] = splitTail(value);

    // By its name: a page (a Markdown file, or a folder, which means the folder's own page) or a file to import.
    const isPage = /\.(md|markdown|mdx)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path);
    // Recorded even when nothing is there yet: if the target appears later, this page has to be rewritten.
    (isPage ? pageLinks : assets).add(path);

    let target = input.lookup(path);
    if (!target && isPage && !/\.(md|markdown|mdx)$/i.test(path)) target = input.lookup(`dir:${path}`) ?? input.lookup(`${path}/index.md`) ?? input.lookup(`${path}/README.md`);

    if (!target) {
      report(isPage ? "GS-130" : "GS-131", `"${value}" does not match a ${isPage ? "page" : "file"} in the repository.`);
      return null;
    }
    if (target.kind === "asset") return target.url;
    return `${relativeUrl(input.pageSegments, target.segments)}${tail.startsWith("#") || tail.startsWith("?") ? tail : ""}`;
  };

  const inline = (content: Inline[]): Inline[] =>
    content.map((run) => {
      if (run.type !== "link") return run;
      const next = rewrite(run.href);
      return next === null ? run : { ...run, href: next };
    });

  const visit = (block: Block): Block => {
    const props = { ...block.props };
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (typeof v !== "string" || v === "") continue;
      if (REWRITTEN_PROPS.has(key)) props[key] = rewrite(v) ?? v;
    }

    let content = block.content;
    if (Array.isArray(content)) content = inline(content);
    else if (content && content.type === "tableContent") {
      content = { ...content, rows: content.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, content: inline(cell.content) })) })) };
    }
    return { ...block, props, ...(content !== undefined ? { content } : {}), children: block.children.map(visit) };
  };

  return { blocks: blocks.map(visit), pageLinks: [...pageLinks].sort(), assets: [...assets].sort(), problems };
}
