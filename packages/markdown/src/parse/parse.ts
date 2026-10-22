import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { directiveFromMarkdown } from "mdast-util-directive";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { directive } from "micromark-extension-directive";
import { math } from "micromark-extension-math";
import type { Definition, Root, RootContent } from "mdast";
import { Diagnostics } from "../diagnostics";
import { emptyFrontMatter, parseFrontMatter, splitFrontMatter, type FrontMatter } from "../frontMatter";
import { IdSource } from "../ids";
import type { Block, Diagnostic } from "../types";
import { DEFAULT_LIMITS, type ConvertContext, type ParseOptions, type Reference } from "./context";
import { convertNodes } from "./convert";
import { inlineToPlainText } from "./inline";
import { hasLiquid, translateLiquid } from "./liquid";

export interface ParseResult {
  frontMatter: FrontMatter;
  /** The page's title: front matter, else a leading `# Heading` (which is then removed from `blocks`). */
  title: string | null;
  blocks: Block[];
  diagnostics: Diagnostic[];
  /** Links, images and files the page points at, for the caller to resolve or import. */
  references: Reference[];
}

/** Parses Markdown into a tree. Never throws for content: a problem is a diagnostic, not an exception. */
export function parseMarkdown(input: string, options: ParseOptions = {}): ParseResult {
  const diags = new Diagnostics(options.path);
  let source = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (options.gitbook !== false && hasLiquid(source)) source = translateLiquid(source, { diags, resolveInclude: options.resolveInclude });

  // Front matter is split off by hand rather than by the Markdown parser: a file that opens with a divider and
  // has no closing fence is just a divider, and the parser's own front-matter rule mishandles that case.
  let frontMatter = emptyFrontMatter();
  const split = splitFrontMatter(source);
  if (split.yaml !== null) {
    frontMatter = parseFrontMatter(split.yaml, diags, 1);
    source = split.rest;
  }

  let tree: Root;
  try {
    tree = fromMarkdown(source, {
      extensions: [gfm(), directive(), math({ singleDollarTextMath: false })],
      mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown(), mathFromMarkdown()],
    });
  } catch (error) {
    // The Markdown grammar accepts any input, so this is not expected; if it ever happens the file is reported, not fatal.
    diags.add("GS-207", `The file could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    return { frontMatter, title: null, blocks: [], diagnostics: diags.items, references: [] };
  }

  const children: RootContent[] = tree.children;
  const definitions = new Map<string, Definition>();
  const scan = (nodes: RootContent[]) => {
    for (const n of nodes) {
      if (n.type === "definition") definitions.set(n.identifier, n);
      if ("children" in n && Array.isArray(n.children)) scan(n.children as RootContent[]);
    }
  };
  scan(children);

  const ctx: ConvertContext = {
    source,
    ids: new IdSource(options.idSeed ?? options.path ?? ""),
    diags,
    options: { ...options, maxDepth: options.maxDepth ?? DEFAULT_LIMITS.maxDepth, maxBlocks: options.maxBlocks ?? DEFAULT_LIMITS.maxBlocks },
    definitions,
    references: [],
    state: { blocks: 0, overflowReported: false },
  };

  let blocks = convertNodes(children, ctx, { path: [], depth: 0 });

  // A page's title is shown by the site, so a leading `# Title` that says the same thing would appear twice.
  let title = frontMatter.title ?? null;
  const lead = blocks[0];
  if (options.extractTitle !== false && lead?.type === "heading" && lead.props.level === 1 && Array.isArray(lead.content)) {
    const text = inlineToPlainText(lead.content).trim();
    const same = title !== null && text.toLowerCase().replace(/\s+/g, " ") === title.toLowerCase().replace(/\s+/g, " ");
    if (title === null && text) {
      title = text;
      blocks = blocks.slice(1);
    } else if (same) {
      blocks = blocks.slice(1);
    }
  }

  return { frontMatter, title, blocks, diagnostics: sortByPosition(diags.items), references: ctx.references };
}

/** Tag translation and the Markdown parse report in different passes; authors read the file top to bottom. */
function sortByPosition(items: Diagnostic[]): Diagnostic[] {
  return items
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.line ?? Infinity) - (b.d.line ?? Infinity) || (a.d.column ?? 0) - (b.d.column ?? 0) || a.i - b.i)
    .map(({ d }) => d);
}
