import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { toString } from "mdast-util-to-string";
import type { List, ListItem, RootContent } from "mdast";
import type { Diagnostics } from "../diagnostics";
import type { NavEntry } from "./config";
import { cleanRepoPath, resolveRepoLink } from "./paths";

/** A navigation as written, before it is matched against the files that exist. The same shape for every source. */
export interface SpecEntry {
  kind: "page" | "group";
  /** A repository path (pages only). */
  path?: string;
  /** The label the author gave it, if any. */
  label?: string;
  icon?: string;
  /** Where it was written, for diagnostics. */
  line?: number;
  children: SpecEntry[];
}

const MAX_ENTRIES = 5000;

/**
 * `SUMMARY.md`: `##` headings are groups, nested list links are children, `---` is ignored. The format is
 * GitBook's, so what is read here is what GitBook would read.
 */
export function parseSummary(text: string, summaryPath: string, diags: Diagnostics): SpecEntry[] {
  const tree = fromMarkdown(text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const top: SpecEntry[] = [];
  let target = top;
  let count = 0;

  const readList = (list: List, into: SpecEntry[], depth: number) => {
    for (const item of list.children as ListItem[]) {
      if (++count > MAX_ENTRIES || depth > 20) {
        if (count === MAX_ENTRIES + 1) diags.add("GS-207", `${summaryPath} has more than ${MAX_ENTRIES} entries; the rest was skipped.`, item.position);
        return;
      }
      const para = item.children.find((c) => c.type === "paragraph");
      const link = para && "children" in para ? para.children.find((c) => c.type === "link") : undefined;
      const nested = item.children.filter((c): c is List => c.type === "list");

      let entry: SpecEntry | null = null;
      if (link && link.type === "link") {
        const resolved = resolveRepoLink(summaryPath, link.url);
        const line = item.position?.start.line;
        if (resolved === null) diags.add("GS-206", `"${link.url}" is not a file in the repository; the entry was skipped.`, item.position);
        else if ("escapes" in resolved) diags.add("GS-170", `"${link.url}" leaves the repository; the entry was skipped.`, item.position);
        else {
          const label = link.title?.trim() || toString(link).trim();
          entry = { kind: "page", path: resolved.path, ...(label ? { label } : {}), ...(line ? { line } : {}), children: [] };
        }
      } else {
        diags.add("GS-206", "An entry without a link was skipped; the pages under it were kept.", item.position);
      }

      // Pages nested under an entry we could not use are kept, one level up, rather than lost.
      const sink = entry ? entry.children : into;
      for (const list of nested) readList(list, sink, depth + 1);
      if (entry) into.push(entry);
    }
  };

  for (const node of tree.children as RootContent[]) {
    if (node.type === "heading") {
      if (node.depth === 1) continue; // "# Summary"
      const title = toString(node).trim();
      if (!title) continue;
      const group: SpecEntry = { kind: "group", label: title, ...(node.position ? { line: node.position.start.line } : {}), children: [] };
      top.push(group);
      target = group.children;
    } else if (node.type === "list") {
      readList(node, target, 0);
    }
  }
  return top;
}

/** `gitcrook.yaml`'s `nav:` into the same shape. */
export function specFromNav(nav: NavEntry[], diags: Diagnostics): SpecEntry[] {
  let count = 0;
  const read = (entries: NavEntry[], depth: number): SpecEntry[] => {
    const out: SpecEntry[] = [];
    for (const raw of entries) {
      if (++count > MAX_ENTRIES || depth > 20) {
        if (count === MAX_ENTRIES + 1) diags.add("GS-207", `The navigation has more than ${MAX_ENTRIES} entries; the rest was skipped.`);
        break;
      }
      if (typeof raw === "string" || "page" in raw) {
        const rawPath = typeof raw === "string" ? raw : raw.page;
        const path = cleanRepoPath(rawPath);
        if (path === null) {
          diags.add("GS-170", `"${rawPath}" is not a path inside the repository; the entry was skipped.`);
          continue;
        }
        const object = typeof raw === "string" ? null : raw;
        out.push({ kind: "page", path, ...(object?.title ? { label: object.title } : {}), ...(object?.icon ? { icon: object.icon } : {}), children: object?.pages ? read(object.pages, depth + 1) : [] });
      } else {
        out.push({ kind: "group", label: raw.group, ...(raw.icon ? { icon: raw.icon } : {}), children: read(raw.pages, depth + 1) });
      }
    }
    return out;
  };
  return read(nav, 0);
}
