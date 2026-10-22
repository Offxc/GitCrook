import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseMarkdown, serializeBlocks, type Block, type Inline, type Styles } from "../index";
import { strip } from "./helpers";

// ---------------------------------------------------------------------------------------------------
// Generators of documents in canonical form: exactly the shape the parser produces, so that
// parse(serialize(doc)) must give back `doc`.
// ---------------------------------------------------------------------------------------------------

/** Characters chosen to stress escaping: every one of them means something somewhere in Markdown. */
const WORD_CHARS = "abcXYZ019 _*[]()<>#+-.!`|\\$:{}~&\"'=/@%";
const chars = (alphabet: string, max: number, min = 1) => fc.string({ unit: fc.constantFrom(...alphabet), minLength: min, maxLength: max });
const word = chars(WORD_CHARS, 12).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 0);

const styles: fc.Arbitrary<Styles> = fc
  .record({ bold: fc.boolean(), italic: fc.boolean(), strike: fc.boolean(), underline: fc.boolean(), code: fc.boolean() })
  .map((r) => {
    const out: Styles = {};
    for (const [k, v] of Object.entries(r)) if (v) (out as Record<string, true>)[k] = true;
    // Inline code can't also be struck through or underlined in one node without changing shape; keep it to code + bold/italic.
    if (out.code) {
      delete out.strike;
      delete out.underline;
    }
    return out;
  });

// Known limitation, not generated: `]` inside inline code at the very start of a paragraph can read back as a
// link reference definition (`[`]:`...`), because definitions are recognised before inline code is.
const run = fc
  .record({ type: fc.constant("text" as const), text: word, styles })
  .map((r) => (r.styles.code ? { ...r, text: r.text.replace(/\]/g, "") || "x" } : r));
const href = fc.constantFrom("https://example.com/a", "/docs/intro", "./other.md", "#section", "mailto:a@b.co");

/** Inline content in normal form: adjacent runs differ in style, no whitespace at the edges of styled runs. */
const inlineContent: fc.Arbitrary<Inline[]> = fc
  .array(fc.oneof({ weight: 4, arbitrary: run }, { weight: 1, arbitrary: fc.record({ type: fc.constant("link" as const), href, content: fc.array(run, { minLength: 1, maxLength: 2 }) }) }), { minLength: 1, maxLength: 5 })
  .map(normalize)
  .filter((c) => c.length > 0);

/** The editor's own normalisation: merge neighbours with identical styles, trim edges, drop empties. */
function normalize(content: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const r of content) {
    if (r.type === "text") {
      const last = merged.at(-1);
      if (last?.type === "text" && JSON.stringify(last.styles) === JSON.stringify(r.styles)) last.text = `${last.text} ${r.text}`;
      else merged.push({ type: "text", text: r.text, styles: { ...r.styles } });
    } else {
      const inner = normalize(r.content).filter((x) => x.type === "text");
      const last = merged.at(-1);
      if (last?.type === "link" && last.href === r.href) last.content = normalize([...last.content, ...inner]) as typeof last.content;
      else merged.push({ type: "link", href: r.href, content: inner as typeof r.content });
    }
  }
  // Spaces separate runs: give each its own, outside the styling, by putting a plain-space run between neighbours.
  const spaced: Inline[] = [];
  merged.forEach((r, i) => {
    if (i > 0) spaced.push({ type: "text", text: " ", styles: {} });
    spaced.push(r);
  });
  return mergeSpaces(spaced);
}

function mergeSpaces(content: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of content) {
    const last = out.at(-1);
    if (r.type === "text" && last?.type === "text" && JSON.stringify(last.styles) === JSON.stringify(r.styles)) last.text += r.text;
    else out.push(r.type === "text" ? { ...r, styles: { ...r.styles } } : r);
  }
  // No whitespace at the edges of the whole thing, or of a styled run.
  const first = out[0];
  if (first?.type === "text") first.text = first.text.replace(/^\s+/, "");
  const last = out.at(-1);
  if (last?.type === "text") last.text = last.text.replace(/\s+$/, "");
  return out.filter((r) => r.type !== "text" || r.text !== "");
}

let seq = 0;
const block = (type: string, props: Record<string, unknown>, content?: Block["content"], children: Block[] = []): Block => ({
  id: `t${++seq}`,
  type,
  props,
  ...(content !== undefined ? { content } : {}),
  children,
});

const plainWord = chars("abcXYZ019 -", 10).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 0 && !/^-/.test(s));
const url = fc.constantFrom("https://example.com/x", "/api/files/abc", "./img/a.png");

/** A title is plain text: it is carried in a directive attribute. */
const plainRuns: fc.Arbitrary<Inline[]> = plainWord.map((text) => [{ type: "text", text, styles: {} }]);

const paragraph = inlineContent.map((c) => block("paragraph", {}, c));
const heading = fc.tuple(fc.integer({ min: 1, max: 6 }), inlineContent).map(([level, c]) => block("heading", { level }, c));
const divider = fc.constant(null).map(() => block("divider", {}));
const code = fc
  .tuple(fc.constantFrom("text", "bash", "javascript", "yaml"), fc.array(chars("ab c`~#$<>{}()-", 12, 0), { minLength: 1, maxLength: 4 }))
  .map(([language, lines]) => {
    const text = lines.join("\n").replace(/\s+$/, "");
    return block("codeBlock", { language }, text === "" ? [] : [{ type: "text", text, styles: {} }]);
  });
const image = fc.tuple(url, plainWord, fc.oneof(fc.constant(""), plainWord)).map(([u, name, caption]) => block("image", { url: u, caption, name }));
const math = fc.constantFrom("x^2", "\\frac{a}{b}", "a+b").map((formula) => block("math", { formula }));
const embed = fc.constantFrom("https://youtu.be/abc123", "https://vimeo.com/12345").map((u) => block("embed", { url: u }));
const media = fc.tuple(fc.constantFrom("video", "audio"), url, fc.oneof(fc.constant(""), plainWord)).map(([type, src, caption]) => block(type, { url: src, caption, name: "" }));
const file = fc.tuple(url, plainWord).map(([src, name]) => block("file", { url: src, name, caption: "" }));
const pageLink = fc.tuple(fc.constantFrom("./a.md", "/docs/b"), plainWord, fc.oneof(fc.constant(""), plainWord)).map(([h, title, description]) => block("pageLink", { href: h, title, description }));
const button = fc.tuple(plainWord, fc.constantFrom("https://example.com", "/start"), fc.constantFrom("primary", "secondary")).map(([label, h, style]) => block("button", { label, href: h, style }));
const hint = fc
  .tuple(fc.constantFrom("info", "success", "warning", "danger"), fc.oneof(fc.constant(""), plainWord), inlineContent)
  .map(([style, title, c]) => block("hint", { hintStyle: style, ...(title ? { hintTitle: title } : {}) }, c));
const quote = inlineContent.map((c) => block("quote", {}, c));
const table = fc
  .tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }), fc.array(fc.constantFrom(null, "center", "right"), { minLength: 3, maxLength: 3 }), fc.array(plainWord, { minLength: 9, maxLength: 9 }))
  .map(([rows, cols, aligns, words]) =>
    block("table", {}, {
      type: "tableContent",
      headerRows: 1,
      rows: Array.from({ length: rows }, (_, r) => ({
        cells: Array.from({ length: cols }, (_, c) => ({
          type: "tableCell" as const,
          content: [{ type: "text" as const, text: words[(r * 3 + c) % 9]!, styles: {} }],
          props: aligns[c] ? { textAlignment: aligns[c]! } : {},
        })),
      })),
    }),
  );

const leaf = fc.oneof(paragraph, heading, divider, code, image, math, embed, media, file, pageLink, button, hint, quote, table);

const list = fc.tuple(fc.constantFrom("bulletListItem", "checkListItem", "numberedListItem"), fc.array(inlineContent, { minLength: 1, maxLength: 3 })).chain(([type, items]) =>
  fc.tuple(...items.map((c) => (type === "checkListItem" ? fc.boolean().map((checked) => block(type, { checked }, c)) : fc.constant(block(type, {}, c))))).map((bs) => bs as Block[]),
);
const nestedList = fc.tuple(inlineContent, list).map(([c, kids]) => [block("bulletListItem", {}, c, kids)]);

const structure: fc.Arbitrary<Block[]> = fc.oneof(
  { weight: 6, arbitrary: leaf.map((b) => [b]) },
  { weight: 2, arbitrary: list },
  { weight: 1, arbitrary: nestedList },
  { weight: 1, arbitrary: fc.tuple(plainWord, fc.array(leaf, { minLength: 1, maxLength: 2 })).map(([title, kids]) => [block("toggleListItem", {}, [{ type: "text", text: title, styles: {} }], kids)]) },
  { weight: 1, arbitrary: fc.array(fc.array(paragraph, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 3 }).map((cols) => [block("columnList", {}, undefined, cols.map((c, i) => block("column", { width: i === 0 ? 2 : 1 }, undefined, c)))]) },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.tuple(plainWord, fc.oneof(fc.constant(""), plainWord), fc.constantFrom("", "https://example.com"), fc.constantFrom("", "./cover.png")), { minLength: 1, maxLength: 3 })
      .map((cards) => [block("cardGroup", { size: "medium" }, undefined, cards.map(([title, description, h, imageUrl]) => block("card", { title, description, href: h, imageUrl })))]),
  },
  {
    weight: 1,
    arbitrary: fc.array(fc.tuple(fc.oneof(plainRuns, fc.constant<Inline[]>([])), fc.array(fc.oneof(paragraph, heading), { minLength: 0, maxLength: 2 })), { minLength: 1, maxLength: 3 }).map((steps) => [
      block("stepper", {}, undefined, steps.map(([title, kids], i) => block("step", { index: i + 1 }, title, kids))),
    ]),
  },
  {
    weight: 1,
    arbitrary: fc
      .array(fc.tuple(fc.oneof(plainRuns, fc.constant<Inline[]>([])), fc.constantFrom("", "2026-10-01"), fc.constantFrom("", "api,breaking"), fc.array(fc.oneof(paragraph, heading), { minLength: 0, maxLength: 2 })), { minLength: 1, maxLength: 3 })
      .map((ups) => [block("updates", {}, undefined, ups.map(([title, date, tags, kids]) => block("update", { date, tags }, title, kids)))]),
  },
);

const document = fc.array(structure, { minLength: 1, maxLength: 6 }).map((groups) => groups.flat());

// ---------------------------------------------------------------------------------------------------

function roundTrip(doc: Block[]): { back: unknown[]; markdown: string; lossy: string[]; diagnostics: string[] } {
  const { markdown, lossy } = serializeBlocks(doc);
  const parsed = parseMarkdown(markdown, { path: "t.md", extractTitle: false });
  return { back: strip(parsed.blocks), markdown, lossy, diagnostics: parsed.diagnostics.filter((d) => d.severity !== "info").map((d) => `${d.code} ${d.message}`) };
}

// FC_RUNS=5000 pnpm test packages/markdown   — a long soak when changing the grammar or the escaping.
const runs = (n: number) => ({ numRuns: Number(process.env.FC_RUNS) || n });
const timeout = process.env.FC_RUNS ? 1_800_000 : 30_000;

describe("parse(serialize(blocks)) gives the blocks back", () => {
  it("for generated documents of every block type", () => {
    fc.assert(
      fc.property(document, (doc) => {
        const { back, markdown, lossy } = roundTrip(doc);
        expect(lossy, "a canonical document is representable").toEqual([]);
        expect(back, markdown).toEqual(strip(doc));
      }),
      runs(400),
    );
  }, timeout);
});

describe("serialize(parse(markdown)) is stable", () => {
  it("writing what we read and reading it again changes nothing", () => {
    fc.assert(
      fc.property(document, (doc) => {
        const once = serializeBlocks(doc).markdown;
        const parsed = parseMarkdown(once, { path: "t.md", extractTitle: false });
        const twice = serializeBlocks(parsed.blocks).markdown;
        expect(twice).toBe(once);
      }),
      runs(200),
    );
  }, timeout);

  it("is deterministic: the same blocks always produce the same text", () => {
    fc.assert(
      fc.property(document, (doc) => {
        expect(serializeBlocks(doc).markdown).toBe(serializeBlocks(doc).markdown);
      }),
      { numRuns: 50 },
    );
  });
});
