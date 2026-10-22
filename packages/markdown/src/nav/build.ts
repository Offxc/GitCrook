import { freeSlug, slugify } from "@gitcrook/shared";
import { Diagnostics, diagnostic, type DiagnosticCode } from "../diagnostics";
import type { FrontMatter } from "../frontMatter";
import { IdSource } from "../ids";
import type { Block, Diagnostic } from "../types";
import { defaultConfig, type RepoConfig } from "./config";
import { basenameOf, cleanRepoPath, dirnameOf, humanize, isMarkdownPath, stemOf } from "./paths";
import { parseSummary, specFromNav, type SpecEntry } from "./summary";

/** What the navigation needs to know about a Markdown file: where it is, and what its parse found. */
export interface NavFile {
  /** Relative to the docs root, with forward slashes. */
  path: string;
  frontMatter: FrontMatter;
  /** The title the parser found (front matter, else the leading `# Heading`). */
  title: string | null;
}

export interface NavNode {
  /** The source path for a file; `dir:<path>` or `group:<slug>` for a node that has no file. Stable across syncs. */
  key: string;
  /** Same as `key`; lets the tree walkers in `@gitcrook/shared` take these nodes directly. */
  id: string;
  kind: "page" | "group" | "generated";
  /** A group is only a header in the sidebar; it has no page of its own. */
  isGroup: boolean;
  sourcePath: string | null;
  title: string;
  /** The sidebar label when it differs from the title. */
  navTitle: string;
  slug: string;
  icon: string | null;
  description: string | null;
  draft: boolean;
  hidden: boolean;
  frontMatterId: string | null;
  redirectFrom: string[];
  children: NavNode[];
}

export interface NavigationResult {
  nodes: NavNode[];
  /** Where the structure came from. */
  mode: "gitcrook.yaml" | "SUMMARY.md" | "folders";
  /** Files that exist but are not in an explicit navigation, so are not published. */
  unlisted: string[];
  diagnostics: Diagnostic[];
}

export interface BuildNavigationOptions {
  files: readonly NavFile[];
  config?: RepoConfig;
  /** The text of the summary file, if the repository has one. */
  summary?: string | null;
  maxDepth?: number;
}

const MAX_DEPTH = 20;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const compareNames = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const comparePaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A file whose name says it is a folder's own page. */
const INDEX_STEMS = ["index", "readme"];
const isIndexStem = (stem: string) => INDEX_STEMS.includes(stem.toLowerCase());

/** A node on its way to being final: what its slug wants to be, and where it sorts. */
interface Draft {
  node: NavNode;
  baseSlug: string;
  explicitSlug: boolean;
  order: number | null;
  sortName: string;
  /** Used to decide who keeps a contested slug, independent of display order. */
  path: string;
  at?: { path?: string; line?: number };
}

/**
 * Turns the files of a repository into the page tree. Pure: the same inputs always give the same tree, with the
 * same slugs, whatever order the files arrive in. Precedence is the repository's own: `gitcrook.yaml`'s `nav`,
 * then `SUMMARY.md`, then the folder layout.
 */
export function buildNavigation(options: BuildNavigationOptions): NavigationResult {
  const config = options.config ?? defaultConfig();
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const diagnostics: Diagnostic[] = [];
  const report = (code: DiagnosticCode, message: string, where: { path?: string; line?: number } = {}) => diagnostics.push(diagnostic(code, message, where));

  const summaryPath = cleanRepoPath(config.summaryPath)?.toLowerCase() ?? "summary.md";
  const files = new Map<string, NavFile>();
  for (const file of options.files) {
    const path = cleanRepoPath(file.path);
    if (path === null) {
      report("GS-170", `"${file.path}" is not a path inside the repository; it was skipped.`, { path: file.path });
      continue;
    }
    if (!isMarkdownPath(path) || path.toLowerCase() === summaryPath) continue;
    // `dir:` and `group:` are how nodes without a file are named; a file must not be able to take one of those names.
    if (/^(dir|group):/i.test(path)) {
      report("GS-170", `"${file.path}" starts with a name Git Sync uses for itself; it was skipped.`, { path: file.path });
      continue;
    }
    // Dot-directories (.github), underscore names (_drafts, _partials) and dependencies are not documentation.
    if (path.split("/").some((s) => s.startsWith(".") || s.startsWith("_") || s === "node_modules")) continue;
    if (!files.has(path)) files.set(path, { ...file, path });
  }

  // -----------------------------------------------------------------------------------------------
  // Node construction
  // -----------------------------------------------------------------------------------------------

  const nameOfFile = (file: NavFile): string => {
    const stem = stemOf(file.path);
    if (isIndexStem(stem)) return basenameOf(dirnameOf(file.path)) || "home";
    return stem;
  };

  const baseSlugOf = (file: NavFile): { slug: string; explicit: boolean } => {
    if (file.frontMatter.slug) return { slug: file.frontMatter.slug, explicit: true };
    const stem = stemOf(file.path);
    if (isIndexStem(stem) && dirnameOf(file.path) === "") return { slug: slugify(file.frontMatter.title ?? file.title ?? "home"), explicit: false };
    return { slug: slugify(nameOfFile(file)), explicit: false };
  };

  const pageNode = (file: NavFile, label?: string, icon?: string): NavNode => {
    const fm = file.frontMatter;
    const title = fm.title ?? file.title ?? label ?? humanize(nameOfFile(file));
    return {
      key: file.path,
      id: file.path,
      kind: "page",
      isGroup: false,
      sourcePath: file.path,
      title,
      navTitle: fm.nav_title ?? label ?? title,
      slug: "",
      icon: fm.icon ?? icon ?? null,
      description: fm.description ?? null,
      draft: fm.draft,
      hidden: fm.hidden,
      frontMatterId: fm.id ?? null,
      redirectFrom: fm.redirect_from,
      children: [],
    };
  };

  const containerNode = (kind: "group" | "generated", key: string, title: string, icon?: string): NavNode => ({
    key,
    id: key,
    kind,
    isGroup: kind === "group",
    sourcePath: null,
    title,
    navTitle: title,
    slug: "",
    icon: icon ?? null,
    description: null,
    draft: false,
    hidden: false,
    frontMatterId: null,
    redirectFrom: [],
    children: [],
  });

  /** Sorts siblings, gives each a URL segment that no sibling shares, and returns them in display order. */
  const settle = (drafts: Draft[]): NavNode[] => {
    const taken = new Set<string>();
    const claim = (d: Draft) => {
      const slug = freeSlug(d.baseSlug, taken);
      taken.add(slug);
      if (slug !== d.baseSlug) report("GS-110", `The URL "${d.baseSlug}" is already used by another page at this level; this page uses "${slug}".`, d.at ?? { path: d.path });
      d.node.slug = slug;
    };
    // Path order, not display order: which page keeps a contested URL must not change when someone reorders pages.
    const byPath = [...drafts].sort((a, b) => comparePaths(a.path, b.path));
    for (const d of byPath) if (d.explicitSlug) claim(d);
    for (const d of byPath) if (!d.explicitSlug) claim(d);

    return [...drafts]
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || compareNames(a.sortName, b.sortName) || comparePaths(a.path, b.path))
      .map((d) => d.node);
  };

  // -----------------------------------------------------------------------------------------------
  // Folder layout
  // -----------------------------------------------------------------------------------------------

  interface Dir {
    name: string;
    path: string;
    files: NavFile[];
    dirs: Map<string, Dir>;
  }

  const buildFolders = (): NavNode[] => {
    const root: Dir = { name: "", path: "", files: [], dirs: new Map() };
    for (const file of [...files.values()].sort((a, b) => comparePaths(a.path, b.path))) {
      let dir = root;
      const segments = file.path.split("/");
      for (const segment of segments.slice(0, -1)) {
        let next = dir.dirs.get(segment);
        if (!next) {
          next = { name: segment, path: dir.path ? `${dir.path}/${segment}` : segment, files: [], dirs: new Map() };
          dir.dirs.set(segment, next);
        }
        dir = next;
      }
      dir.files.push(file);
    }

    const indexOf = (dir: Dir): NavFile | undefined => {
      if (dir === root) {
        const configured = files.get(cleanRepoPath(config.readmePath) ?? "");
        if (configured && dirnameOf(configured.path) === "") return configured;
      }
      const candidates = dir.files.filter((f) => isIndexStem(stemOf(f.path)));
      const rank = (f: NavFile) => (stemOf(f.path).toLowerCase() === "index" ? 0 : 1);
      return candidates.sort((a, b) => rank(a) - rank(b) || comparePaths(a.path, b.path))[0];
    };

    const childrenOf = (dir: Dir, depth: number): NavNode[] => {
      if (depth > maxDepth) {
        report("GS-207", `"${dir.path}" is nested more than ${maxDepth} folders deep; it was skipped.`, { path: dir.path });
        return [];
      }
      const own = indexOf(dir);
      const drafts: Draft[] = [];
      for (const file of dir.files) {
        if (file === own) continue;
        if (isIndexStem(stemOf(file.path))) report("GS-206", `"${file.path}" is a second home page for "${dir.path || "the repository"}"; it is an ordinary page.`, { path: file.path });
        const { slug, explicit } = baseSlugOf(file);
        // An ordinary page called README or index keeps that name rather than the folder's.
        const base = !explicit && isIndexStem(stemOf(file.path)) ? slugify(stemOf(file.path)) : slug;
        drafts.push({ node: pageNode(file), baseSlug: base, explicitSlug: explicit, order: file.frontMatter.order ?? null, sortName: stemOf(file.path), path: file.path });
      }
      for (const sub of dir.dirs.values()) {
        const draft = folderDraft(sub, depth + 1);
        if (draft) drafts.push(draft);
      }
      return settle(drafts);
    };

    const folderDraft = (dir: Dir, depth: number): Draft | null => {
      const idx = indexOf(dir);
      const kids = childrenOf(dir, depth);
      if (!idx && kids.length === 0) return null;
      if (idx) {
        const { slug, explicit } = baseSlugOf(idx);
        const node = pageNode(idx);
        node.children = kids;
        return { node, baseSlug: explicit ? slug : slugify(dir.name), explicitSlug: explicit, order: idx.frontMatter.order ?? null, sortName: dir.name, path: dir.path };
      }
      // A folder with no page of its own: a header at the top level (the model allows groups only there), elsewhere
      // a page that lists its children.
      const kind = depth === 1 ? "group" : "generated";
      const node = containerNode(kind, `dir:${dir.path}`, humanize(dir.name));
      node.children = kids;
      return { node, baseSlug: slugify(dir.name), explicitSlug: false, order: null, sortName: dir.name, path: dir.path };
    };

    const drafts: Draft[] = [];
    const home = indexOf(root);
    if (home) {
      const { slug, explicit } = baseSlugOf(home);
      // The home page leads unless it asks to be somewhere else.
      drafts.push({ node: pageNode(home), baseSlug: slug, explicitSlug: explicit, order: home.frontMatter.order ?? -Infinity, sortName: "", path: home.path });
    }
    for (const file of root.files) {
      if (file === home) continue;
      if (isIndexStem(stemOf(file.path))) report("GS-206", `"${file.path}" is a second home page; it is an ordinary page.`, { path: file.path });
      const { slug, explicit } = baseSlugOf(file);
      const base = !explicit && isIndexStem(stemOf(file.path)) ? slugify(stemOf(file.path)) : slug;
      drafts.push({ node: pageNode(file), baseSlug: base, explicitSlug: explicit, order: file.frontMatter.order ?? null, sortName: stemOf(file.path), path: file.path });
    }
    for (const sub of root.dirs.values()) {
      const draft = folderDraft(sub, 1);
      if (draft) drafts.push(draft);
    }
    return settle(drafts);
  };

  // -----------------------------------------------------------------------------------------------
  // Explicit navigation (gitcrook.yaml, SUMMARY.md)
  // -----------------------------------------------------------------------------------------------

  const buildFromSpec = (spec: SpecEntry[], sourceName: string): { nodes: NavNode[]; used: Set<string> } => {
    const used = new Set<string>();
    const lowerIndex = new Map<string, string[]>();
    for (const p of files.keys()) lowerIndex.set(p.toLowerCase(), [...(lowerIndex.get(p.toLowerCase()) ?? []), p]);
    const groupKeys = new Set<string>();

    const find = (path: string): NavFile | undefined => {
      const exact = files.get(path);
      if (exact) return exact;
      const loose = lowerIndex.get(path.toLowerCase());
      return loose?.length === 1 ? files.get(loose[0]!) : undefined;
    };

    const read = (entries: SpecEntry[], depth: number, inside: "top" | "group" | "page"): NavNode[] => {
      const drafts: Draft[] = [];
      let position = 0;
      if (depth > maxDepth) {
        report("GS-207", `The navigation is nested more than ${maxDepth} levels deep; the rest was skipped.`, { path: sourceName });
        return [];
      }
      for (const entry of entries) {
        const where = { path: sourceName, ...(entry.line ? { line: entry.line } : {}) };
        if (entry.kind === "group") {
          const kids = read(entry.children, depth + 1, "group");
          if (inside !== "top") {
            report("GS-206", `A group inside ${inside === "group" ? "another group" : "a page"} is not possible; "${entry.label}" was flattened into its parent.`, where);
            for (const kid of kids) drafts.push(hoisted(kid, position++));
            continue;
          }
          let key = `group:${slugify(entry.label ?? "group")}`;
          for (let n = 2; groupKeys.has(key); n++) key = `group:${slugify(entry.label ?? "group")}-${n}`;
          groupKeys.add(key);
          const node = containerNode("group", key, entry.label ?? "Group", entry.icon);
          node.children = kids;
          drafts.push({ node, baseSlug: slugify(entry.label ?? "group"), explicitSlug: false, order: position++, sortName: "", path: key, at: where });
          continue;
        }

        const file = find(entry.path!);
        const kids = read(entry.children, depth + 1, "page");
        if (!file) {
          report("GS-121", `The navigation refers to "${entry.path}", which does not exist.`, where);
          for (const kid of kids) drafts.push(hoisted(kid, position++));
          continue;
        }
        if (file.path !== entry.path) report("GS-206", `"${entry.path}" was matched to "${file.path}", which differs in case.`, where);
        if (used.has(file.path)) {
          report("GS-122", `"${file.path}" appears more than once in the navigation; the first entry was kept.`, where);
          for (const kid of kids) drafts.push(hoisted(kid, position++));
          continue;
        }
        used.add(file.path);
        const { slug, explicit } = baseSlugOf(file);
        const node = pageNode(file, entry.label, entry.icon);
        node.children = kids;
        drafts.push({ node, baseSlug: slug, explicitSlug: explicit, order: position++, sortName: "", path: file.path, at: where });
      }
      return settle(drafts);
    };

    // Moves an already-settled node up a level: its slug is claimed again among its new siblings.
    const hoisted = (node: NavNode, order: number): Draft => ({
      node,
      baseSlug: node.slug,
      explicitSlug: node.sourcePath ? Boolean(files.get(node.sourcePath)?.frontMatter.slug) : false,
      order,
      sortName: "",
      path: node.sourcePath ?? node.key,
    });

    return { nodes: read(spec, 0, "top"), used };
  };

  // -----------------------------------------------------------------------------------------------

  let mode: NavigationResult["mode"] = "folders";
  let nodes: NavNode[];
  let unlisted: string[] = [];

  if (config.nav) {
    mode = "gitcrook.yaml";
    const specDiags = new Diagnostics("gitcrook.yaml");
    const spec = specFromNav(config.nav, specDiags);
    diagnostics.push(...specDiags.items);
    const built = buildFromSpec(spec, "gitcrook.yaml");
    nodes = built.nodes;
    unlisted = [...files.keys()].filter((p) => !built.used.has(p)).sort(comparePaths);
  } else if (options.summary != null) {
    mode = "SUMMARY.md";
    const summaryDiags = new Diagnostics(config.summaryPath);
    const spec = parseSummary(options.summary, config.summaryPath, summaryDiags);
    diagnostics.push(...summaryDiags.items);
    const built = buildFromSpec(spec, config.summaryPath);
    nodes = built.nodes;
    unlisted = [...files.keys()].filter((p) => !built.used.has(p)).sort(comparePaths);
  } else {
    nodes = buildFolders();
  }

  // Not published, and not silent: this is the usual way a page goes missing from a GitBook-style repository.
  for (const path of unlisted) report("GS-120", `"${path}" is not in the navigation, so it is not published.`, { path });

  return { nodes, mode, unlisted, diagnostics };
}

/**
 * The body of a generated container page: a card for each page below it. `hrefFor` turns a node into the link the
 * card should carry (the caller knows the site's URL scheme). Ids are derived from `seed`, so the page does not
 * change between syncs when its children do not.
 */
export function containerPageBlocks(node: NavNode, hrefFor: (child: NavNode) => string, seed: string): Block[] {
  const ids = new IdSource(seed);
  const shown = node.children.filter((c) => !c.draft && !c.hidden);
  if (shown.length === 0) return [];
  const group: Block = { id: ids.next([0], "cardGroup"), type: "cardGroup", props: { size: "medium" }, children: [] };
  shown.forEach((child, i) => {
    group.children.push({
      id: ids.next([0, i], "card"),
      type: "card",
      props: { title: child.navTitle, description: child.description ?? "", href: hrefFor(child), imageUrl: "" },
      children: [],
    });
  });
  return [group];
}
