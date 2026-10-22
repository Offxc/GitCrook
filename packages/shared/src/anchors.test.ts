import { describe, expect, it } from "vitest";
import { anchorMap, collectHeadings, inlineText } from "./anchors";

const h = (id: string, text: string | unknown[], level = 2, children: unknown[] = []) => ({
  id,
  type: "heading",
  props: { level },
  content: typeof text === "string" ? [{ type: "text", text, styles: {} }] : text,
  children,
});
const p = (id: string, children: unknown[] = []) => ({ id, type: "paragraph", content: [], children });

describe("inlineText", () => {
  it("joins text runs", () => {
    expect(inlineText([{ type: "text", text: "Hello " }, { type: "text", text: "world", styles: { bold: true } }])).toBe("Hello world");
  });

  it("reads through links", () => {
    expect(inlineText([{ type: "text", text: "See " }, { type: "link", href: "/x", content: [{ type: "text", text: "the docs" }] }])).toBe("See the docs");
  });

  it("tolerates junk", () => {
    expect(inlineText(undefined)).toBe("");
    expect(inlineText([null, 3, {}, { type: "text" }])).toBe("");
    expect(inlineText("plain")).toBe("plain");
  });
});

describe("collectHeadings", () => {
  it("slugs the way GitHub does", () => {
    const out = collectHeadings([
      h("1", "Getting Started"),
      h("2", "What's new in v2.0?"),
      h("3", "Installing on Linux & macOS"),
      h("4", "  Trim me  "),
      h("5", "Café déjà vu"),
    ]);
    expect(out.map((x) => x.anchor)).toEqual(["getting-started", "whats-new-in-v20", "installing-on-linux--macos", "trim-me", "café-déjà-vu"]);
  });

  it("numbers repeated headings in document order", () => {
    const out = collectHeadings([h("a", "Usage"), p("x"), h("b", "Usage"), h("c", "Usage"), h("d", "Usage 1")]);
    expect(out.map((x) => x.anchor)).toEqual(["usage", "usage-1", "usage-2", "usage-1-1"]);
  });

  it("includes nested headings, in reading order, with their depth", () => {
    const out = collectHeadings([h("a", "One"), { id: "col", type: "columnList", children: [{ id: "c1", type: "column", children: [h("b", "Two", 3)] }] }, h("c", "Three")]);
    expect(out.map((x) => [x.anchor, x.depth])).toEqual([
      ["one", 0],
      ["two", 2],
      ["three", 0],
    ]);
  });

  it("uses text inside links", () => {
    const heading = h("a", [{ type: "link", href: "/", content: [{ type: "text", text: "Linked heading" }] }]);
    expect(collectHeadings([heading])[0]?.anchor).toBe("linked-heading");
  });

  it("skips empty headings and gives punctuation-only ones a usable anchor", () => {
    const out = collectHeadings([h("a", ""), h("b", "   "), h("c", "???"), h("d", "!!!")]);
    expect(out.map((x) => x.blockId)).toEqual(["c", "d"]);
    expect(out.map((x) => x.anchor)).toEqual(["section", "section-1"]);
  });

  it("clamps levels into 1-6 and defaults to 1", () => {
    const out = collectHeadings([h("a", "A", 9), h("b", "B", 0), { id: "c", type: "heading", content: [{ type: "text", text: "C" }] }]);
    expect(out.map((x) => x.level)).toEqual([6, 1, 1]);
  });

  it("is stable when unrelated blocks change (ids are not part of the slug)", () => {
    const first = collectHeadings([h("old-id", "Same Heading")]);
    const second = collectHeadings([h("new-id", "Same Heading")]);
    expect(first[0]?.anchor).toBe(second[0]?.anchor);
  });

  it.each([undefined, null, "x", 3, {}, [null, 1, "s"]])("tolerates non-document input %j", (input) => {
    expect(collectHeadings(input)).toEqual([]);
  });

  it("anchorMap maps block ids", () => {
    expect(anchorMap([h("a", "One"), h("b", "One")])).toEqual(
      new Map([
        ["a", "one"],
        ["b", "one-1"],
      ]),
    );
  });
});
