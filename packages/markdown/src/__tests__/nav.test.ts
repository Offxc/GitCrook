import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { flattenPageTree, pathsForTree } from "@gitcrook/shared";
import {
  Diagnostics,
  buildNavigation,
  cleanRepoPath,
  containerPageBlocks,
  defaultConfig,
  emptyFrontMatter,
  parseSummary,
  readRepoConfig,
  resolveRepoLink,
  type NavFile,
  type NavNode,
  type RepoConfig,
} from "../index";

/** `file("guides/install.md", { order: 2 })`. */
const file = (path: string, fm: Partial<ReturnType<typeof emptyFrontMatter>> = {}, title: string | null = null): NavFile => ({ path, frontMatter: { ...emptyFrontMatter(), ...fm }, title });
const nav = (paths: string[] | NavFile[], options: { config?: Partial<RepoConfig>; summary?: string | null } = {}) =>
  buildNavigation({
    files: paths.map((p) => (typeof p === "string" ? file(p) : p)),
    config: options.config ? { ...defaultConfig(), ...options.config } : undefined,
    summary: options.summary,
  });
/** The tree as `key (slug)` lines, indented: easy to read in a failing diff. */
const outline = (nodes: NavNode[], depth = 0): string[] =>
  nodes.flatMap((n) => [`${"  ".repeat(depth)}${n.kind === "group" ? "[" + n.title + "]" : n.kind === "generated" ? "{" + n.title + "}" : n.key} /${n.slug}`, ...outline(n.children, depth + 1)]);
const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

describe("paths", () => {
  it.each([
    ["a.md", "a.md"],
    ["./a.md", "a.md"],
    ["docs//guides/./a.md", "docs/guides/a.md"],
    ["café/ü.md", "café/ü.md"],
  ])("cleans %s", (raw, expected) => {
    expect(cleanRepoPath(raw)).toBe(expected);
  });

  it.each(["", "..", "../a.md", "a/../../b.md", "/etc/passwd", "a\\b.md", "a\u0000.md", "a\nb.md", "docs/.."])("refuses %j", (raw) => {
    expect(cleanRepoPath(raw)).toBeNull();
  });

  it("normalises Unicode so one name is one name", () => {
    expect(cleanRepoPath("café.md")).toBe("café.md");
  });

  describe("resolveRepoLink", () => {
    it.each([
      ["guides/install.md", "./configure.md", "guides/configure.md"],
      ["guides/install.md", "../README.md", "README.md"],
      ["guides/install.md", "/README.md", "README.md"],
      ["a.md", "b%20c.md", "b c.md"],
      ["a.md", "b.md#section", "b.md"],
      ["a.md", "b.md?x=1", "b.md"],
    ])("%s → %s", (from, target, expected) => {
      expect(resolveRepoLink(from, target)).toEqual({ path: expected });
    });

    it.each(["https://example.com/a.md", "mailto:a@b.co", "//cdn.example.com/a.md", "#top", "", "javascript:alert(1)"])("%j is not a file in the repository", (target) => {
      expect(resolveRepoLink("a.md", target)).toBeNull();
    });

    it("says when a link climbs out of the repository", () => {
      expect(resolveRepoLink("a.md", "../../etc/passwd")).toEqual({ escapes: true });
      expect(resolveRepoLink("guides/a.md", "../../b.md")).toEqual({ escapes: true });
    });

    it("keeps a stray percent sign as part of the name", () => {
      expect(resolveRepoLink("a.md", "100%.md")).toEqual({ path: "100%.md" });
    });
  });
});

describe("the folder layout", () => {
  it("makes top-level folders into groups, with the pages inside", () => {
    const r = nav(["README.md", "guides/install.md", "guides/configure.md", "reference/cli.md"]);
    expect(r.mode).toBe("folders");
    expect(outline(r.nodes)).toEqual(["README.md /home", "[Guides] /guides", "  guides/configure.md /configure", "  guides/install.md /install", "[Reference] /reference", "  reference/cli.md /cli"]);
    expect(r.diagnostics).toEqual([]);
  });

  it("uses a folder's index page as the folder's own page, with its files beneath it", () => {
    const r = nav([file("guides/index.md", {}, "Guides overview"), file("guides/install.md"), file("guides/advanced/tuning.md")]);
    expect(outline(r.nodes)).toEqual(["guides/index.md /guides", "  {Advanced} /advanced", "    guides/advanced/tuning.md /tuning", "  guides/install.md /install"]);
    expect(r.nodes[0]).toMatchObject({ kind: "page", title: "Guides overview", isGroup: false });
  });

  it("makes a folder without a page, deeper than the top, into a generated page", () => {
    const r = nav(["a/b/c/d.md"]);
    expect(outline(r.nodes)).toEqual(["[A] /a", "  {B} /b", "    {C} /c", "      a/b/c/d.md /d"]);
    expect(r.nodes[0]!.children[0]).toMatchObject({ kind: "generated", sourcePath: null, key: "dir:a/b" });
  });

  it("leaves out empty folders", () => {
    expect(nav(["a/.keep.md", "b/_x.md"]).nodes).toEqual([]);
  });

  it("puts the home page first unless it says otherwise", () => {
    const first = nav([file("zebra.md"), file("README.md", {}, "Welcome"), file("alpha.md")]);
    expect(first.nodes.map((n) => n.key)).toEqual(["README.md", "alpha.md", "zebra.md"]);
    expect(first.nodes[0]!.slug).toBe("welcome");

    const moved = nav([file("zebra.md"), file("README.md", { order: 5 }), file("alpha.md", { order: 1 })]);
    expect(moved.nodes.map((n) => n.key)).toEqual(["alpha.md", "README.md", "zebra.md"]);
  });

  it("prefers index.md to README.md, and keeps the other as an ordinary page", () => {
    const r = nav(["docs/index.md", "docs/README.md"]);
    expect(outline(r.nodes)).toEqual(["docs/index.md /docs", "  docs/README.md /readme"]);
    expect(codes(r)).toEqual(["GS-206"]);
  });

  it("honours a home page named in .gitbook.yaml", () => {
    const r = nav(["Intro.md", "README.md"], { config: { readmePath: "Intro.md" } });
    expect(r.nodes[0]!.key).toBe("Intro.md");
  });

  it("ignores config files, dot-folders, underscore names and non-Markdown files", () => {
    const r = nav(["SUMMARY.md", ".github/CONTRIBUTING.md", "_drafts/a.md", "guides/_partial.md", "node_modules/x/README.md", "image.png", "ok.md"]);
    expect(r.nodes.map((n) => n.key)).toEqual(["ok.md"]);
  });

  it("reads .markdown and .mdx files", () => {
    expect(nav(["a.markdown", "b.mdx"]).nodes.map((n) => n.slug)).toEqual(["a", "b"]);
  });

  it("refuses a path that leaves the repository", () => {
    const r = nav(["../outside.md", "ok.md", "a/../../b.md"]);
    expect(r.nodes.map((n) => n.key)).toEqual(["ok.md"]);
    expect(codes(r)).toEqual(["GS-170", "GS-170"]);
    expect(r.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("will not let a file take the name of a generated node", () => {
    const r = nav(["dir:guides.md", "group:x.md", "ok.md", "sub/dir:fine.md"]);
    expect(codes(r)).toEqual(["GS-170", "GS-170"]);
    expect(flattenPageTree(r.nodes).filter((n) => n.sourcePath !== null).map((n) => n.sourcePath).sort()).toEqual(["ok.md", "sub/dir:fine.md"]);
  });

  it("gives a file the title it has, else a readable one made from its name", () => {
    const r = nav([file("a.md", { title: "From YAML" }, "From heading"), file("b.md", {}, "From heading"), file("getting-started.md"), file("c.md", { nav_title: "Short" }, "Long title")]);
    const byKey = Object.fromEntries(r.nodes.map((n) => [n.key, n]));
    expect(byKey["a.md"]!.title).toBe("From YAML");
    expect(byKey["b.md"]!.title).toBe("From heading");
    expect(byKey["getting-started.md"]!.title).toBe("Getting started");
    expect(byKey["c.md"]).toMatchObject({ title: "Long title", navTitle: "Short" });
  });

  it("carries front matter that the sync needs", () => {
    const [node] = nav([file("a.md", { id: "stable", icon: "rocket", description: "D", draft: true, hidden: true, redirect_from: ["old"] })]).nodes;
    expect(node).toMatchObject({ frontMatterId: "stable", icon: "rocket", description: "D", draft: true, hidden: true, redirectFrom: ["old"] });
  });
});

describe("ordering", () => {
  it("sorts by order, then by name, with numbers read as numbers", () => {
    const r = nav([file("page-10.md"), file("page-2.md"), file("page-1.md"), file("z.md", { order: 1 }), file("a.md", { order: 2 })]);
    expect(r.nodes.map((n) => n.key)).toEqual(["z.md", "a.md", "page-1.md", "page-2.md", "page-10.md"]);
  });

  it("is the same whatever order the files arrive in", () => {
    const paths = ["b/x.md", "a.md", "b/y.md", "c/d/e.md", "README.md", "b/index.md"];
    const a = outline(nav(paths).nodes);
    const b = outline(nav([...paths].reverse()).nodes);
    expect(b).toEqual(a);
  });
});

describe("URL segments", () => {
  it("come from the file name, or from `slug` in front matter", () => {
    const r = nav([file("Install Guide.md"), file("b.md", { slug: "custom" })]);
    expect(r.nodes.map((n) => n.slug).sort()).toEqual(["custom", "install-guide"]);
  });

  it("never repeat among siblings; the suffix is the same on every run", () => {
    const r = nav([file("a.md", { slug: "same" }), file("b.md", { slug: "same" }), file("same.md"), file("Same.md")]);
    const slugs = Object.fromEntries(r.nodes.map((n) => [n.key, n.slug]));
    expect(new Set(Object.values(slugs)).size).toBe(4);
    expect(slugs["a.md"]).toBe("same"); // explicit slugs claim first, in path order
    expect(slugs["b.md"]).toBe("same-1");
    expect(codes(r)).toEqual(expect.arrayContaining(["GS-110"]));

    const again = nav([file("Same.md"), file("same.md"), file("b.md", { slug: "same" }), file("a.md", { slug: "same" })]);
    expect(Object.fromEntries(again.nodes.map((n) => [n.key, n.slug]))).toEqual(slugs);
  });

  it("don't change who keeps a contested URL when pages are reordered", () => {
    const before = nav([file("a.md", { slug: "x", order: 1 }), file("b.md", { slug: "x", order: 2 })]);
    const after = nav([file("a.md", { slug: "x", order: 2 }), file("b.md", { slug: "x", order: 1 })]);
    const keeper = (r: ReturnType<typeof nav>) => r.nodes.find((n) => n.slug === "x")!.key;
    expect(keeper(before)).toBe("a.md");
    expect(keeper(after)).toBe("a.md");
  });

  it("avoid the words the site reserves for itself", () => {
    const r = nav(["api.md"]);
    expect(r.nodes[0]!.slug).not.toBe("");
    expect(pathsForTree(r.nodes).get("api.md")).toHaveLength(1);
  });

  it("give a folder's page the folder's name, unless the page chooses", () => {
    const r = nav([file("Getting Started/index.md"), file("other/README.md", { slug: "elsewhere" })]);
    expect(r.nodes.map((n) => n.slug)).toEqual(["getting-started", "elsewhere"]);
  });
});

describe("an explicit navigation in gitcrook.yaml", () => {
  const config = (navEntries: RepoConfig["nav"]): Partial<RepoConfig> => ({ nav: navEntries, sources: ["gitcrook.yaml"] });

  it("is used instead of the folders, in the order written", () => {
    const r = nav(["README.md", "guides/install.md", "guides/configure.md", "extra.md"], {
      config: config(["README.md", { group: "Guides", pages: ["guides/configure.md", "guides/install.md"] }]),
    });
    expect(r.mode).toBe("gitcrook.yaml");
    expect(outline(r.nodes)).toEqual(["README.md /home", "[Guides] /guides", "  guides/configure.md /configure", "  guides/install.md /install"]);
  });

  it("does not publish what it leaves out, and says which files", () => {
    const r = nav(["a.md", "b.md", "c.md"], { config: config(["a.md"]) });
    expect(r.unlisted).toEqual(["b.md", "c.md"]);
    expect(r.diagnostics.filter((d) => d.code === "GS-120").map((d) => d.path)).toEqual(["b.md", "c.md"]);
  });

  it("nests pages under pages, and takes the label it is given for the sidebar", () => {
    const r = nav(["a.md", "a/b.md"], { config: config([{ page: "a.md", title: "Alpha", pages: [{ page: "a/b.md", title: "Beta" }] }]) });
    expect(r.nodes[0]!.navTitle).toBe("Alpha");
    expect(r.nodes[0]!.children[0]).toMatchObject({ key: "a/b.md", navTitle: "Beta" });
  });

  it("reports a file that does not exist, and keeps the pages under it", () => {
    const r = nav(["real.md"], { config: config([{ page: "missing.md", pages: ["real.md"] }]) });
    expect(codes(r)).toEqual(["GS-121"]);
    expect(r.diagnostics[0]).toMatchObject({ severity: "error", path: "gitcrook.yaml" });
    expect(r.nodes.map((n) => n.key)).toEqual(["real.md"]);
  });

  it("keeps the first of a file that is listed twice", () => {
    const r = nav(["a.md"], { config: config(["a.md", "a.md"]) });
    expect(r.nodes).toHaveLength(1);
    expect(codes(r)).toEqual(["GS-122"]);
  });

  it("matches a path that differs only in case, when that is unambiguous", () => {
    const r = nav(["Guide.md"], { config: config(["guide.md"]) });
    expect(r.nodes[0]!.key).toBe("Guide.md");
    expect(codes(r)).toEqual(["GS-206"]);
  });

  it("flattens a group that is somewhere other than the top", () => {
    const r = nav(["a.md", "b.md"], { config: config([{ group: "Outer", pages: [{ group: "Inner", pages: ["a.md"] }, "b.md"] }]) });
    expect(outline(r.nodes)).toEqual(["[Outer] /outer", "  a.md /a", "  b.md /b"]);
    expect(codes(r)).toEqual(["GS-206"]);
  });

  it("refuses an entry that leaves the repository", () => {
    const r = nav(["ok.md"], { config: config(["../secret.md", "ok.md"]) });
    expect(r.nodes.map((n) => n.key)).toEqual(["ok.md"]);
    expect(codes(r)).toEqual(["GS-170"]);
  });

  it("needs its groups to be unique even when they share a name", () => {
    const r = nav(["a.md", "b.md"], { config: config([{ group: "Docs", pages: ["a.md"] }, { group: "Docs", pages: ["b.md"] }]) });
    expect(r.nodes.map((n) => n.key)).toEqual(["group:docs", "group:docs-2"]);
    expect(r.nodes.map((n) => n.slug)).toEqual(["docs", "docs-1"]);
  });
});

describe("SUMMARY.md", () => {
  const summary = `# Summary

* [Introduction](README.md)

## Guides

* [Install](guides/install.md "Installing")
  * [Docker](guides/docker.md)
* [Configure](guides/configure.md)

---

## Reference

* [CLI](reference/cli.md)
`;

  it("makes headings groups and nested lists children", () => {
    const r = nav(["README.md", "guides/install.md", "guides/docker.md", "guides/configure.md", "reference/cli.md"], { summary });
    expect(r.mode).toBe("SUMMARY.md");
    expect(outline(r.nodes)).toEqual([
      "README.md /home",
      "[Guides] /guides",
      "  guides/install.md /install",
      "    guides/docker.md /docker",
      "  guides/configure.md /configure",
      "[Reference] /reference",
      "  reference/cli.md /cli",
    ]);
  });

  it("uses a link's quoted title, or its text, as the sidebar label", () => {
    const r = nav([file("README.md", {}, "Home page"), file("guides/install.md"), file("guides/docker.md", {}, "Docker page")], { summary });
    const find = (key: string): NavNode => flattenPageTree(r.nodes).find((n) => n.key === key)!;
    expect(find("guides/install.md").navTitle).toBe("Installing");
    expect(find("guides/docker.md")).toMatchObject({ navTitle: "Docker", title: "Docker page" });
    expect(find("README.md")).toMatchObject({ navTitle: "Introduction", title: "Home page" });
  });

  it("does not treat SUMMARY.md as a page, and warns about files it does not list", () => {
    const r = nav(["SUMMARY.md", "README.md", "orphan.md"], { summary: "* [Home](README.md)\n" });
    expect(flattenPageTree(r.nodes).map((n) => n.key)).toEqual(["README.md"]);
    expect(r.unlisted).toEqual(["orphan.md"]);
  });

  it("resolves links relative to where the summary lives", () => {
    const r = nav(["docs/a.md"], { summary: "* [A](a.md)\n", config: { summaryPath: "docs/SUMMARY.md" } });
    expect(r.nodes.map((n) => n.key)).toEqual(["docs/a.md"]);
  });

  it("skips entries it cannot use, without losing the pages under them", () => {
    const text = "* Plain text\n  * [Kept](kept.md)\n* [Website](https://example.com)\n* [Outside](../x.md)\n";
    const r = nav(["kept.md"], { summary: text });
    expect(r.nodes.map((n) => n.key)).toEqual(["kept.md"]);
    expect(codes(r)).toEqual(expect.arrayContaining(["GS-206", "GS-170"]));
  });

  it("reports line numbers in the summary", () => {
    const r = nav([], { summary: "* [One](one.md)\n* [Two](two.md)\n" });
    expect(r.diagnostics.map((d) => [d.code, d.path, d.line])).toEqual([
      ["GS-121", "SUMMARY.md", 1],
      ["GS-121", "SUMMARY.md", 2],
    ]);
  });

  it("is overridden by gitcrook.yaml's nav", () => {
    const r = nav(["a.md", "b.md"], { summary: "* [B](b.md)\n", config: { nav: ["a.md"] } });
    expect(r.mode).toBe("gitcrook.yaml");
    expect(r.nodes.map((n) => n.key)).toEqual(["a.md"]);
  });

  it("copes with a large summary", () => {
    const text = Array.from({ length: 6000 }, (_, i) => `* [P${i}](p${i}.md)`).join("\n");
    const r = nav([], { summary: text });
    expect(codes(r)).toContain("GS-207");
  });

  it("parses to the same shape that gitcrook.yaml's nav does", () => {
    const entries = parseSummary("## G\n* [A](a.md)\n  * [B](b.md)\n", "SUMMARY.md", new Diagnostics("SUMMARY.md"));
    expect(entries).toMatchObject([{ kind: "group", label: "G", children: [{ kind: "page", path: "a.md", children: [{ kind: "page", path: "b.md" }] }] }]);
  });
});

describe("repository settings", () => {
  const read = (files: { gitcrook?: string; gitbook?: string }) => {
    const gitcrook = new Diagnostics("gitcrook.yaml");
    const gitbook = new Diagnostics(".gitbook.yaml");
    const config = readRepoConfig(files, { gitcrook, gitbook });
    return { config, diagnostics: [...gitcrook.items, ...gitbook.items] };
  };

  it("has sensible defaults", () => {
    expect(read({}).config).toEqual({ root: "", nav: null, summaryPath: "SUMMARY.md", readmePath: "README.md", redirects: {}, sources: [] });
  });

  it("reads gitcrook.yaml", () => {
    const { config, diagnostics } = read({ gitcrook: "version: 1\nroot: ./docs/\nnav:\n  - README.md\n  - group: Guides\n    pages: [guides/install.md]\nredirects:\n  old/path: guides/install\n" });
    expect(config).toMatchObject({ root: "docs", nav: ["README.md", { group: "Guides", pages: ["guides/install.md"] }], redirects: { "old/path": "guides/install" }, sources: ["gitcrook.yaml"] });
    expect(diagnostics).toEqual([]);
  });

  it("reads .gitbook.yaml", () => {
    const { config } = read({ gitbook: "root: ./site/\nstructure:\n  readme: Intro.md\n  summary: Contents.md\nredirects:\n  a: b\n" });
    expect(config).toMatchObject({ root: "site", readmePath: "Intro.md", summaryPath: "Contents.md", redirects: { a: "b" }, sources: [".gitbook.yaml"] });
  });

  it("lets gitcrook.yaml win where both say something", () => {
    const { config } = read({ gitbook: "root: ./old/\nredirects:\n  a: from-gitbook\n  b: kept\n", gitcrook: "root: new\nredirects:\n  a: from-gitcrook\n" });
    expect(config.root).toBe("new");
    expect(config.redirects).toEqual({ a: "from-gitcrook", b: "kept" });
  });

  it("refuses a root that leaves the repository", () => {
    const { config, diagnostics } = read({ gitcrook: "root: ../elsewhere\n" });
    expect(config.root).toBe("");
    expect(diagnostics.map((d) => d.code)).toContain("GS-170");
  });

  it("reports invalid YAML with a line number, and carries on with defaults", () => {
    const { config, diagnostics } = read({ gitcrook: "root: docs\nnav: [unclosed\n" });
    expect(config.nav).toBeNull();
    expect(diagnostics[0]).toMatchObject({ code: "GS-101", severity: "error", path: "gitcrook.yaml" });
    expect(diagnostics[0]!.line).toBeGreaterThanOrEqual(1);
  });

  it("reports a navigation of the wrong shape", () => {
    const { config, diagnostics } = read({ gitcrook: "nav:\n  - group: NoPages\n" });
    expect(config.nav).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(["GS-103"]);
  });

  it("notes keys it doesn't use", () => {
    expect(read({ gitcrook: "theme: dark\n" }).diagnostics.map((d) => d.code)).toContain("GS-102");
  });
});

describe("generated container pages", () => {
  it("list the pages below them as cards", () => {
    const r = nav([file("a/b/one.md", { description: "First" }, "One"), file("a/b/two.md", { hidden: true }), file("a/b/three.md", { draft: true }), file("a/b/four.md", {}, "Four")]);
    const container = r.nodes[0]!.children[0]!;
    const blocks = containerPageBlocks(container, (c) => `/${c.slug}`, "dir:a/b");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "cardGroup" });
    expect(blocks[0]!.children.map((c) => [c.props.title, c.props.description, c.props.href])).toEqual([
      ["Four", "", "/four"],
      ["One", "First", "/one"],
    ]);
  });

  it("have the same ids every time", () => {
    const r = nav(["a/b/one.md"]);
    const container = r.nodes[0]!.children[0]!;
    const a = containerPageBlocks(container, () => "/x", "dir:a/b");
    const b = containerPageBlocks(container, () => "/x", "dir:a/b");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("are empty when there is nothing to list", () => {
    const r = nav([file("a/b/one.md", { hidden: true })]);
    expect(containerPageBlocks(r.nodes[0]!.children[0]!, () => "/x", "s")).toEqual([]);
  });
});

describe("properties", () => {
  const segment = fc.stringMatching(/^[A-Za-z0-9 _.-]{1,8}$/).filter((s) => !/^[._]/.test(s.trim()) && s.trim() !== "" && !/\.$/.test(s));
  const paths = fc.uniqueArray(fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => `${s.join("/")}.md`), { maxLength: 40 });

  it("gives every sibling a distinct URL segment and every page a distinct path", () => {
    fc.assert(
      fc.property(paths, (list) => {
        const r = nav(list);
        const check = (nodes: NavNode[]) => {
          expect(new Set(nodes.map((n) => n.slug)).size).toBe(nodes.length);
          nodes.forEach((n) => check(n.children));
        };
        check(r.nodes);
        const urls = [...pathsForTree(r.nodes).values()].map((p) => p.join("/"));
        expect(new Set(urls).size).toBe(urls.length);
      }),
      { numRuns: 200 },
    );
  });

  it("publishes every file exactly once when the layout comes from the folders", () => {
    fc.assert(
      fc.property(paths, (list) => {
        const r = nav(list);
        const published = flattenPageTree(r.nodes)
          .map((n) => n.sourcePath)
          .filter((p): p is string => p !== null);
        expect(new Set(published).size).toBe(published.length);
        expect(published.sort()).toEqual([...new Set(list.map((p) => cleanRepoPath(p)!))].sort());
      }),
      { numRuns: 200 },
    );
  });

  it("does not depend on the order the files are given in", () => {
    fc.assert(
      fc.property(paths, fc.integer(), (list, seed) => {
        const shuffled = [...list].sort((a, b) => ((a + seed).length % 7) - ((b + seed).length % 7) || (a < b ? 1 : -1));
        expect(outline(nav(shuffled).nodes)).toEqual(outline(nav(list).nodes));
      }),
      { numRuns: 100 },
    );
  });

  it("only puts groups at the top", () => {
    fc.assert(
      fc.property(paths, (list) => {
        const r = nav(list);
        r.nodes.forEach((n) => n.children.forEach(function walk(c: NavNode) {
          expect(c.isGroup).toBe(false);
          c.children.forEach(walk);
        }));
      }),
      { numRuns: 200 },
    );
  });
});
