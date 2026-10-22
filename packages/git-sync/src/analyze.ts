import {
  buildNavigation,
  cleanRepoPath,
  Diagnostics,
  diagnostic,
  parseMarkdown,
  readRepoConfig,
  resolveRepoLink,
  type Diagnostic,
  type NavFile,
  type NavNode,
  type ParseResult,
  type RepoConfig,
} from "@gitcrook/markdown";
import type { TreeEntry } from "./github/client";
import { GitHostError } from "./github/errors";
import { DEFAULT_LIMITS, type SyncLimits } from "./limits";
import { rewriteBlocks, type Target } from "./rewrite";
import { decodeRepoText } from "./text";
import { CONFIG_FILE_NAMES, classifyEntries, isConfigPath, type Listing } from "./tree";

/**
 * Reads a whole repository the way a sync would and reports everything it finds, without a database, a network or
 * a site: the same configuration, file rules, parser, navigation and link checks, applied to whatever `input` is.
 * `gitcrook-docs check` runs it over a folder; a test runs it over the same repository as a sync preview and
 * requires the same answer, so the local check can be trusted to predict the server.
 *
 * (A sync itself reads only what changed since its last run, so it cannot simply call this; the pieces they share
 * live in `tree.ts`, `text.ts`, `rewrite.ts` and `@gitcrook/markdown`.)
 */

export interface AnalyzeInput {
  /** Everything in the repository, paths relative to its root. Directories may be left out. */
  entries: readonly TreeEntry[];
  /** The bytes of a file listed in `entries`. */
  read(path: string): Promise<Uint8Array>;
}

export interface AnalyzeOptions {
  /** The docs directory, as a source would set it. Without one, the repository's own configuration decides. */
  rootDir?: string;
  limits?: Partial<SyncLimits>;
}

export interface AnalyzedPage {
  /** Repository path of the file (or the directory, for a generated page). */
  key: string;
  kind: NavNode["kind"];
  title: string;
  slug: string;
  /** The URL path below the site, e.g. `["guides", "install"]`. */
  segments: string[];
  draft: boolean;
  hidden: boolean;
}

export interface Analysis {
  diagnostics: Diagnostic[];
  pages: AnalyzedPage[];
  config: RepoConfig;
  markdownFiles: number;
  assetFiles: number;
  /** Why a sync would not run at all (a missing directory, a broken configuration file), else null. */
  failure: string | null;
}

export async function analyzeRepository(input: AnalyzeInput, options: AnalyzeOptions = {}): Promise<Analysis> {
  const limits: SyncLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const diagnostics: Diagnostic[] = [];
  const add = (...items: Diagnostic[]) => void diagnostics.push(...items);
  const sizes = new Map(input.entries.map((e) => [e.path, e.size ?? 0]));

  let rootDir = "";
  const where = (path: string) => (rootDir ? `${rootDir}/${path}` : path);
  const readText = async (path: string, shownPath: string, maxBytes: number): Promise<string | null> => {
    if ((sizes.get(path) ?? 0) > maxBytes) {
      add(diagnostic("GS-150", `"${shownPath}" is ${sizes.get(path)} bytes; the limit is ${maxBytes}. It was skipped.`, { path: shownPath }));
      return null;
    }
    const decoded = decodeRepoText(await input.read(path), shownPath);
    if ("diagnostic" in decoded) {
      add(decoded.diagnostic);
      return null;
    }
    return decoded.text;
  };

  const finish = (config: RepoConfig, pages: AnalyzedPage[], counts: { markdownFiles: number; assetFiles: number }, failure: string | null): Analysis => ({ diagnostics, pages, config, ...counts, failure });
  const none = { markdownFiles: 0, assetFiles: 0 };

  // --- Configuration ------------------------------------------------------------------------------
  const found: { gitcrook: string | null; gitbook: string | null } = { gitcrook: null, gitbook: null };
  const topLevel = input.entries.filter((e) => e.type === "blob" && !e.path.includes("/") && CONFIG_FILE_NAMES.has(e.path.toLowerCase())).sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const entry of topLevel) {
    const text = await readText(entry.path, entry.path, limits.maxConfigBytes);
    if (text !== null) found[entry.path.toLowerCase().startsWith("gitcrook") ? "gitcrook" : "gitbook"] = text;
  }
  const configDiags = { gitcrook: new Diagnostics("gitcrook.yaml"), gitbook: new Diagnostics(".gitbook.yaml") };
  let config = readRepoConfig(found, configDiags);
  rootDir = cleanRepoPath(options.rootDir ?? "") ?? config.root;

  // --- The files ----------------------------------------------------------------------------------
  const prefix = rootDir ? `${rootDir}/` : "";
  const inside = rootDir ? input.entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) })) : [...input.entries];
  if (rootDir && inside.length === 0) {
    add(diagnostic("GS-302", `The directory "${rootDir}" does not exist.`, { path: rootDir }));
    return finish(config, [], none, `The directory "${rootDir}" does not exist.`);
  }

  let listing: Pick<Listing, "files" | "diagnostics">;
  try {
    listing = classifyEntries(inside, { rootDir, summaryPath: config.summaryPath, limits });
  } catch (error) {
    if (!(error instanceof GitHostError)) throw error;
    add(diagnostic("GS-151", error.message));
    return finish(config, [], none, error.message);
  }
  add(...listing.diagnostics.map((d) => (d.path ? { ...d, path: where(d.path) } : d)));

  // A gitcrook.yaml inside the docs directory refines the one at the repository root.
  const refinement = rootDir ? listing.files.find((f) => f.kind === "config" && !f.path.includes("/") && f.path.toLowerCase().startsWith("gitcrook.y")) : undefined;
  if (refinement) {
    const text = await readText(prefix + refinement.path, where(refinement.path), limits.maxConfigBytes);
    if (text !== null) config = readRepoConfig({ gitcrook: text, gitbook: found.gitbook }, configDiags);
  }
  add(...configDiags.gitcrook.items, ...configDiags.gitbook.items);

  const summaryFile = listing.files.find((f) => f.kind === "config" && f.path.toLowerCase() === config.summaryPath.toLowerCase());
  const summary = summaryFile ? await readText(prefix + summaryFile.path, where(summaryFile.path), limits.maxConfigBytes) : null;

  const markdownFiles = listing.files.filter((f) => f.kind === "markdown");
  const assetFiles = new Set(listing.files.filter((f) => f.kind === "asset").map((f) => f.path));
  const counts = { markdownFiles: markdownFiles.length, assetFiles: assetFiles.size };

  // --- Read and parse -----------------------------------------------------------------------------
  const texts = new Map<string, string>();
  for (const file of markdownFiles) {
    if (file.size > limits.maxMarkdownBytes) {
      add(diagnostic("GS-150", `"${where(file.path)}" is ${file.size} bytes; the limit is ${limits.maxMarkdownBytes}. It was skipped.`, { path: where(file.path) }));
      continue;
    }
    const text = await readText(prefix + file.path, where(file.path), limits.maxMarkdownBytes);
    if (text !== null) texts.set(file.path, text);
  }
  const parsed = new Map<string, ParseResult>();
  for (const [path, text] of texts) {
    parsed.set(
      path,
      parseMarkdown(text, {
        path,
        idSeed: path,
        resolveInclude: (target) => {
          const resolved = resolveRepoLink(path, target);
          return !resolved || "escapes" in resolved ? null : (texts.get(resolved.path) ?? null);
        },
      }),
    );
  }

  // --- The navigation -----------------------------------------------------------------------------
  const navFiles: NavFile[] = markdownFiles.flatMap((f) => {
    const result = parsed.get(f.path);
    return result ? [{ path: f.path, frontMatter: result.frontMatter, title: result.title }] : [];
  });
  const nav = buildNavigation({ files: navFiles, config, summary });
  add(...nav.diagnostics.map((d) => (d.path && !isConfigPath(d.path, config) ? { ...d, path: where(d.path) } : d)));

  const fatal = diagnostics.find((d) => d.severity === "error" && d.path !== undefined && isConfigPath(d.path, config));
  if (fatal) return finish(config, [], counts, `${fatal.path}${fatal.line ? `:${fatal.line}` : ""}: ${fatal.message}`);

  const flat: NavNode[] = [];
  const segmentsOf = new Map<string, string[]>();
  const collect = (nodes: NavNode[], above: string[]) => {
    for (const n of nodes) {
      const here = [...above, n.slug];
      segmentsOf.set(n.key, here);
      flat.push(n);
      collect(n.children, here);
    }
  };
  collect(nav.nodes, []);
  const inTree = new Set(flat.map((n) => n.key));

  // --- Links and images ---------------------------------------------------------------------------
  const targets = new Map<string, Target>(flat.map((n) => [n.key, { kind: "page", segments: segmentsOf.get(n.key)! }]));
  const lookup = (path: string): Target | undefined => targets.get(path) ?? (assetFiles.has(path) ? { kind: "asset", url: "pending" } : undefined);
  for (const [path, result] of parsed) {
    if (!inTree.has(path)) continue;
    const rewritten = rewriteBlocks(result.blocks, { fromPath: path, pageSegments: segmentsOf.get(path) ?? [], lookup });
    add(...result.diagnostics.map((d) => ({ ...d, path: where(path) })), ...rewritten.problems.map((p) => diagnostic(p.code, p.message, { path: where(path) })));
  }

  const pages = flat.map((n): AnalyzedPage => ({ key: n.key, kind: n.kind, title: n.title, slug: n.slug, segments: segmentsOf.get(n.key)!, draft: n.draft, hidden: n.hidden }));
  return finish(config, pages, counts, null);
}
