import { describe, expect, it } from "vitest";
import { serializeBlocks, type Block } from "../index";

const t = (text: string, styles: Block["props"] = {}) => ({ type: "text" as const, text, styles });
let n = 0;
const b = (type: string, props: Record<string, unknown> = {}, content?: Block["content"], children: Block[] = []): Block => ({
  id: `x${++n}`,
  type,
  props,
  ...(content !== undefined ? { content } : {}),
  children,
});
const md = (blocks: Block[], options = {}) => serializeBlocks(blocks, options).markdown;

describe("the output format (see docs/git-sync/FORMAT.md)", () => {
  it.each<[string, Block[], string]>([
    ["heading", [b("heading", { level: 2 }, [t("Install")])], "## Install\n"],
    ["bold, italic, strike, code", [b("paragraph", {}, [t("a", { bold: true }), t(" "), t("b", { italic: true }), t(" "), t("c", { strike: true }), t(" "), t("d", { code: true })])], "**a** *b* ~~c~~ `d`\n"],
    ["bold and italic share one span", [b("paragraph", {}, [t("x", { bold: true }), t("y", { bold: true, italic: true })])], "**x*y***\n"],
    ["underline is <u>", [b("paragraph", {}, [t("under", { underline: true })])], "<u>under</u>\n"],
    ["a hard break is a backslash", [b("paragraph", {}, [t("one\ntwo")])], "one\\\ntwo\n"],
    ["a link", [b("paragraph", {}, [{ type: "link", href: "https://x.co", content: [t("link", { bold: true })] }])], "[**link**](https://x.co)\n"],
    ["quote", [b("quote", {}, [t("Quoted.")])], "> Quoted.\n"],
    ["divider", [b("paragraph", {}, [t("a")]), b("divider"), b("paragraph", {}, [t("b")])], "a\n\n---\n\nb\n"],
    ["a leading divider is not mistaken for front matter", [b("divider"), b("paragraph", {}, [t("a")])], "***\n\na\n"],
    ["fenced code with language and title", [b("codeBlock", { language: "bash", title: "install.sh" }, [t("pnpm i\npnpm dev")])], '```bash title="install.sh"\npnpm i\npnpm dev\n```\n'],
    ["plain-text code has no language", [b("codeBlock", { language: "text" }, [t("x")])], "```\nx\n```\n"],
    ["a fence longer than any backtick run inside", [b("codeBlock", { language: "md" }, [t("```js\nx\n```")])], "````md\n```js\nx\n```\n````\n"],
    ["image with alt and caption", [b("image", { url: "./a.png", caption: "Cap", name: "Alt" })], '![Alt](./a.png "Cap")\n'],
    ["math", [b("math", { formula: "x^2" })], "$$\nx^2\n$$\n"],
    ["bullet, task and numbered lists", [b("bulletListItem", {}, [t("one")], [b("bulletListItem", {}, [t("nested")])]), b("checkListItem", { checked: true }, [t("done")]), b("numberedListItem", { start: 3 }, [t("three")]), b("numberedListItem", {}, [t("four")])], "- one\n  - nested\n- [x] done\n\n3. three\n4. four\n"],
    ["an expandable section", [b("toggleListItem", {}, [t("More")], [b("paragraph", {}, [t("Hidden.")])])], "<details>\n<summary>More</summary>\n\nHidden.\n\n</details>\n"],
    ["embed, video, audio, file", [b("embed", { url: "https://youtu.be/a" }), b("video", { url: "./v.mp4", caption: "Demo", name: "", previewWidth: 480 }), b("audio", { url: "./a.mp3", caption: "", name: "" }), b("file", { url: "./f.pdf", name: "Spec", caption: "" })], '::embed{url="https://youtu.be/a"}\n\n::video{src="./v.mp4" caption="Demo" width="480"}\n\n::audio{src="./a.mp3"}\n\n::file{src="./f.pdf" name="Spec"}\n'],
    ["a page link", [b("pageLink", { href: "./other.md", title: "Other", description: "More" })], '::page-link{href="./other.md" title="Other" description="More"}\n'],
    ["a button", [b("button", { label: "Start", href: "/start", style: "secondary" }), b("button", { label: "Go", href: "/go", style: "primary" })], ':button[Start]{href="/start" style="secondary"}\n\n:button[Go]{href="/go"}\n'],
  ])("%s", (_name, blocks, expected) => {
    expect(md(blocks)).toBe(expected);
  });

  describe("callouts use GitHub's alert syntax", () => {
    it.each([
      ["info", "NOTE"],
      ["success", "TIP"],
      ["warning", "WARNING"],
      ["danger", "CAUTION"],
    ])("%s → [!%s]", (style, marker) => {
      expect(md([b("hint", { hintStyle: style }, [t("Text.")])])).toBe(`> [!${marker}]\n>\n> Text.\n`);
    });

    it("a title follows the marker", () => {
      expect(md([b("hint", { hintStyle: "warning", hintTitle: "Heads up" }, [t("Careful.")])])).toBe("> [!WARNING] Heads up\n>\n> Careful.\n");
    });

    it("blocks inside a callout follow its text", () => {
      expect(md([b("hint", { hintStyle: "info" }, [t("Text.")], [b("codeBlock", { language: "text" }, [t("x")])])])).toBe("> [!NOTE]\n>\n> Text.\n>\n> ```\n> x\n> ```\n");
    });
  });

  describe("tables", () => {
    const cell = (text: string, props: Record<string, unknown> = {}) => ({ type: "tableCell" as const, content: [t(text)], props });
    it("is a GFM pipe table with alignment, escaping pipes and newlines", () => {
      const table = b("table", {}, { type: "tableContent", headerRows: 1, rows: [{ cells: [cell("A"), cell("B", { textAlignment: "right" })] }, { cells: [cell("1\n2"), cell("x|y")] }] });
      expect(md([table])).toBe("| A      |    B |\n| ------ | ---: |\n| 1<br>2 | x\\|y |\n");
    });
  });

  describe("containers", () => {
    it("columns", () => {
      const doc = [b("columnList", {}, undefined, [b("column", { width: 2 }, undefined, [b("paragraph", {}, [t("left")])]), b("column", { width: 1 }, undefined, [b("paragraph", {}, [t("right")])])])];
      expect(md(doc)).toBe('::::columns\n:::column{width="2"}\nleft\n:::\n\n:::column\nright\n:::\n::::\n');
    });

    it("cards", () => {
      const doc = [b("cardGroup", { size: "large" }, undefined, [b("card", { title: "One", description: "First", href: "./one.md", imageUrl: "./one.png" })])];
      expect(md(doc)).toBe(':::cards{size="large"}\n::card{title="One" description="First" href="./one.md" image="./one.png"}\n:::\n');
    });

    it("a stepper", () => {
      const doc = [b("stepper", {}, undefined, [b("step", { index: 1 }, [t("Install")], [b("paragraph", {}, [t("Run it.")])]), b("step", { index: 2 }, [t("Use")])])];
      expect(md(doc)).toBe('::::stepper\n:::step{title="Install"}\nRun it.\n:::\n\n:::step{title="Use"}\n:::\n::::\n');
    });

    it("updates", () => {
      const doc = [b("updates", {}, undefined, [b("update", { date: "2026-10-01", tags: "api,breaking" }, [t("v2")], [b("paragraph", {}, [t("Changed.")])])])];
      expect(md(doc)).toBe('::::updates\n:::update{title="v2" date="2026-10-01" tags="api,breaking"}\nChanged.\n:::\n::::\n');
    });
  });

  describe("front matter", () => {
    it("is written in a fixed key order, omitting what is empty", () => {
      const out = md([b("paragraph", {}, [t("Body")])], { frontMatter: { nav_title: "Short", title: "Install", icon: "download", order: 2, hidden: true, redirect_from: ["a/b"], extra: { custom: 1 } } });
      expect(out).toBe("---\ntitle: Install\nicon: download\norder: 2\nhidden: true\nnav_title: Short\nredirect_from:\n  - a/b\ncustom: 1\n---\n\nBody\n");
    });

    it("is left out when there is none", () => {
      expect(md([b("paragraph", {}, [t("Body")])], { frontMatter: { draft: false, hidden: false, redirect_from: [] } })).toBe("Body\n");
    });

    it("quotes values that would otherwise change type", () => {
      const out = md([], { frontMatter: { title: "true", description: "a: b # c" } });
      expect(out).toContain('title: "true"');
      expect(out).toContain('description: "a: b # c"');
    });
  });
});

describe("text is escaped so it reads back as text", () => {
  it.each([
    ["a leading number and dot", "1. not a list"],
    ["a leading hash", "# not a heading"],
    ["a leading dash", "- not a bullet"],
    ["emphasis characters", "2 * 3 * 4 and a_b_c"],
    ["brackets", "[not](a link)"],
    ["a pipe", "a | b"],
    ["angle brackets", "<b>not html</b> and <a@b.co>"],
    ["an email", "write to a@b.co"],
    ["a backslash", "C:\\path\\to"],
    ["dollar signs", "$5 and $6"],
    ["colons", ":not{a=directive}"],
  ])("%s", async (_name, text) => {
    const { parseMarkdown } = await import("../index");
    const out = md([b("paragraph", {}, [t(text)])]);
    const back = parseMarkdown(out, { extractTitle: false }).blocks;
    expect(back).toHaveLength(1);
    expect(back[0]!.type).toBe("paragraph");
    expect((back[0]!.content as { text: string }[]).map((r) => r.text).join("")).toBe(text);
  });
});

describe("what Markdown cannot carry is reported, not hidden", () => {
  const lossy = (blocks: Block[]) => serializeBlocks(blocks).lossy;

  it("is empty for a page that round-trips", () => {
    expect(lossy([b("heading", { level: 1 }, [t("A")]), b("paragraph", {}, [t("b", { bold: true })])])).toEqual([]);
  });

  it("says so for colours, alignment, merged cells and unknown blocks", () => {
    expect(lossy([b("paragraph", { textColor: "red" }, [t("x")])])).toEqual(["Block colours are not part of Markdown and were dropped."]);
    expect(lossy([b("paragraph", { textAlignment: "center" }, [t("x")])])).toEqual(["Text alignment is not part of Markdown and was dropped."]);
    expect(lossy([b("paragraph", {}, [t("x", { textColor: "blue" })])])).toEqual(["Text and background colours are not part of Markdown and were dropped."]);
    const merged = b("table", {}, { type: "tableContent", headerRows: 1, rows: [{ cells: [{ type: "tableCell", content: [t("a")], props: { colspan: 2 } }] }] });
    expect(lossy([merged])).toContain("Merged table cells were split.");
    expect(lossy([b("mystery", {}, [t("hi")])])).toEqual(['A "mystery" block is not part of Markdown; its text was kept as a paragraph.']);
  });

  it("still keeps the text of what it could not represent", () => {
    expect(md([b("mystery", {}, [t("hi")])])).toBe("hi\n");
  });
});

describe("stored JSON that is not quite what the editor writes today", () => {
  it("fills in missing props, children and styles", () => {
    const loose = [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      { type: "bulletListItem", content: [{ type: "text", text: "one", styles: { bold: true } }] },
    ];
    expect(serializeBlocks(loose).markdown).toBe("Hello\n\n- **one**\n");
  });

  it("skips entries that are not blocks, and runs that are not text or links", () => {
    const messy = [null, "text", 4, { notAType: true }, { type: "paragraph", content: [null, { type: "mystery" }, { type: "text", text: "kept", styles: {} }], children: "nope" }];
    expect(serializeBlocks(messy).markdown).toBe("kept\n");
  });

  it("accepts a table whose cells are bare inline arrays (an older shape)", () => {
    const old = [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "A", styles: {} }], [{ type: "text", text: "B", styles: {} }]] }, { cells: [[{ type: "text", text: "1", styles: {} }], [{ type: "text", text: "2", styles: {} }]] }] } }];
    expect(serializeBlocks(old).markdown).toBe("| A | B |\n| - | - |\n| 1 | 2 |\n");
  });

  it("returns nothing for something that is not a document", () => {
    expect(serializeBlocks(undefined).markdown).toBe("");
    expect(serializeBlocks({ a: 1 }).markdown).toBe("");
  });

  it("stops at an absurd nesting depth instead of overflowing the stack", () => {
    let node: Record<string, unknown> = { type: "paragraph", content: [{ type: "text", text: "deep", styles: {} }], children: [] };
    for (let i = 0; i < 5000; i++) node = { type: "bulletListItem", content: [{ type: "text", text: "x", styles: {} }], children: [node] };
    expect(() => serializeBlocks([node])).not.toThrow();
  });
});

