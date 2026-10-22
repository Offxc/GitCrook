import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { anchorMap } from "@gitcrook/shared";
import { renderBlocks, type RenderBlock } from "./blockRenderer";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const link = (href: string, ...inner: unknown[]) => ({ type: "link", href, content: inner });

function html(blocks: RenderBlock[], codeHtml = new Map<string, string>()): string {
  return renderToStaticMarkup(<>{renderBlocks(blocks, { codeHtml, anchors: anchorMap(blocks) })}</>);
}

const paragraph = (content: unknown[], props: Record<string, unknown> = {}, children: RenderBlock[] = []): RenderBlock => ({
  id: "p",
  type: "paragraph",
  props,
  content,
  children,
});

describe("quote (B4: rendered as a plain paragraph before)", () => {
  it("renders a blockquote with its text", () => {
    const out = html([{ id: "q", type: "quote", props: {}, content: [text("To be, or not to be")] }]);
    expect(out).toContain("<blockquote");
    expect(out).toContain("To be, or not to be");
  });

  it("keeps nested blocks inside the quote", () => {
    const out = html([{ id: "q", type: "quote", props: {}, content: [text("outer")], children: [paragraph([text("inner")])] }]);
    expect(out).toMatch(/<blockquote[^>]*>outer<div[^>]*><p[^>]*>inner<\/p><\/div><\/blockquote>/);
  });
});

describe("video and audio (B4: rendered nothing before)", () => {
  it("renders a video with controls, a download fallback and a caption", () => {
    const out = html([{ id: "v", type: "video", props: { url: "/api/files/abc", caption: "Demo", name: "demo.mp4" } }]);
    expect(out).toContain('<video controls="" preload="metadata" src="/api/files/abc"');
    expect(out).toContain('<a href="/api/files/abc">demo.mp4</a>');
    expect(out).toContain("<figcaption");
    expect(out).toContain("Demo");
  });

  it("renders audio", () => {
    const out = html([{ id: "a", type: "audio", props: { url: "https://cdn.example.com/a.mp3", caption: "" } }]);
    expect(out).toContain('<audio controls="" preload="metadata" src="https://cdn.example.com/a.mp3"');
    expect(out).not.toContain("<figcaption");
  });

  it("renders nothing without a usable URL", () => {
    expect(html([{ id: "v", type: "video", props: { url: "" } }])).toBe("");
    expect(html([{ id: "v", type: "video", props: { url: "javascript:alert(1)" } }])).toBe("");
    expect(html([{ id: "a", type: "audio", props: { url: "data:audio/mp3;base64,AAAA" } }])).toBe("");
  });

  it("applies a preview width to the figure", () => {
    const out = html([{ id: "v", type: "video", props: { url: "/x.mp4", previewWidth: 320 } }]);
    expect(out).toContain("width:320px");
  });
});

describe("tables (B4: no <th>, header rows ignored)", () => {
  const cell = (t: string, props: Record<string, unknown> = {}) => ({ type: "tableCell", content: [text(t)], props });
  const table = (content: Record<string, unknown>): RenderBlock => ({ id: "t", type: "table", content: { type: "tableContent", ...content } });

  it("puts header rows in <thead> as scoped <th>", () => {
    const out = html([table({ headerRows: 1, rows: [{ cells: [cell("Name"), cell("Role")] }, { cells: [cell("Ada"), cell("Admin")] }] })]);
    expect(out).toMatch(/<thead><tr><th scope="col"[^>]*>Name<\/th><th scope="col"[^>]*>Role<\/th><\/tr><\/thead>/);
    expect(out).toMatch(/<tbody><tr><td[^>]*>Ada<\/td><td[^>]*>Admin<\/td><\/tr><\/tbody>/);
  });

  it("makes header columns row headers", () => {
    const out = html([table({ headerCols: 1, rows: [{ cells: [cell("Ada"), cell("Admin")] }] })]);
    expect(out).toContain('<th scope="row"');
    expect(out).toContain("<td");
    expect(out).not.toContain("<thead>");
  });

  it("uses plain cells when there are no headers", () => {
    const out = html([table({ rows: [{ cells: [cell("a")] }] })]);
    expect(out).not.toContain("<th");
    expect(out).toContain("<td");
  });

  it("honours column spans, widths, alignment and colours", () => {
    const out = html([
      table({
        columnWidths: [120, undefined],
        rows: [{ cells: [cell("wide", { colspan: 2, textAlignment: "right", backgroundColor: "red" })] }],
      }),
    ]);
    expect(out).toContain('colSpan="2"');
    expect(out).toContain("text-align:right");
    expect(out).toContain('data-bg="red"');
    expect(out).toContain("<colgroup><col style=\"width:120px\"/><col/></colgroup>");
  });

  it("still reads the older bare-array cell shape", () => {
    const out = html([{ id: "t", type: "table", content: { rows: [{ cells: [[text("legacy")]] }] } }]);
    expect(out).toContain("legacy");
  });

  it("renders nothing for a table with no rows array", () => {
    expect(html([{ id: "t", type: "table", content: {} }])).toBe("");
  });
});

describe("inline content", () => {
  it("turns a typed newline into a <br>", () => {
    expect(html([paragraph([text("line one\nline two")])])).toContain("line one<br/>line two");
  });

  it("applies text and background colours", () => {
    const out = html([paragraph([text("hot", { textColor: "red", backgroundColor: "yellow" })])]);
    expect(out).toContain('<span data-tc="red" data-bg="yellow">hot</span>');
  });

  it("ignores colours it doesn't know (nothing arbitrary reaches an attribute)", () => {
    const out = html([paragraph([text("x", { textColor: "red;background:url(x)" })])]);
    expect(out).not.toContain("data-tc");
  });

  it("combines styles", () => {
    const out = html([paragraph([text("x", { bold: true, italic: true, strike: true, underline: true, code: true })])]);
    expect(out).toMatch(/<u><s><em><strong><code[^>]*>x<\/code><\/strong><\/em><\/s><\/u>/);
  });

  it("renders safe links as links", () => {
    const out = html([paragraph([link("https://example.com/a", text("docs"))])]);
    expect(out).toContain('<a href="https://example.com/a"');
  });

  it("keeps the words of a link whose target is unsafe, without the link", () => {
    const out = html([paragraph([link("javascript:alert(1)", text("click me"))])]);
    expect(out).toContain("click me");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
  });
});

describe("block colour and alignment (B4: vanished before)", () => {
  it("applies them to a paragraph", () => {
    const out = html([paragraph([text("x")], { textColor: "blue", backgroundColor: "gray", textAlignment: "center" })]);
    expect(out).toContain('data-tc="blue"');
    expect(out).toContain('data-bg="gray"');
    expect(out).toContain("text-align:center");
  });

  it("leaves left-aligned, default-coloured text unmarked", () => {
    const out = html([paragraph([text("x")], { textColor: "default", backgroundColor: "default", textAlignment: "left" })]);
    expect(out).not.toContain("data-tc");
    expect(out).not.toContain("data-bg");
    expect(out).not.toContain("text-align");
  });
});

describe("headings and anchors (B5)", () => {
  const heading = (id: string, t: string, props: Record<string, unknown> = {}, children: RenderBlock[] = []): RenderBlock => ({
    id,
    type: "heading",
    props: { level: 2, ...props },
    content: [text(t)],
    children,
  });

  it("gives each heading a readable id and a link to it", () => {
    const out = html([heading("b9", "Installing on Linux")]);
    expect(out).toContain('id="installing-on-linux"');
    expect(out).toContain('<a href="#installing-on-linux" class="heading-anchor" aria-label="Link to this section">#</a>');
    expect(out).not.toContain("b9");
  });

  it("numbers repeated headings", () => {
    const out = html([heading("1", "Usage"), heading("2", "Usage")]);
    expect(out).toContain('id="usage"');
    expect(out).toContain('id="usage-1"');
  });

  it("emits children after the heading rather than inside it", () => {
    const out = html([heading("h", "Title", {}, [paragraph([text("child")])])]);
    expect(out).toMatch(/<\/h2><div><p[^>]*>child<\/p><\/div>/);
    expect(/<h2[^>]*>(.*?)<\/h2>/.exec(out)?.[1]).not.toContain("<p");
  });

  it("folds a toggleable heading", () => {
    const out = html([heading("h", "Title", { isToggleable: true }, [paragraph([text("hidden")])])]);
    expect(out).toContain("<details");
    expect(out).toMatch(/<summary[^>]*><svg[^>]*aria-hidden="true"[^>]*><path[^>]*><\/path><\/svg><h2/); // a chevron, then the heading
    expect(out).toContain("hidden");
  });
});

describe("lists", () => {
  const li = (id: string, t: string, type = "bulletListItem", props: Record<string, unknown> = {}): RenderBlock => ({ id, type, props, content: [text(t)] });

  it("groups consecutive items into one list", () => {
    const out = html([li("1", "a"), li("2", "b"), paragraph([text("break")]), li("3", "c")]);
    expect(out.match(/<ul/g)).toHaveLength(2);
    expect(out.match(/<li/g)).toHaveLength(3);
  });

  it("keeps ordered and unordered lists apart", () => {
    const out = html([li("1", "a"), li("2", "b", "numberedListItem")]);
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
  });

  it("starts a numbered list where it says to", () => {
    expect(html([li("1", "a", "numberedListItem", { start: 5 })])).toContain('<ol start="5"');
    expect(html([li("1", "a", "numberedListItem", { start: 1 })])).not.toContain("start=");
  });

  it("nests children inside the item", () => {
    const parent: RenderBlock = { ...li("1", "parent"), children: [li("2", "child")] };
    expect(html([parent])).toMatch(/<li[^>]*>parent<ul[^>]*><li[^>]*>child<\/li><\/ul><\/li>/);
  });
});

describe("structure and safety", () => {
  it("does not put block content inside a <p>", () => {
    const out = html([paragraph([text("outer")], {}, [paragraph([text("inner")])])]);
    expect(out).toMatch(/<p[^>]*>outer<\/p><div[^>]*><p[^>]*>inner<\/p><\/div>/);
  });

  it("refuses unsafe URLs in buttons, cards, page links and files", () => {
    const bad = "javascript:alert(1)";
    expect(html([{ id: "b", type: "button", props: { href: bad, label: "Go" } }])).toBe("");
    expect(html([{ id: "p", type: "pageLink", props: { href: bad, title: "T" } }])).toBe("");
    expect(html([{ id: "f", type: "file", props: { url: bad, name: "F" } }])).toBe("");
    const card = html([{ id: "c", type: "card", props: { href: bad, title: "Card", imageUrl: bad } }]);
    expect(card).toContain("Card");
    expect(card).not.toContain("javascript:");
    expect(card).not.toContain("<a ");
    expect(card).not.toContain("<img");
  });

  it("lazy-loads images and labels them", () => {
    const out = html([{ id: "i", type: "image", props: { url: "/api/files/x", caption: "A cat" } }]);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('alt="A cat"');
  });

  it("shows the text of a block type it doesn't know instead of dropping it", () => {
    expect(html([{ id: "x", type: "futureBlock", content: [text("still here")] }])).toContain("still here");
    expect(html([{ id: "x", type: "futureLeaf", content: undefined }])).toBe("");
  });

  it("renders each custom block's essentials", () => {
    const out = html([
      { id: "h", type: "hint", props: { hintStyle: "warning", hintTitle: "Careful" }, content: [text("body")] },
      { id: "c", type: "checkListItem", props: { checked: true }, content: [text("done")] },
      { id: "d", type: "divider" },
      { id: "m", type: "math", props: { formula: "x^2" } },
      { id: "u", type: "updates", children: [{ id: "u1", type: "update", props: { date: "2026-01-01", tags: "a, b," }, content: [text("Shipped")] }] },
    ]);
    expect(out).toContain("hint-warning");
    expect(out).toContain("Careful");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("<hr");
    expect(out).toContain("katex");
    expect(out).toContain("Shipped");
    expect(out.match(/rounded-full bg-site-surface/g)).toHaveLength(2); // the empty tag from the trailing comma is dropped
  });

  it("lays out a step list with numbers", () => {
    const out = html([{ id: "s", type: "stepper", children: [{ id: "s1", type: "step", props: { index: 1 }, content: [text("First")] }] }]);
    expect(out).toContain(">1</span>");
    expect(out).toContain("First");
  });
});
