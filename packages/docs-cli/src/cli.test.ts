import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./cli";
import { readDirectory } from "./fsRepo";

/** A folder holding the given files, in the system's temp directory. */
async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gitcrook-docs-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const TIDY = { "README.md": "# Welcome\n\nSee [install](./guides/install.md).\n", "guides/install.md": "# Install\n\nBack [home](../README.md).\n" };
const WARNS = { "README.md": "# Welcome\n\n[gone](./nope.md)\n" };
const BROKEN = { "gitcrook.yaml": "nav:\n  - README.md\n  - missing.md\n", "README.md": "# Welcome\n" };

describe("gitcrook-docs check", () => {
  it("passes a tidy repository", async () => {
    const r = await run(["check", await repo(TIDY), "--no-color"]);
    expect(r).toMatchObject({ code: 0, stderr: "" });
    expect(r.stdout).toContain("0 errors, 0 warnings");
    expect(r.stdout).toContain("3 pages from 2 Markdown files");
  });

  it("lists problems under the file they are in, with the line", async () => {
    const r = await run(["check", await repo({ "a.md": "---\ntitle: A\norder: soon\n---\n\n# A\n\n[gone](./nope.md)\n" }), "--no-color"]);
    expect(r.stdout).toMatch(/^a\.md$/m);
    expect(r.stdout).toMatch(/\bwarning\b +GS-103 +Front matter "order"/);
    expect(r.stdout).toMatch(/\bwarning\b +GS-130 +"\.\/nope\.md"/);
  });

  it("lets warnings through unless --strict", async () => {
    const dir = await repo(WARNS);
    expect((await run(["check", dir])).code).toBe(0);
    expect((await run(["check", dir, "--strict"])).code).toBe(1);
  });

  it("fails on an error, and says a sync would not run", async () => {
    const r = await run(["check", await repo(BROKEN), "--no-color"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("GS-121");
    expect(r.stdout).toContain("A sync would not run: gitcrook.yaml");
  });

  it("hides notes until asked", async () => {
    const dir = await repo({ ...TIDY, "notes.txt": "plain", "photo.xyz": "x" });
    const quiet = await run(["check", dir, "--no-color"]);
    expect(quiet.stdout).not.toContain("GS-140");
    expect(quiet.stdout).toMatch(/1 note hidden/);
    expect((await run(["check", dir, "--no-color", "--verbose"])).stdout).toContain("GS-140");
  });

  it("reads the docs folder given with --dir", async () => {
    const dir = await repo({ "README.md": "# Outside\n\n[x](./nope.md)\n", "docs/index.md": "# Inside\n" });
    const r = await run(["check", dir, "--dir", "docs", "--no-color"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1 page from 1 Markdown file");
    const missing = await run(["check", dir, "--dir", "nope"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain('The directory "nope" does not exist');
  });

  it("prints JSON that a program can read", async () => {
    const r = await run(["check", await repo(WARNS), "--format", "json"]);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: true, failure: null, counts: { error: 0, warning: 1, info: 0 }, pages: 1 });
    expect(out.diagnostics[0]).toMatchObject({ code: "GS-130", path: "README.md" });
    expect(JSON.parse((await run(["check", await repo(WARNS), "--format", "json", "--strict"])).stdout).ok).toBe(false);
  });

  it("prints GitHub annotations, escaping what must be", async () => {
    const r = await run(["check", await repo({ "a,b.md": "# A\n\n[x](./no%pe.md)\n" }), "--format", "github"]);
    expect(r.stdout).toMatch(/^::warning file=a%2Cb\.md,title=GS-130::.*no%25pe\.md/m);
  });

  it("reports a symbolic link as the server would", async () => {
    const dir = await repo({ "README.md": "# Home\n" });
    await symlink("README.md", join(dir, "alias.md"));
    const r = await run(["check", dir, "--no-color"]);
    expect(r.stdout).toMatch(/GS-160 +"alias\.md" is a symbolic link/);
  });
});

describe("gitcrook-docs tree", () => {
  it("lists the pages with their addresses", async () => {
    const r = await run(["tree", await repo({ ...TIDY, "guides/hidden.md": "---\nhidden: true\n---\n# Hidden\n" })]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Welcome  /welcome\nGuides  /guides  (group)\n  Hidden  /guides/hidden  (hidden)\n  Install  /guides/install\n");
  });
});

describe("running it wrongly", () => {
  it("says what is wrong and exits 2", async () => {
    expect(await run([])).toMatchObject({ code: 2 });
    expect(await run(["nonsense"])).toMatchObject({ code: 2 });
    expect(await run(["check", "/definitely/not/here"])).toMatchObject({ code: 2 });
    expect(await run(["check", ".", "--format", "xml"])).toMatchObject({ code: 2 });
    expect(await run(["check", ".", "--bogus"])).toMatchObject({ code: 2 });
    expect((await run(["check", await repo(TIDY), "extra"])).code).toBe(2);
  });

  it("has help and a version", async () => {
    expect((await run(["--help"])).stdout).toContain("Usage");
    expect((await run(["--version"])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("reading a folder as a repository", () => {
  it("takes what Git would commit: tracked files and new ones, not ignored ones", async () => {
    const dir = await repo({ "README.md": "# Home\n", "ignored/secret.md": "# Secret\n", "node_modules/pkg/readme.md": "# Dep\n", ".gitignore": "ignored/\nnode_modules/\n" });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const input = await readDirectory(dir);
    expect(input.entries.map((e) => e.path).sort()).toEqual([".gitignore", "README.md"]);
  });

  it("outside Git, takes everything except .git and node_modules", async () => {
    const dir = await repo({ "README.md": "# Home\n", "docs/a.md": "# A\n", "node_modules/pkg/readme.md": "# Dep\n", ".git/config": "x" });
    const input = await readDirectory(dir);
    expect(input.entries.map((e) => e.path).sort()).toEqual(["README.md", "docs/a.md"]);
  });

  it("reads file contents by repository path", async () => {
    const input = await readDirectory(await repo({ "docs/a.md": "# Hello\n" }));
    expect(new TextDecoder().decode(await input.read("docs/a.md"))).toBe("# Hello\n");
  });
});
