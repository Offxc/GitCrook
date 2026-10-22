import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

/**
 * The checker is meant to be one file you drop into a documentation repository. That only works if the bundle stays
 * free of the server — the database client above all — so this builds it the way `build.mjs` does and runs the result.
 */
describe("the bundled checker", () => {
  it("is self-contained, free of the server's dependencies, and runs under plain Node", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gitcrook-docs-bundle-"));
    const out = join(dir, "gitcrook-docs.mjs");
    await build({
      entryPoints: [new URL("./bin.ts", import.meta.url).pathname],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
      logLevel: "silent",
    });

    const source = await readFile(out, "utf8");
    expect(source).not.toMatch(/PrismaClient|@prisma\/|argon2|playwright/);
    expect(source.length).toBeLessThan(3_000_000);

    const repo = join(dir, "repo");
    await mkdir(repo);
    await writeFile(join(repo, "README.md"), "# Hello\n\n[gone](./nope.md)\n");
    const ok = await exec(process.execPath, [out, "check", repo, "--format", "json"]);
    expect(JSON.parse(ok.stdout)).toMatchObject({ ok: true, counts: { warning: 1 } });

    await expect(exec(process.execPath, [out, "check", repo, "--strict"])).rejects.toMatchObject({ code: 1 });
    await expect(exec(process.execPath, [out, "bogus"])).rejects.toMatchObject({ code: 2 });
  });
});
