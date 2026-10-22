import { describe, expect, it } from "vitest";
import { analyzeRepository, type AnalyzeInput } from "./analyze";

/** A repository held in memory: a path → text map. */
function memory(files: Record<string, string | Uint8Array>): AnalyzeInput {
  const bytes = (v: string | Uint8Array) => (typeof v === "string" ? new TextEncoder().encode(v) : v);
  return {
    entries: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob" as const, sha: "", size: bytes(content).length })),
    read: async (path) => bytes(files[path]!),
  };
}

const codes = (a: Awaited<ReturnType<typeof analyzeRepository>>) => a.diagnostics.map((d) => d.code).sort();

describe("analyzeRepository", () => {
  it("reads a tidy repository without a single complaint", async () => {
    const a = await analyzeRepository(
      memory({
        "README.md": "# Welcome\n\nSee [install](./guides/install.md) and ![logo](./img/logo.png).\n",
        "guides/install.md": "# Install\n\nGo back [home](../README.md).\n",
        "img/logo.png": new Uint8Array([137, 80, 78, 71]),
      }),
    );
    expect(a.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(a.failure).toBeNull();
    expect(a.markdownFiles).toBe(2);
    expect(a.assetFiles).toBe(1);
    expect(a.pages.map((p) => p.segments.join("/"))).toEqual(["welcome", "guides", "guides/install"]);
  });

  it("points at a broken link and a missing image, with the file", async () => {
    const a = await analyzeRepository(memory({ "README.md": "# Home\n\n[gone](./nope.md)\n\n![x](./missing.png)\n" }));
    expect(codes(a)).toEqual(expect.arrayContaining(["GS-130", "GS-131"]));
    expect(a.diagnostics.find((d) => d.code === "GS-130")).toMatchObject({ path: "README.md", severity: "warning" });
  });

  it("reports bad front matter with its line", async () => {
    const a = await analyzeRepository(memory({ "a.md": "---\ntitle: [unclosed\n---\n\n# A\n" }));
    expect(a.diagnostics.find((d) => d.code === "GS-101")).toMatchObject({ path: "a.md", severity: "error" });
  });

  it("applies the docs directory, and shows paths the way the repository has them", async () => {
    const a = await analyzeRepository(memory({ "README.md": "# Outside\n", "docs/index.md": "# Inside\n\n[x](./nope.md)\n", "docs/a.md": "# A\n" }), { rootDir: "docs" });
    expect(a.markdownFiles).toBe(2);
    expect(a.diagnostics.find((d) => d.code === "GS-130")?.path).toBe("docs/index.md");
  });

  it("takes the docs directory from the repository's own configuration", async () => {
    const a = await analyzeRepository(memory({ ".gitbook.yaml": "root: ./docs/\n", "README.md": "# Outside\n", "docs/README.md": "# Inside\n" }));
    expect(a.config.root).toBe("docs");
    expect(a.pages.map((p) => p.title)).toEqual(["Inside"]);
  });

  it("fails, and says why, when the docs directory does not exist", async () => {
    const a = await analyzeRepository(memory({ "README.md": "# Home\n" }), { rootDir: "docs" });
    expect(a.failure).toMatch(/"docs" does not exist/);
    expect(codes(a)).toContain("GS-302");
  });

  it("fails on a navigation that lists a file that is not there, as a sync would", async () => {
    const a = await analyzeRepository(memory({ "gitcrook.yaml": "nav:\n  - README.md\n  - missing.md\n", "README.md": "# Home\n" }));
    expect(codes(a)).toContain("GS-121");
  });

  it("reports a file the explicit navigation leaves out", async () => {
    const a = await analyzeRepository(memory({ "gitcrook.yaml": "nav:\n  - README.md\n", "README.md": "# Home\n", "extra.md": "# Extra\n" }));
    expect(a.diagnostics.find((d) => d.code === "GS-120")).toMatchObject({ severity: "warning" });
    expect(a.pages.map((p) => p.title)).not.toContain("Extra");
  });

  it("skips what a sync would skip: binary files, LFS pointers, symlinks and oversize files", async () => {
    const lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n";
    const input = memory({ "README.md": "# Home\n", "bin.md": new Uint8Array([1, 0, 2]), "lfs.md": lfs, "big.md": "# Big\n" + "x".repeat(200) });
    input.entries = [...input.entries, { path: "link.md", mode: "120000", type: "blob", sha: "" }];
    const a = await analyzeRepository(input, { limits: { maxMarkdownBytes: 100 } });
    expect(a.diagnostics.map((d) => `${d.code} ${d.path ?? ""}`)).toEqual(
      expect.arrayContaining(["GS-140 bin.md", "GS-160 lfs.md", "GS-160 link.md", "GS-150 big.md"]),
    );
    expect(a.pages.map((p) => p.title)).toEqual(["Home"]);
  });

  it("refuses a repository over the file limit", async () => {
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}.md`, `# P${i}\n`]));
    const a = await analyzeRepository(memory(files), { limits: { maxFiles: 5 } });
    expect(a.failure).toMatch(/limit is 5/);
    expect(codes(a)).toContain("GS-151");
  });

  it("follows an include to another file of the repository", async () => {
    const a = await analyzeRepository(memory({ "README.md": "# Home\n\n{% include \"parts/note.md\" %}\n", "parts/note.md": "Shared **text**.\n" }));
    expect(a.diagnostics.filter((d) => d.severity === "error" || d.code === "GS-131")).toEqual([]);
  });

  it("is repeatable: the same repository gives the same answer however its entries are ordered", async () => {
    const files = { "b.md": "# B\n\n[a](./a.md)\n", "a.md": "# A\n", "c/d.md": "# D\n", "c/e.md": "# E\n[x](./nope.md)" };
    const forward = memory(files);
    const backward = { ...forward, entries: [...forward.entries].reverse() };
    const x = await analyzeRepository(forward);
    const y = await analyzeRepository(backward);
    expect(y.pages).toEqual(x.pages);
    expect(y.diagnostics.map((d) => d.code + d.path).sort()).toEqual(x.diagnostics.map((d) => d.code + d.path).sort());
  });
});
