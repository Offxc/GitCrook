import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../index";
import { translateLiquid } from "../parse/liquid";
import { Diagnostics } from "../diagnostics";

/**
 * A repository is untrusted, and the parser runs on the machine that syncs everyone's. Inputs written to be slow must be
 * answered quickly (the budgets here) — and where the Markdown parser itself is the slow part, the sync runs it with a
 * hard time limit (see packages/git-sync/src/parser). The limits below are generous: each case takes milliseconds.
 */
const quickly = (fn: () => unknown, ms: number) => {
  const start = performance.now();
  fn();
  expect(performance.now() - start).toBeLessThan(ms);
};

describe("tag matching", () => {
  it("rejects a long unterminated tag in linear time", () => {
    for (const filler of [" ", "\t", " \t ", "{% ", "-"]) {
      quickly(() => translateLiquid("{% a" + filler.repeat(200_000) + "x", { diags: new Diagnostics("a.md") }), 500);
      quickly(() => translateLiquid("{%" + filler.repeat(200_000) + "%} {%", { diags: new Diagnostics("a.md") }), 500);
    }
  });

  it("does not take a very long line for a tag, but still reads ordinary ones", () => {
    expect(translateLiquid(`{% hint style="info" %}${"x".repeat(5000)}{% endhint %}`, { diags: new Diagnostics("a.md") })).toContain("{% hint");
    expect(translateLiquid('  {%- hint style="info" -%}\nText\n{%- endhint -%}', { diags: new Diagnostics("a.md") })).toBe('  :::::::::::hint{style="info"}\nText\n:::::::::::');
  });
});

describe("includes", () => {
  it("add up to a bounded amount however they nest", () => {
    const fan = (target: string) => `{% include "${target}" %}\n`.repeat(60);
    const files: Record<string, string> = { "a.md": fan("b.md"), "b.md": fan("c.md"), "c.md": fan("d.md"), "d.md": "x\n".repeat(100) };
    const diags = new Diagnostics("a.md");
    let out = "";
    quickly(() => {
      out = translateLiquid(files["a.md"]!, { diags, resolveInclude: (p) => files[p] ?? null });
    }, 1000);
    expect(out.length).toBeLessThan(2_500_000);
    expect(diags.items.some((d) => d.code === "GS-207" && /includes/.test(d.message))).toBe(true);
    expect(diags.items.filter((d) => d.code === "GS-207")).toHaveLength(1);
  });

  it("still follow a few ordinary ones", () => {
    const files: Record<string, string> = { "part.md": "Shared **text**.\n" };
    const r = parseMarkdown('Intro\n\n{% include "part.md" %}\n\n{% include "part.md" %}\n', { resolveInclude: (p) => files[p] ?? null });
    expect(r.diagnostics).toEqual([]);
    expect(r.blocks).toHaveLength(3);
  });
});

describe("tags nested too deeply", () => {
  it("are removed past the limit, and the page still reads", () => {
    const source = '{% hint style="info" %}\n'.repeat(3000) + "inside\n" + "{% endhint %}\n".repeat(3000);
    let result!: ReturnType<typeof parseMarkdown>;
    quickly(() => {
      result = parseMarkdown(source);
    }, 3000);
    expect(result.diagnostics.some((d) => d.code === "GS-207")).toBe(true);
    expect(JSON.stringify(result.blocks)).toContain("inside");
  });

  it("keep their closing tags matched, so what follows is not swallowed", () => {
    const open = '{% hint style="info" %}\n'.repeat(12);
    const close = "{% endhint %}\n".repeat(12);
    const r = parseMarkdown(`${open}inner\n${close}\nafter\n`);
    const last = r.blocks[r.blocks.length - 1]!;
    expect(last.type).toBe("paragraph");
    expect(JSON.stringify(last.content)).toContain("after");
  });
});

describe("image addresses", () => {
  it.each(["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "JaVaScRiPt:alert(1)", "  javascript:alert(1)"])("leaves out an image whose address is %j, and says so", (url) => {
    const r = parseMarkdown(`![x](<${url}>)\n`);
    expect(r.blocks).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["GS-132"]);
  });

  it("keeps the text around an image that was left out", () => {
    const r = parseMarkdown("Before ![x](javascript:alert(1)) after\n");
    expect(r.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(r.references).toEqual([]);
  });

  it("keeps ordinary addresses: relative, site-root and https", () => {
    const r = parseMarkdown("![a](./a.png)\n\n![b](/api/files/x)\n\n![c](https://example.com/c.png)\n");
    expect(r.blocks.map((b) => b.props.url)).toEqual(["./a.png", "/api/files/x", "https://example.com/c.png"]);
  });
});
