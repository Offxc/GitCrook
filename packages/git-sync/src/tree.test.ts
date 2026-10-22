import { describe, expect, it } from "vitest";
import { GitHubClient } from "./github/client";
import { GitHostError } from "./github/errors";
import { FakeGitHub, gitBlobSha } from "./testing/fakeGitHub";
import { classify, listFiles } from "./tree";
import { DEFAULT_LIMITS } from "./limits";

function setup(files: Parameters<ReturnType<FakeGitHub["repo"]>["commit"]>[0]) {
  const github = new FakeGitHub();
  const repo = github.repo("acme", "docs");
  repo.commit(files);
  const client = new GitHubClient({ fetch: github.fetch, sleep: async () => undefined });
  const options = async (rootDir = "") => {
    const branch = await client.getBranch("acme", "docs", "main");
    if (branch.notModified) throw new Error("unexpected");
    return { owner: "acme", repo: "docs", branch: "main", repoTreeSha: branch.treeSha, rootDir };
  };
  return { github, repo, client, options };
}

describe("classify", () => {
  it.each([
    ["a.md", "markdown"],
    ["guides/B.MDX", "markdown"],
    ["c.markdown", "markdown"],
    ["img/x.PNG", "asset"],
    ["files/spec.pdf", "asset"],
    ["gitcrook.yaml", "config"],
    ["docs/.gitbook.yaml", "config"],
    ["SUMMARY.md", "config"],
    ["src/index.ts", null],
    ["Makefile", null],
    ["script.js", null],
  ])("%s → %s", (path, kind) => {
    expect(classify(path)).toBe(kind);
  });

  it("treats a configured summary path as config", () => {
    expect(classify("toc/Contents.md", "toc/contents.md")).toBe("config");
  });
});

describe("listFiles", () => {
  it("lists Markdown, assets and config with their object ids", async () => {
    const { client, options } = setup({ "README.md": "# Hi", "guides/a.md": "A", "img/x.png": new Uint8Array([1]), "gitcrook.yaml": "version: 1", "src/index.ts": "x" });
    const listing = await listFiles(client, await options());
    expect(listing.files.map((f) => [f.path, f.kind])).toEqual([
      ["README.md", "markdown"],
      ["gitcrook.yaml", "config"],
      ["guides/a.md", "markdown"],
      ["img/x.png", "asset"],
    ]);
    expect(listing.files[0]).toMatchObject({ sha: gitBlobSha("# Hi"), size: 4 });
  });

  it("reads only the docs directory, with paths relative to it", async () => {
    const { client, options } = setup({ "README.md": "outside", "docs/index.md": "in", "docs/guides/a.md": "A", "other/b.md": "B" });
    const listing = await listFiles(client, await options("docs"));
    expect(listing.files.map((f) => f.path)).toEqual(["guides/a.md", "index.md"]);
  });

  it("finds a nested docs directory", async () => {
    const { client, options } = setup({ "packages/site/docs/a.md": "A" });
    expect((await listFiles(client, await options("packages/site/docs"))).files.map((f) => f.path)).toEqual(["a.md"]);
  });

  it("explains a docs directory that is not there", async () => {
    const { client, options } = setup({ "README.md": "x" });
    const error = await listFiles(client, await options("docs")).catch((e) => e);
    expect(error).toBeInstanceOf(GitHostError);
    expect(error.message).toContain('"docs" does not exist on branch main');
  });

  it("skips symlinks and submodules, and says so", async () => {
    const { client, options } = setup({ "a.md": "A", "link.md": { symlink: "a.md" }, vendor: { submodule: "1".repeat(40) } });
    const listing = await listFiles(client, await options());
    expect(listing.files.map((f) => f.path)).toEqual(["a.md"]);
    expect(listing.diagnostics.filter((d) => d.code === "GS-160").map((d) => d.path).sort()).toEqual(["link.md", "vendor"]);
  });

  it("keeps executable Markdown (a permissions quirk of some checkouts) without comment", async () => {
    const { client, options } = setup({ "a.md": { executable: "A" } });
    const listing = await listFiles(client, await options());
    expect(listing.files.map((f) => f.path)).toEqual(["a.md"]);
    expect(listing.diagnostics).toEqual([]);
  });

  it("summarises ignored file types in one message instead of one per file", async () => {
    const { client, options } = setup({ "a.md": "A", "x.ts": "1", "y.ts": "2", "z.js": "3", Makefile: "4" });
    const listing = await listFiles(client, await options());
    const ignored = listing.diagnostics.filter((d) => d.code === "GS-140");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]!.message).toContain("4 files");
    expect(ignored[0]!.message).toContain(".ts ×2");
  });

  it("walks directory by directory when GitHub truncates the listing", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`d${i % 5}/sub${i % 3}/f${i}.md`] = `file ${i}`;
    const { client, options, github } = setup(files);
    github.maxTreeEntries = 10;
    const listing = await listFiles(client, await options());
    expect(listing.walked).toBe(true);
    expect(listing.files.map((f) => f.path)).toEqual(Object.keys(files).sort());
    expect(github.count(/recursive=1/)).toBe(1);
    expect(github.count(/git\/trees/)).toBeGreaterThan(5);
  });

  it("asks for a directory once however many places it appears", async () => {
    // The same content under many names is one directory in Git.
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`copy-${i}/shared/page.md`] = "identical";
    const { client, options, github } = setup(files);
    github.maxTreeEntries = 10;
    const listing = await listFiles(client, await options());
    expect(listing.walked).toBe(true);
    expect(listing.files).toHaveLength(40);
    // The root, one `copy-N` directory (all identical, so one), and its `shared` directory.
    expect(github.count(/git\/trees/) - github.count(/recursive=1/)).toBeLessThanOrEqual(4);
  });

  it("refuses a repository with more files than the limit", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`f${i}.md`] = "x";
    const { client, options } = setup(files);
    const error = await listFiles(client, { ...(await options()), limits: { ...DEFAULT_LIMITS, maxFiles: 10 } }).catch((e) => e);
    expect(error).toBeInstanceOf(GitHostError);
    expect(error.code).toBe("GS-151");
  });

  it("does not count config files toward the limit", async () => {
    const { client, options } = setup({ "a.md": "A", "gitcrook.yaml": "x" });
    await expect(listFiles(client, { ...(await options()), limits: { ...DEFAULT_LIMITS, maxFiles: 1 } })).resolves.toBeDefined();
  });

  it("skips a file name with a backslash or control character", async () => {
    const { client, options } = setup({ "a.md": "A", "bad\\name.md": "B", "tab\tname.md": "C" });
    const listing = await listFiles(client, await options());
    expect(listing.files.map((f) => f.path)).toEqual(["a.md"]);
    expect(listing.diagnostics.filter((d) => d.code === "GS-170")).toHaveLength(2);
  });
});
