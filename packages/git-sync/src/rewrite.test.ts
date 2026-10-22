import { describe, expect, it } from "vitest";
import type { Block } from "@gitcrook/markdown";
import { relativeUrl, rewriteBlocks, type Target } from "./rewrite";

const t = (text: string) => ({ type: "text" as const, text, styles: {} });
const b = (type: string, props: Record<string, unknown> = {}, content?: Block["content"], children: Block[] = []): Block => ({ id: type, type, props, ...(content !== undefined ? { content } : {}), children });
const link = (href: string, text = "x") => ({ type: "link" as const, href, content: [t(text)] });

const targets: Record<string, Target> = {
  "guides/install.md": { kind: "page", segments: ["docs", "guides", "install"] },
  "guides/configure.md": { kind: "page", segments: ["docs", "guides", "configure"] },
  "README.md": { kind: "page", segments: ["docs", "home"] },
  "reference/cli.md": { kind: "page", segments: ["docs", "reference", "cli"] },
  "dir:guides": { kind: "page", segments: ["docs", "guides", "overview"] },
  "img/a.png": { kind: "asset", url: "/api/files/asset-1" },
};
const run = (blocks: Block[], fromPath = "guides/install.md", pageSegments = ["docs", "guides", "install"]) =>
  rewriteBlocks(blocks, { fromPath, pageSegments, lookup: (p) => targets[p] });

describe("relativeUrl", () => {
  it.each([
    [["docs", "guides", "install"], ["docs", "guides", "configure"], "configure"],
    [["docs", "guides", "install"], ["docs", "reference", "cli"], "../reference/cli"],
    [["docs", "guides", "install"], ["docs", "home"], "../home"],
    [["docs", "home"], ["docs", "guides", "install"], "guides/install"],
    [["a", "b"], ["a"], "../a"],
    [["a"], ["b"], "b"],
    [["a"], ["a"], "a"],
    [["x", "y", "z"], ["x", "y", "z"], "z"],
    [["a", "b", "c"], ["d"], "../../d"],
  ])("%j → %j is %s", (from, to, expected) => {
    expect(relativeUrl(from, to)).toBe(expected);
  });

  it("resolves back to the target, whatever the two pages are", () => {
    const base = "https://site.example/";
    const pages = [["a"], ["a", "b"], ["a", "b", "c"], ["x"], ["x", "y"], ["a", "x", "y", "z"]];
    for (const from of pages) {
      for (const to of pages) {
        const resolved = new URL(relativeUrl(from, to), `${base}${from.join("/")}`);
        expect(resolved.pathname, `${from.join("/")} → ${to.join("/")}`).toBe(`/${to.join("/")}`);
      }
    }
  });
});

describe("rewriteBlocks", () => {
  it("turns a link to another file into a path relative to the page", () => {
    const { blocks, pageLinks } = run([b("paragraph", {}, [t("See "), link("./configure.md", "config"), t(" and "), link("../reference/cli.md#flags", "cli")])]);
    expect(blocks[0]!.content).toEqual([t("See "), link("configure", "config"), t(" and "), link("../reference/cli#flags", "cli")]);
    expect(pageLinks).toEqual(["guides/configure.md", "reference/cli.md"]);
  });

  it("keeps a query or fragment", () => {
    const { blocks } = run([b("paragraph", {}, [link("configure.md?tab=a#x")])]);
    expect(blocks[0]!.content).toEqual([link("configure?tab=a#x")]);
  });

  it("leaves external links, mail, anchors and absolute URLs alone", () => {
    const content = [link("https://example.com/a.md"), link("mailto:a@b.co"), link("#section"), link("//cdn.example.com/x"), link("tel:+1")];
    const { blocks, pageLinks, assets, problems } = run([b("paragraph", {}, content)]);
    expect(blocks[0]!.content).toEqual(content);
    expect(pageLinks).toEqual([]);
    expect(assets).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("points images and other files at what they were imported as", () => {
    const { blocks, assets } = run([b("image", { url: "../img/a.png", caption: "", name: "" }), b("card", { title: "T", href: "", imageUrl: "../img/a.png", description: "" })]);
    expect(blocks[0]!.props.url).toBe("/api/files/asset-1");
    expect(blocks[1]!.props.imageUrl).toBe("/api/files/asset-1");
    expect(assets).toEqual(["img/a.png"]);
  });

  it("rewrites the URL props of buttons, cards and page links, at any depth", () => {
    const { blocks } = run([
      b("columnList", {}, undefined, [b("column", {}, undefined, [b("button", { label: "Go", href: "./configure.md", style: "primary" }), b("pageLink", { href: "../README.md", title: "Home", description: "" })])]),
      b("cardGroup", {}, undefined, [b("card", { title: "C", href: "../reference/cli.md", imageUrl: "", description: "" })]),
    ]);
    expect(blocks[0]!.children[0]!.children[0]!.props.href).toBe("configure");
    expect(blocks[0]!.children[0]!.children[1]!.props.href).toBe("../home");
    expect(blocks[1]!.children[0]!.props.href).toBe("../reference/cli");
  });

  it("reaches links inside tables and list items", () => {
    const cell = (c: ReturnType<typeof link>[]) => ({ type: "tableCell" as const, content: c, props: {} });
    const { blocks } = run([
      b("table", {}, { type: "tableContent", rows: [{ cells: [cell([link("configure.md")])] }] }),
      b("bulletListItem", {}, [link("../README.md")], [b("bulletListItem", {}, [link("configure.md")])]),
    ]);
    expect((blocks[0]!.content as { rows: { cells: { content: unknown }[] }[] }).rows[0]!.cells[0]!.content).toEqual([link("configure")]);
    expect(blocks[1]!.content).toEqual([link("../home")]);
    expect(blocks[1]!.children[0]!.content).toEqual([link("configure")]);
  });

  it("sends a link to a folder to the folder's page", () => {
    const { blocks } = run([b("paragraph", {}, [link("../guides/")])], "reference/cli.md", ["docs", "reference", "cli"]);
    expect(blocks[0]!.content).toEqual([link("../guides/overview")]);
  });

  it("resolves links relative to the file, not to the repository", () => {
    const { blocks } = run([b("paragraph", {}, [link("cli.md")])], "reference/page.md", ["docs", "reference", "page"]);
    expect(blocks[0]!.content).toEqual([link("cli")]);
  });

  it("reports a link to nothing, leaves it as written, and still records it", () => {
    const { blocks, pageLinks, problems } = run([b("paragraph", {}, [link("./missing.md")]), b("image", { url: "./nope.png" })]);
    expect(blocks[0]!.content).toEqual([link("./missing.md")]);
    expect(pageLinks).toEqual(["guides/missing.md"]);
    expect(problems.map((p) => p.code)).toEqual(["GS-130", "GS-131"]);
  });

  it("reports each missing target once", () => {
    const { problems } = run([b("paragraph", {}, [link("./missing.md"), link("./missing.md")])]);
    expect(problems).toHaveLength(1);
  });

  it("will not follow a path out of the repository", () => {
    const { blocks, problems } = run([b("paragraph", {}, [link("../../../etc/passwd")]), b("image", { url: "../../../../secret.png" })]);
    expect(problems.map((p) => p.code)).toEqual(["GS-170", "GS-170"].slice(0, problems.length));
    expect(JSON.stringify(blocks)).not.toContain("etc/passwd");
    expect(blocks[1]!.props.url).toBe("");
  });

  it("does not change blocks that have nothing to rewrite, and never mutates its input", () => {
    const input = [b("paragraph", {}, [t("plain")]), b("heading", { level: 2 }, [t("H")])];
    const snapshot = JSON.stringify(input);
    const { blocks } = run(input);
    expect(JSON.stringify(blocks)).toBe(snapshot);
    run([b("paragraph", {}, [link("configure.md")])]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
