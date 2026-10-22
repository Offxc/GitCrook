import { describe, expect, it } from "vitest";
import { ancestorsOf, buildPageTree, flattenNavigablePages, flattenPageTree, pathsForTree, prefixPaths, type PageTreeRow } from "./pageTree";

const row = (id: string, parentId: string | null, over: Partial<PageTreeRow> = {}): PageTreeRow => ({
  id,
  parentId,
  title: id.toUpperCase(),
  slug: id,
  icon: null,
  isGroup: false,
  ...over,
});

// intro, then group g1 { a, b { b1 } }, then group g2 { c }, then outro
const rows: PageTreeRow[] = [
  row("intro", null),
  row("g1", null, { isGroup: true }),
  row("a", "g1"),
  row("b", "g1"),
  row("b1", "b"),
  row("g2", null, { isGroup: true }),
  row("c", "g2"),
  row("outro", null),
];

describe("buildPageTree", () => {
  const tree = buildPageTree(rows);

  it("nests rows under their parents in the order given", () => {
    expect(tree.map((n) => n.id)).toEqual(["intro", "g1", "g2", "outro"]);
    expect(tree[1]!.children.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[1]!.children[1]!.children.map((n) => n.id)).toEqual(["b1"]);
  });

  it("drops rows whose parent doesn't exist rather than inventing a root for them", () => {
    expect(buildPageTree([row("orphan", "ghost"), row("ok", null)]).map((n) => n.id)).toEqual(["ok"]);
  });

  it("survives a parent cycle in corrupt data", () => {
    const cyc = buildPageTree([row("x", "y"), row("y", "x"), row("root", null)]);
    expect(cyc.map((n) => n.id)).toEqual(["root"]);
  });

  it("is empty for no rows", () => {
    expect(buildPageTree([])).toEqual([]);
  });
});

describe("flattening", () => {
  const tree = buildPageTree(rows);

  it("flattenPageTree is depth-first display order, groups included", () => {
    expect(flattenPageTree(tree).map((n) => n.id)).toEqual(["intro", "g1", "a", "b", "b1", "g2", "c", "outro"]);
  });

  it("flattenNavigablePages leaves out groups so prev/next never points at a group", () => {
    const nav = flattenNavigablePages(tree).map((n) => n.id);
    expect(nav).toEqual(["intro", "a", "b", "b1", "c", "outro"]);
    // The A4 regression: the page before a group's first page is the last page of the previous group.
    expect(nav[nav.indexOf("c") - 1]).toBe("b1");
  });
});

describe("ancestorsOf", () => {
  const tree = buildPageTree(rows);

  it("lists the chain above a page, outermost first, without the page", () => {
    expect(ancestorsOf(tree, "b1").map((n) => n.id)).toEqual(["g1", "b"]);
    expect(ancestorsOf(tree, "a").map((n) => n.id)).toEqual(["g1"]);
  });

  it("is empty for a top-level page or an unknown id", () => {
    expect(ancestorsOf(tree, "intro")).toEqual([]);
    expect(ancestorsOf(tree, "nope")).toEqual([]);
  });
});

describe("paths", () => {
  const tree = buildPageTree(rows);

  it("pathsForTree builds slug chains", () => {
    const paths = pathsForTree(tree);
    expect(paths.get("intro")).toEqual(["intro"]);
    expect(paths.get("b1")).toEqual(["g1", "b", "b1"]);
    expect(paths.size).toBe(rows.length);
  });

  it("prefixPaths puts section, space and variant segments in front of every link", () => {
    const prefixed = prefixPaths(pathsForTree(tree), ["guides", "~v", "v2"]);
    expect(prefixed.get("a")).toEqual(["guides", "~v", "v2", "g1", "a"]);
  });

  it("prefixPaths with nothing to add returns the same map", () => {
    const paths = pathsForTree(tree);
    expect(prefixPaths(paths, [])).toBe(paths);
  });
});
