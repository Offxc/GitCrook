/**
 * The plain-text forms of a published site, for readers that are not browsers — an AI coding agent checking what the
 * docs say, a search tool, `curl`:
 *
 *  - a page as Markdown (`/{page}.md`),
 *  - `llms.txt`: the site's table of contents as Markdown links to those pages (https://llmstxt.org),
 *  - `llms-full.txt`: every page's text in one file.
 *
 * This file is the formatting only — pure functions over plain data. `siteTextData.ts` loads the data and
 * `serveSiteText.ts` is the HTTP side.
 */

export interface IndexEntry {
  title: string;
  description: string | null;
  /** Absolute `.md` URL, or null for a group (a header with no page of its own). */
  url: string | null;
  children: IndexEntry[];
}

export interface IndexSection {
  /** Null when the site has one section and one space, where a heading would be noise. */
  heading: string | null;
  entries: IndexEntry[];
}

/** Characters that would end or change a Markdown link's text. */
const escapeLinkText = (s: string) => s.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ").trim();
/** A description goes on one line after the link. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function entryLines(entry: IndexEntry, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const text = entry.url
    ? `${indent}- [${escapeLinkText(entry.title)}](${entry.url})${entry.description ? `: ${oneLine(entry.description)}` : ""}`
    : `${indent}- ${escapeLinkText(entry.title)}`;
  return [text, ...entry.children.flatMap((child) => entryLines(child, depth + 1))];
}

/** `llms.txt`. The site name as the only H1, a one-line summary, then sections of links. */
export function renderLlmsIndex(input: { siteName: string; summary?: string | null; sections: IndexSection[] }): string {
  const out = [`# ${oneLine(input.siteName)}`, ""];
  if (input.summary) out.push(`> ${oneLine(input.summary)}`, "");
  for (const section of input.sections) {
    if (section.entries.length === 0) continue;
    out.push(`## ${section.heading ? oneLine(section.heading) : "Pages"}`, "", ...section.entries.flatMap((e) => entryLines(e, 0)), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * A page as Markdown: its title, its description as a quote, then the body. The title is not repeated when the
 * body already opens with it as a heading (a page written in the editor often does; one from a repository never
 * does, because the importer removes it).
 */
export function renderPageMarkdown(page: { title: string; description?: string | null; body: string }): string {
  const body = page.body.trim();
  const title = oneLine(page.title);
  const opensWithTitle = new RegExp(`^#[ \\t]+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(\\n|$)`).test(body);
  const parts: string[] = [];
  if (!opensWithTitle) parts.push(`# ${title}`);
  if (page.description?.trim()) parts.push(`> ${oneLine(page.description)}`);
  if (body) parts.push(body);
  return parts.join("\n\n") + "\n";
}

export interface FullPage {
  title: string;
  url: string;
  markdown: string;
}

/**
 * `llms-full.txt`: the pages one after another, each introduced by its address. Stops before `maxChars` rather than
 * cutting a page in half, and says so, since an agent should know it did not get everything.
 */
export function renderLlmsFull(input: { siteName: string; summary?: string | null; pages: FullPage[]; /** How many pages the site has, when `pages` is only the ones that were read before giving up. */ totalPages?: number; maxChars: number; indexUrl: string }): string {
  const parts = [`# ${oneLine(input.siteName)}`];
  if (input.summary) parts.push(`> ${oneLine(input.summary)}`);
  let size = parts.join("\n\n").length;
  let included = 0;
  for (const page of input.pages) {
    const block = `---\n\nSource: ${page.url}\n\n${page.markdown.trim()}`;
    if (size + block.length + 2 > input.maxChars && included > 0) break;
    parts.push(block);
    size += block.length + 2;
    included++;
  }
  const total = Math.max(input.totalPages ?? 0, input.pages.length);
  if (included < total) {
    parts.push(`---\n\nThis file stops after ${included} of ${total} pages to keep its size reasonable. The rest are listed in ${input.indexUrl}`);
  }
  return parts.join("\n\n") + "\n";
}

/** The address of a page's Markdown form, from its page path. */
export function markdownUrl(base: string, path: string[]): string {
  return `${base}/${path.map(encodeURIComponent).join("/")}.md`;
}
