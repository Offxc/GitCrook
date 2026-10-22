import { emptyFrontMatter, type Diagnostic, type FrontMatter } from "@gitcrook/markdown";
import type { NavFile } from "@gitcrook/markdown";

/**
 * What is remembered about a file between syncs, in `Page.sourceMeta`. The navigation is rebuilt on every sync from
 * all files, and the files that did not change are not fetched again: their front matter and title come from here.
 */
export interface SourceMeta {
  v: 1;
  /** Block ids are derived from this, so a page keeps its block ids when its file moves. It is the path the page first had. */
  idSeed: string;
  frontMatter: Omit<FrontMatter, "extra">;
  /** The title the parser found: front matter, else the leading heading. */
  title: string | null;
  /** Repository paths of pages this one links to, so it can be rewritten when one of them moves. */
  pageLinks: string[];
  /** Repository paths of files this one embeds. */
  assets: string[];
  /** What the parser had to say about this file, kept so a problem stays visible on every sync until it is fixed. */
  diagnostics: Diagnostic[];
}

const MAX_KEPT_DIAGNOSTICS = 20;

export function metaFrom(idSeed: string, frontMatter: FrontMatter, title: string | null, pageLinks: string[], assets: string[], diagnostics: Diagnostic[] = []): SourceMeta {
  const { extra: _extra, ...kept } = frontMatter;
  void _extra;
  return { v: 1, idSeed, frontMatter: kept, title, pageLinks, assets, diagnostics: diagnostics.slice(0, MAX_KEPT_DIAGNOSTICS) };
}

/** Reads stored metadata back, tolerating anything a database could hold. Null if it is not usable. */
export function readMeta(value: unknown): SourceMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Partial<SourceMeta>;
  if (m.v !== 1 || typeof m.idSeed !== "string" || typeof m.frontMatter !== "object" || m.frontMatter === null) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    v: 1,
    idSeed: m.idSeed,
    frontMatter: { ...emptyFrontMatter(), ...m.frontMatter, redirect_from: strings(m.frontMatter.redirect_from) },
    title: typeof m.title === "string" ? m.title : null,
    pageLinks: strings(m.pageLinks),
    assets: strings(m.assets),
    diagnostics: Array.isArray(m.diagnostics) ? m.diagnostics.filter((d): d is Diagnostic => typeof d === "object" && d !== null && typeof d.code === "string" && typeof d.message === "string") : [],
  };
}

export function navFileFrom(path: string, meta: SourceMeta): NavFile {
  return { path, frontMatter: { ...meta.frontMatter, extra: {} }, title: meta.title };
}
