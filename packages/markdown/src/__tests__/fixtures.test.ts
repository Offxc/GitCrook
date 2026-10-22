import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeBlocks } from "../index";
import { strip } from "./helpers";

/**
 * The conformance suite. Each `fixtures/<name>.md` is a realistic page; next to it are the two things that
 * must stay true of it:
 *
 *   <name>.expected.json   what the parser makes of it (blocks without their ids, diagnostics, references)
 *   <name>.canonical.md    what the serializer writes back
 *
 * Anyone implementing the format in another language can use the same files. After a deliberate change to the
 * format run `UPDATE_FIXTURES=1 pnpm test` and review the diff: it is the change in behaviour, in full.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const update = process.env.UPDATE_FIXTURES === "1";
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".md") && !f.endsWith(".canonical.md"))
  .map((f) => f.slice(0, -3))
  .sort();

const parse = (source: string, name: string) => parseMarkdown(source, { path: `fixtures/${name}.md`, extractTitle: false, resolveInclude: () => null });

function snapshot(source: string, name: string) {
  const result = parse(source, name);
  return {
    frontMatter: result.frontMatter,
    title: result.title,
    blocks: strip(result.blocks),
    diagnostics: result.diagnostics.map((d) => ({ code: d.code, line: d.line ?? null })),
    references: result.references.map((r) => ({ kind: r.kind, target: r.target })),
  };
}

function canonical(source: string, name: string): string {
  const result = parse(source, name);
  return serializeBlocks(result.blocks, { frontMatter: result.frontMatter }).markdown;
}

const read = (file: string) => readFileSync(join(dir, file), "utf8");

describe("conformance fixtures", () => {
  it("has fixtures", () => {
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  describe.each(names)("%s", (name) => {
    const source = read(`${name}.md`);

    it("parses to the expected blocks", () => {
      const actual = `${JSON.stringify(snapshot(source, name), null, 2)}\n`;
      if (update) writeFileSync(join(dir, `${name}.expected.json`), actual);
      expect(existsSync(join(dir, `${name}.expected.json`)), `missing ${name}.expected.json (run with UPDATE_FIXTURES=1)`).toBe(true);
      expect(actual).toBe(read(`${name}.expected.json`));
    });

    it("serializes to the canonical Markdown", () => {
      const actual = canonical(source, name);
      if (update) writeFileSync(join(dir, `${name}.canonical.md`), actual);
      expect(existsSync(join(dir, `${name}.canonical.md`)), `missing ${name}.canonical.md (run with UPDATE_FIXTURES=1)`).toBe(true);
      expect(actual).toBe(read(`${name}.canonical.md`));
    });

    it("reads its own canonical form back as the same page", () => {
      const once = snapshot(source, name);
      const again = snapshot(canonical(source, name), name);
      expect(again.blocks).toEqual(once.blocks);
      expect(again.frontMatter).toEqual(once.frontMatter);
    });

    it("has a canonical form that is already stable", () => {
      const first = canonical(source, name);
      expect(canonical(first, name)).toBe(first);
    });

    it("is deterministic: the same file gives the same ids every time", () => {
      expect(JSON.stringify(parse(source, name).blocks)).toBe(JSON.stringify(parse(source, name).blocks));
    });
  });
});
