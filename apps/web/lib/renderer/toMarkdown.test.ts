import { describe, expect, it } from "vitest";
import { blocksToMarkdown } from "./toMarkdown";

const text = (value: string, styles: Record<string, true> = {}) => ({ type: "text", text: value, styles });

describe("blocksToMarkdown", () => {
  it("writes a page the way Git Sync would", () => {
    const page = [
      { id: "1", type: "heading", props: { level: 2 }, content: [text("Install")], children: [] },
      { id: "2", type: "hint", props: { hintStyle: "warning", hintTitle: "Heads up" }, content: [text("Back up first.")], children: [] },
      { id: "3", type: "codeBlock", props: { language: "bash" }, content: [text("pnpm i")], children: [] },
    ];
    expect(blocksToMarkdown(page)).toBe("## Install\n\n> [!WARNING] Heads up\n>\n> Back up first.\n\n```bash\npnpm i\n```");
  });

  it("includes tables, which the old writer left out", () => {
    const cell = (value: string) => ({ type: "tableCell", content: [text(value)], props: {} });
    const page = [{ id: "t", type: "table", props: {}, content: { type: "tableContent", rows: [{ cells: [cell("A"), cell("B")] }, { cells: [cell("1"), cell("2")] }] }, children: [] }];
    expect(blocksToMarkdown(page)).toContain("| A | B |");
  });

  it("returns an empty string for content that is not a document", () => {
    expect(blocksToMarkdown(null)).toBe("");
    expect(blocksToMarkdown("text")).toBe("");
    expect(blocksToMarkdown([])).toBe("");
  });

  it("copes with stored blocks that lack props or children", () => {
    expect(blocksToMarkdown([{ type: "paragraph", content: [text("Plain")] }])).toBe("Plain");
  });
});
