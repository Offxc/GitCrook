import { describe, expect, it } from "vitest";
import { parseMarkdown, type Block, type ParseOptions } from "../index";
import { strip } from "./helpers";

const parse = (src: string, options: ParseOptions = {}) => parseMarkdown(src, { path: "docs/page.md", ...options });
const blocksOf = (src: string, options: ParseOptions = {}) => strip(parse(src, { extractTitle: false, ...options }).blocks) as Array<{ type: string; props: Record<string, unknown>; content?: unknown; children: unknown[] }>;
const codes = (src: string, options: ParseOptions = {}) => parse(src, options).diagnostics.map((d) => d.code);
const text = (s: string, styles = {}) => ({ type: "text", text: s, styles });

describe("front matter", () => {
  it("reads the keys GitCrook knows", () => {
    const { frontMatter, title } = parse('---\ntitle: Getting started\ndescription: First steps\nicon: rocket\nslug: start\norder: 3\ndraft: true\nhidden: true\nredirect_from: [old, older]\nid: abc\nnav_title: Start\n---\n\nBody\n');
    expect(frontMatter).toMatchObject({ title: "Getting started", description: "First steps", icon: "rocket", slug: "start", order: 3, draft: true, hidden: true, redirect_from: ["old", "older"], id: "abc", nav_title: "Start" });
    expect(title).toBe("Getting started");
  });

  it("accepts a single redirect_from string", () => {
    expect(parse("---\nredirect_from: /old\n---\n").frontMatter.redirect_from).toEqual(["/old"]);
  });

  it("keeps unknown keys without interpreting them, and says so", () => {
    const result = parse("---\ntitle: A\nlayout: wide\n---\n");
    expect(result.frontMatter.extra).toEqual({ layout: "wide" });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-102"]);
    expect(result.diagnostics[0]!.severity).toBe("info");
  });

  it("ignores a key with the wrong type but keeps the rest", () => {
    const result = parse("---\ntitle: Fine\norder: soon\nslug: Not A Slug\n---\n");
    expect(result.frontMatter.title).toBe("Fine");
    expect(result.frontMatter.order).toBeUndefined();
    expect(result.frontMatter.slug).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-103", "GS-103"]);
  });

  it("reports invalid YAML against the line in the real file, and carries on with the body", () => {
    const result = parse("---\ntitle: ok\nbad: [unclosed\n---\n\n# Hello\n\nText\n", { extractTitle: false });
    const yamlError = result.diagnostics.find((d) => d.code === "GS-101");
    expect(yamlError).toBeDefined();
    expect(yamlError!.severity).toBe("error");
    expect(yamlError!.path).toBe("docs/page.md");
    expect(yamlError!.line).toBeGreaterThanOrEqual(2);
    expect(yamlError!.line).toBeLessThanOrEqual(5);
    expect(result.blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
  });

  it("rejects front matter that is not a mapping", () => {
    expect(codes("---\n- a\n- b\n---\n")).toContain("GS-101");
  });

  it("treats duplicate keys as invalid", () => {
    expect(codes("---\ntitle: a\ntitle: b\n---\n")).toContain("GS-101");
  });

  it("refuses a YAML alias bomb as invalid front matter instead of expanding it", () => {
    const bomb = ["a: &a [x, x, x, x, x, x, x, x, x, x, x]", ...Array.from({ length: 12 }, (_, i) => `b${i}: [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a, *a]`)].join("\n");
    const started = Date.now();
    const result = parse(`---\n${bomb}\n---\n\nStill readable.\n`, { extractTitle: false });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-101");
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("survives front matter nested far deeper than any real file, quickly", () => {
    const depth = 15_000; // the longest allowed front matter, nearly all of it brackets
    for (const nest of [`${"[".repeat(depth)}${"]".repeat(depth)}`, `${"{a: ".repeat(depth / 2)}1${"}".repeat(depth / 2)}`]) {
      const started = Date.now();
      const result = parse(`---\ntitle: T\ndeep: ${nest}\n---\n\nStill readable.\n`, { extractTitle: false });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    }
  });

  it("ignores front matter that is far longer than any real header, without parsing it", () => {
    const huge = `title: T\n${"#".repeat(200_000)}\n`;
    const started = Date.now();
    const result = parse(`---\n${huge}---\n\nBody.\n`, { extractTitle: false });
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.frontMatter.title).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-101"]);
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("is not triggered by a file that merely opens with a divider", () => {
    const result = parse("---\n\nText\n", { extractTitle: false });
    expect(result.frontMatter).toMatchObject({ draft: false, hidden: false });
    expect(result.blocks.map((b) => b.type)).toEqual(["divider", "paragraph"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows `...` as the closing fence", () => {
    expect(parse("---\ntitle: Dots\n...\nBody\n").frontMatter.title).toBe("Dots");
  });

  it("keeps later line numbers pointing at the real file", () => {
    const result = parse("---\ntitle: T\n---\n\nSome text\n\n::embed{url=\"https://example.com/nope\"}\n");
    const warning = result.diagnostics.find((d) => d.code === "GS-205");
    expect(warning?.line).toBe(7);
  });

  it("handles CRLF files and a byte-order mark", () => {
    const result = parse("﻿---\r\ntitle: Windows\r\n---\r\n\r\nHello\r\nthere\r\n", { extractTitle: false });
    expect(result.frontMatter.title).toBe("Windows");
    expect(strip(result.blocks)).toEqual([{ type: "paragraph", props: {}, content: [text("Hello there")], children: [] }]);
  });
});

describe("the title", () => {
  it("comes from front matter when there is one", () => {
    expect(parse("---\ntitle: From YAML\n---\n\n# Heading\n").title).toBe("From YAML");
  });

  it("is taken from a leading H1, which is then not repeated in the body", () => {
    const result = parse("# Install\n\nRun it.\n");
    expect(result.title).toBe("Install");
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("drops a leading H1 that repeats the front-matter title", () => {
    const result = parse("---\ntitle: Install\n---\n\n#  install \n\nRun it.\n");
    expect(result.title).toBe("Install");
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("keeps a leading H1 that differs from the front-matter title", () => {
    const result = parse("---\ntitle: Install\n---\n\n# Something else\n");
    expect(result.blocks.map((b) => b.type)).toEqual(["heading"]);
  });

  it("only looks at the first block, and only at H1s", () => {
    expect(parse("Intro\n\n# Later\n").title).toBeNull();
    expect(parse("## Section\n").title).toBeNull();
  });

  it("can be switched off", () => {
    const result = parse("# Install\n", { extractTitle: false });
    expect(result.title).toBeNull();
    expect(result.blocks).toHaveLength(1);
  });

  it("uses the plain text of a formatted heading", () => {
    expect(parse("# The **bold** `code`\n").title).toBe("The bold code");
  });
});

describe("text blocks", () => {
  it("keeps every heading level from 1 to 6", () => {
    const levels = parse("# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n", { extractTitle: false }).blocks.map((b) => b.props.level);
    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("maps emphasis, strike, code and links to styles", () => {
    expect(blocksOf("**b** *i* ~~s~~ `c` [l](https://x.co)\n")[0]).toMatchObject({
      type: "paragraph",
      content: [text("b", { bold: true }), text(" "), text("i", { italic: true }), text(" "), text("s", { strike: true }), text(" "), text("c", { code: true }), text(" "), { type: "link", href: "https://x.co", content: [text("l")] }],
    });
  });

  it("merges neighbouring runs with the same style", () => {
    expect(blocksOf("a **b**<!-- note -->**c** d\n")[0]!.content).toEqual([text("a "), text("bc", { bold: true }), text(" d")]);
  });

  it("reads <u> as underline and a backslash or <br> as a line break", () => {
    expect(blocksOf("<u>under</u> and\\\nbroken<br>again\n")[0]!.content).toEqual([text("under", { underline: true }), text(" and\nbroken\nagain")]);
  });

  it("treats a soft line break as a space", () => {
    expect(blocksOf("one\ntwo\n")[0]!.content).toEqual([text("one two")]);
  });

  it("nests bold inside a link inside italics", () => {
    const content = blocksOf("*[**x**](https://x.co)*\n")[0]!.content as unknown[];
    expect(content).toEqual([{ type: "link", href: "https://x.co", content: [text("x", { bold: true, italic: true })] }]);
  });

  it("resolves reference-style links through their definitions", () => {
    const block = blocksOf("See [the docs][d].\n\n[d]: https://docs.example.com\n")[0]!;
    expect(block.content).toEqual([text("See "), { type: "link", href: "https://docs.example.com", content: [text("the docs")] }, text(".")]);
  });

  it("shows a reference with no definition as the text it was", () => {
    expect(blocksOf("See [missing][nope].\n")[0]!.content).toEqual([text("See [missing][nope].")]);
  });

  it("moves an image in the middle of a paragraph onto its own line, keeping the text on both sides", () => {
    const blocks = blocksOf("Click ![the icon](./i.png) now\n");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(blocks[0]!.content).toEqual([text("Click")]);
    expect(blocks[1]!.props).toMatchObject({ url: "./i.png", name: "the icon" });
    expect(blocks[2]!.content).toEqual([text("now")]);
    expect(codes("Click ![the icon](./i.png) now\n")).toEqual(["GS-206"]);
  });

  it("splits around several images and keeps formatting in the text between them", () => {
    const blocks = blocksOf("**Bold** ![a](./a.png) and *italic* ![b](./b.png)\n");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph", "image"]);
    expect(blocks[2]!.content).toEqual([text("and "), text("italic", { italic: true })]);
  });

  it("adds no block for an image that has nothing around it, and says nothing", () => {
    expect(blocksOf("![only](./a.png)\n").map((b) => b.type)).toEqual(["image"]);
    expect(codes("![only](./a.png)\n")).toEqual([]);
  });

  it("replaces an image inside a link (a badge) with its description, and says so", () => {
    const src = "[![Build](./badge.svg)](https://ci.example.com)\n";
    expect(blocksOf(src)[0]!.content).toEqual([{ type: "link", href: "https://ci.example.com", content: [text("Build")] }]);
    expect(codes(src)).toEqual(["GS-206"]);
  });

  it("reads GitHub-style autolinks", () => {
    const content = blocksOf("Go to https://example.com now\n")[0]!.content as Array<{ type: string; href?: string }>;
    expect(content.find((r) => r.type === "link")?.href).toBe("https://example.com");
  });
});

describe("lists", () => {
  it("maps bullets, numbers and task items", () => {
    expect(blocksOf("- a\n- b\n\n1. c\n2. d\n\n- [ ] e\n- [x] f\n").map((b) => [b.type, b.props])).toEqual([
      ["bulletListItem", {}],
      ["bulletListItem", {}],
      ["numberedListItem", {}],
      ["numberedListItem", {}],
      ["checkListItem", { checked: false }],
      ["checkListItem", { checked: true }],
    ]);
  });

  it("remembers where a numbered list starts", () => {
    expect(blocksOf("3. three\n4. four\n").map((b) => b.props)).toEqual([{ start: 3 }, {}]);
  });

  it("nests sub-lists, paragraphs and code under the item", () => {
    const [item] = blocksOf("- parent\n  - child\n\n  More text\n\n  ```js\n  x\n  ```\n");
    expect(item).toMatchObject({ type: "bulletListItem", content: [text("parent")] });
    expect((item!.children as Array<{ type: string }>).map((c) => c.type)).toEqual(["bulletListItem", "paragraph", "codeBlock"]);
  });
});

describe("code", () => {
  it("normalises language aliases", () => {
    const langs = ["js", "ts", "sh", "yml", "py", "rs", "golang", "plaintext", ""].map((l) => blocksOf(`\`\`\`${l}\nx\n\`\`\`\n`)[0]!.props.language);
    expect(langs).toEqual(["javascript", "typescript", "bash", "yaml", "python", "rust", "go", "text", "text"]);
  });

  it("reads a title from the fence's info string", () => {
    expect(blocksOf('```bash title="install.sh"\npnpm i\n```\n')[0]).toMatchObject({ type: "codeBlock", props: { language: "bash", title: "install.sh" }, content: [text("pnpm i")] });
  });

  it("keeps the code exactly, including blank lines and indentation", () => {
    expect(blocksOf("```\n  a\n\n    b\n```\n")[0]!.content).toEqual([text("  a\n\n    b")]);
  });

  it("represents an empty code block with no text", () => {
    expect(blocksOf("```\n```\n")[0]!.content).toEqual([]);
  });

  it("reads display math", () => {
    expect(blocksOf("$$\nx^2 + y^2\n$$\n")[0]).toMatchObject({ type: "math", props: { formula: "x^2 + y^2" } });
  });

  it("does not turn a dollar amount into math", () => {
    expect(blocksOf("It costs $5 and $6.\n")[0]).toMatchObject({ type: "paragraph", content: [text("It costs $5 and $6.")] });
  });
});

describe("images", () => {
  it("makes a paragraph that is only an image into an image block with a reference", () => {
    const result = parse('![Alt text](./img/a.png "A caption")\n', { extractTitle: false });
    expect(result.blocks[0]).toMatchObject({ type: "image", props: { url: "./img/a.png", caption: "A caption", name: "Alt text" } });
    expect(result.references).toEqual([{ kind: "image", target: "./img/a.png", blockId: result.blocks[0]!.id, line: 1 }]);
  });

  it("splits several images in a row into several blocks", () => {
    expect(blocksOf("![a](./a.png)\n![b](./b.png)\n").map((b) => b.props.url)).toEqual(["./a.png", "./b.png"]);
  });
});

describe("tables", () => {
  it("reads a GFM table with alignment, treating the first row as the header", () => {
    const [table] = parse("| A | B | C |\n|:--|:-:|--:|\n| 1 | **2** | 3 |\n", { extractTitle: false }).blocks;
    const content = table!.content as unknown as { headerRows: number; rows: Array<{ cells: Array<{ props: Record<string, string>; content: unknown[] }> }> };
    expect(table!.type).toBe("table");
    expect(content.headerRows).toBe(1);
    expect(content.rows).toHaveLength(2);
    expect(content.rows[0]!.cells.map((c) => c.props.textAlignment)).toEqual([undefined, "center", "right"].map((a) => (a === undefined ? "left" : a)));
    expect(content.rows[1]!.cells[1]!.content).toEqual([text("2", { bold: true })]);
  });
});

describe("GitHub alerts become callouts", () => {
  it.each([
    ["NOTE", "info"],
    ["TIP", "success"],
    ["IMPORTANT", "info"],
    ["WARNING", "warning"],
    ["CAUTION", "danger"],
  ])("[!%s] → %s", (marker, style) => {
    expect(blocksOf(`> [!${marker}]\n> Careful here.\n`)[0]).toMatchObject({ type: "hint", props: { hintStyle: style }, content: [text("Careful here.")] });
  });

  it("says that [!IMPORTANT] is shown as a note", () => {
    const result = parse("> [!IMPORTANT]\n> Read this.\n", { extractTitle: false });
    expect(result.blocks[0]).toMatchObject({ type: "hint", props: { hintStyle: "info" } });
    expect(result.diagnostics.map((d) => [d.code, d.severity, d.line])).toEqual([["GS-206", "info", 1]]);
  });

  it("is case-insensitive and reads a title from the marker line", () => {
    expect(blocksOf("> [!warning] Heads up\n> Careful.\n")[0]).toMatchObject({ type: "hint", props: { hintStyle: "warning", hintTitle: "Heads up" }, content: [text("Careful.")] });
  });

  it("takes the text from the paragraph after a marker on its own line", () => {
    expect(blocksOf("> [!NOTE]\n>\n> Body text.\n")[0]).toMatchObject({ type: "hint", content: [text("Body text.")] });
  });

  it("keeps further blocks as children", () => {
    const [hint] = blocksOf("> [!TIP]\n> Intro.\n>\n> - one\n> - two\n>\n> ```js\n> x\n> ```\n");
    expect((hint!.children as Array<{ type: string }>).map((c) => c.type)).toEqual(["bulletListItem", "bulletListItem", "codeBlock"]);
  });

  it("leaves an ordinary blockquote as a quote", () => {
    expect(blocksOf("> Just a quote.\n>\n> Second paragraph.\n")[0]).toMatchObject({ type: "quote", content: [text("Just a quote.")], children: [{ type: "paragraph" }] });
  });

  it("does not treat an unknown marker as a callout", () => {
    expect(blocksOf("> [!NOPE]\n> Text\n")[0]!.type).toBe("quote");
  });
});

describe("directives", () => {
  it("reads columns with widths", () => {
    const [columns] = blocksOf("::::columns\n:::column{width=2}\nLeft\n:::\n\n:::column\nRight\n:::\n::::\n");
    expect(columns).toMatchObject({ type: "columnList" });
    expect((columns!.children as Array<{ props: unknown; children: Array<{ type: string }> }>).map((c) => [c.props, c.children.map((x) => x.type)])).toEqual([
      [{ width: 2 }, ["paragraph"]],
      [{ width: 1 }, ["paragraph"]],
    ]);
  });

  it("puts stray content inside :::columns into a column of its own and says so", () => {
    expect(codes("::::columns\nloose\n::::\n")).toContain("GS-205");
  });

  it("reads cards, from leaf and container forms", () => {
    const result = parse(':::cards{size="large"}\n::card{title="One" description="First" href="/one" image="https://x.co/i.png"}\n::card[Two]{href="/two"}\n:::\n', { extractTitle: false });
    expect(result.blocks[0]).toMatchObject({ type: "cardGroup", props: { size: "large" } });
    expect(strip(result.blocks[0]!.children)).toEqual([
      { type: "card", props: { title: "One", description: "First", href: "/one", imageUrl: "https://x.co/i.png" }, children: [] },
      { type: "card", props: { title: "Two", description: "", href: "/two", imageUrl: "" }, children: [] },
    ]);
    expect(result.references.map((r) => [r.kind, r.target])).toEqual([
      ["card-link", "/one"],
      ["card-image", "https://x.co/i.png"],
      ["card-link", "/two"],
    ]);
  });

  it("reads a stepper whose steps hold blocks", () => {
    const [stepper] = parse(':::::stepper\n::::step{title="First"}\nDo this.\n::::\n::::step{title="Second"}\nThen this.\n::::\n:::::\n', { extractTitle: false }).blocks;
    expect(stepper!.type).toBe("stepper");
    expect(stepper!.children.map((s) => [s.type, s.props, s.content])).toEqual([
      ["step", { index: 1 }, [text("First")]],
      ["step", { index: 2 }, [text("Second")]],
    ]);
    expect(stepper!.children[0]!.children[0]).toMatchObject({ type: "paragraph", content: [text("Do this.")] });
  });

  it("takes a step's title from a leading heading when there is no attribute (GitBook's shape)", () => {
    const [stepper] = parse(":::::stepper\n::::step\n### Connect\nPaste the URL.\n::::\n:::::\n", { extractTitle: false }).blocks;
    expect(stepper!.children[0]).toMatchObject({ type: "step", content: [text("Connect")] });
    expect(stepper!.children[0]!.children.map((c) => c.type)).toEqual(["paragraph"]);
  });

  it("reads updates, taking a title from a leading heading when there is no attribute", () => {
    const [updates] = parse('::::updates\n:::update{date="2026-01-01" tags="new"}\n## Shipped\nDetails.\n:::\n::::\n', { extractTitle: false }).blocks;
    expect(updates!.children[0]).toMatchObject({ type: "update", props: { date: "2026-01-01", tags: "new" }, content: [text("Shipped")] });
    expect(updates!.children[0]!.children.map((c) => c.type)).toEqual(["paragraph"]);
  });

  it("reads a button inside a paragraph, and a button written as a leaf", () => {
    expect(blocksOf(':button[Start]{href="/start" style="secondary"}\n')[0]).toMatchObject({ type: "button", props: { label: "Start", href: "/start", style: "secondary" } });
    expect(blocksOf('::button[Go]{href="/go"}\n')[0]).toMatchObject({ type: "button", props: { label: "Go", href: "/go", style: "primary" } });
  });

  it("rejects a button with no link", () => {
    const result = parse(":button[Nothing]\n", { extractTitle: false });
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-205"]);
  });

  it("reads embed, video, audio, file and page-link", () => {
    const result = parse(
      [
        '::embed{url="https://www.youtube.com/watch?v=abc"}',
        '::video{src="./v.mp4" caption="Demo" width="480"}',
        '::audio{src="./a.mp3"}',
        '::file{src="./f.pdf" name="Spec"}',
        '::page-link{href="./other.md" title="Other" description="More"}',
      ].join("\n\n") + "\n",
      { extractTitle: false },
    );
    expect(result.blocks.map((b) => [b.type, b.props])).toEqual([
      ["embed", { url: "https://www.youtube.com/watch?v=abc" }],
      ["video", { url: "./v.mp4", caption: "Demo", name: "", previewWidth: 480 }],
      ["audio", { url: "./a.mp3", caption: "", name: "" }],
      ["file", { url: "./f.pdf", name: "Spec", caption: "" }],
      ["pageLink", { href: "./other.md", title: "Other", description: "More" }],
    ]);
    expect(result.references.map((r) => r.kind)).toEqual(["video", "audio", "file", "page-link"]);
  });

  it("turns an embed from an unknown provider into a plain link, with a warning", () => {
    const result = parse('::embed{url="https://example.com/thing"}\n', { extractTitle: false });
    expect(result.blocks[0]).toMatchObject({ type: "paragraph", content: [{ type: "link", href: "https://example.com/thing" }] });
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-205"]);
  });

  it("shows an unknown directive as written, in a code block, so nothing is lost", () => {
    const result = parse(":::mystery{a=1}\nbody\n:::\n", { extractTitle: false });
    expect(result.blocks[0]).toMatchObject({ type: "codeBlock", props: { language: "text" } });
    expect(JSON.stringify(result.blocks[0]!.content)).toContain("body");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-203"]);
  });

  it("shows an unknown inline directive as the text that was written", () => {
    const result = parse("Press :kbd[Ctrl] now\n", { extractTitle: false });
    expect(result.blocks[0]!.content).toEqual([text("Press :kbd[Ctrl] now")]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-203"]);
  });

  it("reads escapes and character references in an unknown inline directive as the text they stand for", () => {
    expect(blocksOf(":a{#&lt;}a a and \\~ and \\&lt;\n")[0]!.content).toEqual([text(":a{#<}a a and ~ and &lt;")]);
  });

  it("turns tabs into expandable sections and says so", () => {
    const result = parse('::::tabs\n:::tab{title="npm"}\nnpm i\n:::\n:::tab{title="pnpm"}\npnpm i\n:::\n::::\n', { extractTitle: false });
    expect(result.blocks.map((b) => [b.type, b.content])).toEqual([
      ["toggleListItem", [text("npm")]],
      ["toggleListItem", [text("pnpm")]],
    ]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-210"]);
  });
});

describe("html", () => {
  it("reads <details> with a summary and Markdown inside it", () => {
    const [toggle] = parse("<details>\n<summary>More</summary>\n\nHidden **text**.\n\n- a\n- b\n\n</details>\n", { extractTitle: false }).blocks;
    expect(toggle).toMatchObject({ type: "toggleListItem", content: [text("More")] });
    expect(toggle!.children.map((c) => c.type)).toEqual(["paragraph", "bulletListItem", "bulletListItem"]);
  });

  it("handles nested <details>", () => {
    const [outer] = parse("<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\n</details>\n", { extractTitle: false }).blocks;
    expect(outer!.children[0]).toMatchObject({ type: "toggleListItem", content: [text("Inner")] });
    expect(outer!.children[0]!.children[0]).toMatchObject({ type: "paragraph", content: [text("Deep.")] });
  });

  it("keeps the content when a <details> is never closed", () => {
    const result = parse("<details>\n<summary>Open</summary>\n\nStill here.\n", { extractTitle: false });
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-204");
    expect(JSON.stringify(result.blocks)).toContain("Still here.");
  });

  it("maps images, headings, rules and lists written as HTML", () => {
    const result = parse('<h2>Title</h2>\n\n<img src="./a.png" alt="A" title="Cap">\n\n<hr>\n\n<ul><li>one</li><li>two</li></ul>\n', { extractTitle: false });
    expect(result.blocks.map((b) => b.type)).toEqual(["heading", "image", "divider", "bulletListItem", "bulletListItem"]);
    expect(result.blocks[1]!.props).toMatchObject({ url: "./a.png", name: "A", caption: "Cap" });
  });

  it("reads an HTML table, with its header row", () => {
    const [table] = parse("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><b>2</b></td></tr></tbody></table>\n", { extractTitle: false }).blocks;
    const content = table!.content as unknown as { headerRows: number; rows: Array<{ cells: Array<{ content: unknown[] }> }> };
    expect(content.headerRows).toBe(1);
    expect(content.rows[1]!.cells[1]!.content).toEqual([text("2", { bold: true })]);
  });

  it("reads GitBook's table-as-cards", () => {
    const html = '<table data-view="cards"><thead><tr><th>Name</th><th>About</th><th data-card-target data-type="content-ref">Link</th></tr></thead><tbody><tr><td>One</td><td>First</td><td><a href="/one">x</a></td></tr></tbody></table>\n';
    const [group] = parse(html, { extractTitle: false }).blocks;
    expect(group).toMatchObject({ type: "cardGroup" });
    expect(group!.children[0]).toMatchObject({ type: "card", props: { title: "One", description: "First", href: "/one" } });
  });

  it("drops scripts, styles, iframes and forms without keeping their contents, and says so", () => {
    const result = parse('<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<style>body{display:none}</style>\n\n<form><input></form>\n', { extractTitle: false });
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics.every((d) => d.code === "GS-204")).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);
  });

  it("never passes event handlers or styles on", () => {
    const result = parse('<div onclick="x()" style="position:fixed">Hello <a href="https://x.co" onclick="y()">there</a></div>\n', { extractTitle: false });
    expect(JSON.stringify(result.blocks)).not.toMatch(/onclick|position/);
    expect(result.blocks[0]).toMatchObject({ type: "paragraph", content: [text("Hello "), { type: "link", href: "https://x.co" }] });
  });

  it("ignores HTML comments silently", () => {
    const result = parse("<!-- note to self -->\n\nText\n", { extractTitle: false });
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("GitBook tags", () => {
  it("reads {% hint %} with a style", () => {
    const [hint] = blocksOf('{% hint style="warning" %}\nWatch out.\n{% endhint %}\n');
    expect(hint).toMatchObject({ type: "hint", props: { hintStyle: "warning" }, content: [text("Watch out.")] });
  });

  it("falls back to info for a style it doesn't know", () => {
    expect(blocksOf('{% hint style="purple" %}\nx\n{% endhint %}\n')[0]!.props.hintStyle).toBe("info");
  });

  it("reads tabs", () => {
    const result = parse('{% tabs %}\n{% tab title="One" %}\nFirst.\n{% endtab %}\n{% tab title="Two" %}\nSecond.\n{% endtab %}\n{% endtabs %}\n', { extractTitle: false });
    expect(result.blocks.map((b) => [b.type, b.content])).toEqual([
      ["toggleListItem", [text("One")]],
      ["toggleListItem", [text("Two")]],
    ]);
  });

  it("reads a stepper and its steps, and nested containers", () => {
    const result = parse('{% stepper %}\n{% step %}\nFirst\n{% hint style="info" %}\nInside a step.\n{% endhint %}\n{% endstep %}\n{% endstepper %}\n', { extractTitle: false });
    const [stepper] = result.blocks;
    expect(stepper!.type).toBe("stepper");
    expect(stepper!.children[0]!.children.map((c) => c.type)).toEqual(["paragraph", "hint"]);
  });

  it("reads {% file %}, {% embed %} and {% content-ref %}", () => {
    const result = parse('{% file src="spec.pdf" %}\n\n{% embed url="https://youtu.be/abc" %}\n\n{% content-ref url="intro.md" %}\n[Intro](intro.md)\n{% endcontent-ref %}\n', { extractTitle: false });
    expect(result.blocks.map((b) => [b.type, b.props])).toEqual([
      ["file", { url: "spec.pdf", name: "", caption: "" }],
      ["embed", { url: "https://youtu.be/abc" }],
      ["pageLink", { href: "intro.md", title: "Intro", description: "" }],
    ]);
  });

  it("attaches {% code title %} to the fence inside it", () => {
    const [code] = blocksOf('{% code title="app.ts" %}\n```ts\nlet a = 1\n```\n{% endcode %}\n');
    expect(code).toMatchObject({ type: "codeBlock", props: { language: "typescript", title: "app.ts" } });
  });

  it("leaves Liquid-looking text inside code fences alone", () => {
    const [code] = blocksOf("```\n{% hint %}\nnot a tag\n{% endhint %}\n```\n");
    expect(code!.content).toEqual([text("{% hint %}\nnot a tag\n{% endhint %}")]);
  });

  it("follows {% include %} only when it is allowed to, and reports it when it can't", () => {
    const withResolver = parse('Before\n\n{% include "snippet.md" %}\n\nAfter\n', { extractTitle: false, resolveInclude: (p) => (p === "snippet.md" ? "Included text.\n" : null) });
    expect(withResolver.blocks.map((b) => (b.content as Array<{ text: string }>)[0]!.text)).toEqual(["Before", "Included text.", "After"]);

    const without = parse('Before\n\n{% include "snippet.md" %}\n', { extractTitle: false });
    expect(without.diagnostics.map((d) => d.code)).toEqual(["GS-131"]);
  });

  it("stops an include that includes itself", () => {
    const result = parse('{% include "loop.md" %}\n', { extractTitle: false, resolveInclude: () => '{% include "loop.md" %}\n' });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("closes what was left open, and reports it", () => {
    const result = parse('{% hint style="info" %}\nNever closed.\n', { extractTitle: false });
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-204");
    expect(result.blocks[0]).toMatchObject({ type: "hint", content: [text("Never closed.")] });
  });

  it("removes a closing tag that has no opener, and reports it", () => {
    const result = parse("Text\n\n{% endhint %}\n", { extractTitle: false });
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-204"]);
  });

  it("removes a tag it doesn't know, and reports it", () => {
    const result = parse("{% mystery foo=1 %}\n\nText\n", { extractTitle: false });
    expect(result.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-203"]);
  });

  it("is switched off with gitbook: false", () => {
    const result = parse('{% hint style="info" %}\nx\n{% endhint %}\n', { extractTitle: false, gitbook: false });
    expect(result.blocks.map((b) => b.type)).not.toContain("hint");
  });

  it("keeps diagnostics pointing at the line in the original file", () => {
    const result = parse('Line one\n\n{% hint style="info" %}\nA\n{% endhint %}\n\n{% unknown %}\n', { extractTitle: false });
    expect(result.diagnostics.find((d) => d.code === "GS-203")?.line).toBe(7);
  });
});

describe("diagnostics", () => {
  it("are listed in the order an author reads the file, whichever pass found them", () => {
    const result = parse("{% tabs %}\n{% tab title=\"a\" %}\nx\n{% endtab %}\n{% endtabs %}\n\n{% mystery %}\n", { extractTitle: false });
    const lines = result.diagnostics.map((d) => d.line ?? 0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-210", "GS-203"]);
  });

  it("carry the file path they were given", () => {
    expect(parse("{% mystery %}\n").diagnostics[0]!.path).toBe("docs/page.md");
  });
});

describe("references", () => {
  it("lists links, images and files with the block that holds them", () => {
    const result = parse("See [the guide](./guide.md).\n\n![Pic](./pic.png)\n", { extractTitle: false });
    expect(result.references).toEqual([
      { kind: "link", target: "./guide.md", blockId: result.blocks[0]!.id, line: 1 },
      { kind: "image", target: "./pic.png", blockId: result.blocks[1]!.id, line: 3 },
    ]);
  });
});

describe("block ids", () => {
  it("are the same every time the same file is parsed", () => {
    const src = "# T\n\nOne\n\n- a\n- b\n\n> [!NOTE]\n> x\n";
    const ids = (s: string) => JSON.stringify(parse(s, { path: "a.md" }).blocks.map(function walk(b: Block): unknown { return [b.id, b.children.map(walk)]; }));
    expect(ids(src)).toBe(ids(src));
  });

  it("differ between files", () => {
    const a = parse("Hello\n", { path: "a.md" }).blocks[0]!.id;
    const b = parse("Hello\n", { path: "b.md" }).blocks[0]!.id;
    expect(a).not.toBe(b);
  });

  it("are unique within a page", () => {
    const src = Array.from({ length: 200 }, (_, i) => `- item ${i}\n  - child ${i}`).join("\n") + "\n\n" + Array.from({ length: 50 }, (_, i) => `Para ${i}`).join("\n\n");
    const seen = new Set<string>();
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        expect(seen.has(b.id)).toBe(false);
        seen.add(b.id);
        walk(b.children);
      }
    };
    walk(parse(src).blocks);
    expect(seen.size).toBe(450);
  });

  it("don't change when text is edited without moving blocks", () => {
    const before = parse("One\n\nTwo\n", { path: "a.md" }).blocks.map((b) => b.id);
    const after = parse("One edited\n\nTwo edited\n", { path: "a.md" }).blocks.map((b) => b.id);
    expect(after).toEqual(before);
  });

  it("can be seeded separately from the path", () => {
    const a = parse("Hello\n", { path: "a.md", idSeed: "page-1" }).blocks[0]!.id;
    const b = parse("Hello\n", { path: "b.md", idSeed: "page-1" }).blocks[0]!.id;
    expect(a).toBe(b);
  });
});

describe("limits", () => {
  it("stops at the block limit and says so once", () => {
    const result = parse(Array.from({ length: 50 }, (_, i) => `Para ${i}`).join("\n\n"), { maxBlocks: 10 });
    expect(result.blocks).toHaveLength(10);
    expect(result.diagnostics.filter((d) => d.code === "GS-207")).toHaveLength(1);
  });

  it("stops at the nesting limit instead of recursing without end", () => {
    const deep = Array.from({ length: 40 }, (_, i) => `${"  ".repeat(i)}- level ${i}`).join("\n");
    const result = parse(deep, { maxDepth: 5 });
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-207");
    const depthOf = (blocks: Block[]): number => (blocks.length === 0 ? 0 : 1 + Math.max(...blocks.map((b) => depthOf(b.children))));
    expect(depthOf(result.blocks)).toBeLessThanOrEqual(7);
  });

  it("copes with deeply nested blockquotes", () => {
    const result = parse(`${">".repeat(500)} deep\n`);
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-207");
  });

  it("never throws, whatever the input", () => {
    for (const input of ["", "\u0000", "---", ":::", "::::\n:::\n", "[", "![", "{% ", "<", "<details>", "$$", "```", "> [!NOTE]", "| a |\n|---|", "\\"]) {
      expect(() => parse(input)).not.toThrow();
    }
  });
});

describe("safety", () => {
  it("reduces a javascript: link to its text, with a warning", () => {
    const result = parse("[click](javascript:alert(1))\n", { extractTitle: false });
    expect(result.blocks[0]!.content).toEqual([text("click")]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-132"]);
  });

  it.each(["data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "JaVaScRiPt:alert(1)"])("refuses %s as a link target", (target) => {
    const result = parse(`[x](${target})\n`, { extractTitle: false });
    expect(JSON.stringify(result.blocks)).not.toMatch(/"type":"link"/);
  });

  it("refuses an unsafe image source in HTML", () => {
    expect(parse('<img src="javascript:alert(1)">\n', { extractTitle: false }).blocks).toEqual([]);
  });

  it("refuses an unsafe src on a video directive", () => {
    const result = parse('::video{src="javascript:alert(1)"}\n', { extractTitle: false });
    expect(result.blocks).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["GS-205"]);
  });

  it("refuses an unsafe href on a card, keeping the card", () => {
    const [group] = parse('::::cards\n::card{title="Hi" href="javascript:alert(1)"}\n::::\n', { extractTitle: false }).blocks;
    expect(group!.children[0]!.props.href).toBe("");
  });

  it("never lets raw HTML through as a block type or a prop", () => {
    const result = parse('<img src="x" onerror="alert(1)">\n\n<a href="javascript:alert(1)">x</a>\n\n<svg onload="alert(1)"></svg>\n', { extractTitle: false });
    expect(JSON.stringify(result.blocks)).not.toMatch(/onerror|onload|javascript:/);
  });
});
