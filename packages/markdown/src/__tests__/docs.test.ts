import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../index";

/** Examples in the documentation that tell people (and agents) what to write must be things the importer accepts. */
const read = (name: string) => readFileSync(new URL(`../../../../docs/git-sync/${name}`, import.meta.url), "utf8");

/** The fenced blocks tagged `md` in a document, outermost fences first (so a four-backtick block may hold three-backtick ones). */
function mdBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /^(`{3,})md\n([\s\S]*?)^\1$/gm;
  for (const m of text.matchAll(re)) out.push(m[2]!);
  return out;
}

describe("the agent guide", () => {
  const blocks = mdBlocks(read("agent-guide.md"));

  it("has examples", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("only shows front matter and Markdown the importer accepts without complaint", () => {
    for (const block of blocks) {
      const source = block.startsWith("---\n") ? `${block}\nBody\n` : block;
      const result = parseMarkdown(source, { path: "guide.md" });
      expect(result.diagnostics, source).toEqual([]);
    }
  });

  it("covers the directive example completely: callout, expandable, columns and steps all become blocks", () => {
    const example = blocks.find((b) => b.includes("[!NOTE]"))!;
    const types = parseMarkdown(example, { path: "guide.md", extractTitle: false }).blocks.map((b) => b.type);
    expect(types).toEqual(["hint", "toggleListItem", "columnList", "stepper"]);
  });
});
