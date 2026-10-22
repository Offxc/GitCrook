import { afterAll, describe, expect, it } from "vitest";
import { parseMarkdown } from "@gitcrook/markdown";
import { ParseCrashError, ParseTimeoutError, ParserPool } from "./pool";

const pools: ParserPool[] = [];
const pool = (options: ConstructorParameters<typeof ParserPool>[0] = {}) => {
  const p = new ParserPool(options);
  pools.push(p);
  return p;
};
afterAll(() => pools.forEach((p) => p.close()));

// Starting the thread loads the TypeScript loader and the parser: a second or two the first time.
const SLOW = 60_000;

describe("ParserPool", () => {
  it("gives the answer parseMarkdown gives", async () => {
    const source = "---\ntitle: Hello\nextra: [1, 2]\n---\n\n# Hello\n\nSome **text** with a [link](./other.md).\n\n- a\n- b\n\n> [!NOTE]\n> Careful\n";
    const viaThread = await pool().parse(source, { path: "docs/a.md" });
    expect(viaThread).toEqual(parseMarkdown(source, { path: "docs/a.md" }));
  }, SLOW);

  it("follows includes through the resolver, fetching what the page asks for", async () => {
    const asked: string[] = [];
    const files: Record<string, string> = { "part.md": "Shared **text**.\n" };
    const result = await pool().parse('Intro\n\n{% include "part.md" %}\n', { path: "a.md" }, async (target) => {
      asked.push(target);
      return files[target] ?? null;
    });
    expect(asked).toEqual(["part.md"]);
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.blocks)).toContain("Shared");
  }, SLOW);

  it("reports an include that does not exist, as parseMarkdown does", async () => {
    const result = await pool().parse('{% include "nope.md" %}\n', { path: "a.md" }, async () => null);
    expect(result.diagnostics.map((d) => d.code)).toContain("GS-131");
  }, SLOW);

  it("handles many requests in order", async () => {
    const p = pool();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => p.parse(`# Page ${i}\n\ntext ${i}\n`, { path: `p${i}.md` })));
    results.forEach((r, i) => expect(r.title).toBe(`Page ${i}`));
  }, SLOW);

  it("stops a file that takes too long, says so, and carries on with the next", async () => {
    const p = pool({ timeoutMs: 400 });
    await p.parse("warm up\n"); // so the time limit measures parsing, not starting the thread

    // Unclosed nested directives: seconds of work for micromark at this size, minutes at ten times it.
    const hostile = ":::a\n".repeat(3000);
    const started = Date.now();
    await expect(p.parse(hostile, { path: "evil.md" })).rejects.toBeInstanceOf(ParseTimeoutError);
    expect(Date.now() - started).toBeLessThan(5000);

    const after = await p.parse("# Fine\n\nstill works\n", { path: "ok.md" });
    expect(after.title).toBe("Fine");
  }, SLOW);

  it("does not let one file's failure fail the files queued behind it", async () => {
    const p = pool({ timeoutMs: 400 });
    await p.parse("warm up\n");
    const [slow, fast] = await Promise.allSettled([p.parse(":::a\n".repeat(3000), { path: "evil.md" }), p.parse("# Fast\n", { path: "fast.md" })]);
    expect(slow.status).toBe("rejected");
    expect(fast.status).toBe("fulfilled");
  }, SLOW);

  it("fails what is waiting when it is shut down, and refuses new work", async () => {
    const p = pool();
    await p.parse("warm up\n");
    p.close();
    await expect(p.parse("x\n")).rejects.toBeInstanceOf(ParseCrashError);
  }, SLOW);
});
