import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { SecretBox } from "@gitcrook/shared/server";
import { randomBytes } from "node:crypto";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { createTokenCredential } from "./credentials";
import { runSync, type AssetImporter, type SyncDeps } from "./sync";
import { ParserPool } from "./parser/pool";
import { FakeGitHub } from "./testing/fakeGitHub";

beforeEach(resetDatabase);

const noSleep = async () => undefined;

/** An importer that records files the way the real one will: one Asset row per (source, path). */
function fakeImporter(): AssetImporter & { imported: string[] } {
  const imported: string[] = [];
  return {
    imported,
    async import(input) {
      imported.push(input.path);
      const asset = await prisma.asset.upsert({
        where: { sourceId_sourcePath: { sourceId: input.sourceId, sourcePath: input.path } },
        create: { organizationId: input.organizationId, siteId: input.siteId, kind: "IMAGE", storageKey: `k/${input.sha}`, mimeType: "image/png", sizeBytes: input.bytes.length, checksumSha256: input.sha, sourceId: input.sourceId, sourcePath: input.path, sourceBlobSha: input.sha },
        update: { sourceBlobSha: input.sha, sizeBytes: input.bytes.length },
      });
      return { assetId: asset.id, url: `/api/files/${asset.id}` };
    },
  };
}

async function setup(options: { files?: Record<string, string>; rootDir?: string; private?: boolean; token?: string } = {}) {
  const github = new FakeGitHub();
  const repo = github.repo("acme", "docs", { private: options.private, tokens: options.token ? [options.token] : [] });
  repo.commit(options.files ?? { "README.md": "# Welcome\n\nHello.\n", "guides/install.md": "# Install\n\nRun it. See [configure](./configure.md).\n", "guides/configure.md": "# Configure\n\nSettings.\n" });

  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  const secrets = new SecretBox(randomBytes(32));
  let credentialId: string | null = null;
  if (options.token) credentialId = (await createTokenCredential(secrets, { organizationId: org.id, token: options.token })).id;

  const source = await prisma.gitSource.create({
    data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main", rootDir: options.rootDir ?? "", credentialId },
  });
  const assets = fakeImporter();
  const logs: string[] = [];
  const deps: SyncDeps = { secrets, assets, fetch: github.fetch, sleep: noSleep, log: (m) => logs.push(m) };
  const sync = (trigger: "MANUAL" | "POLL" | "FULL" | "WEBHOOK" = "MANUAL", extra: Partial<Parameters<typeof runSync>[2]> = {}) => runSync(deps, source.id, { trigger, ...extra });
  return { github, repo, org, site: built.site, variant: built.variant, source, secrets, assets, deps, logs, sync };
}

const pages = async () => Object.fromEntries((await prisma.page.findMany({ where: { deletedAt: null } })).map((p) => [p.sourcePath, p]));
const textOf = (page: { content: unknown }) => JSON.stringify(page.content);
const blobRequests = (github: FakeGitHub) => github.count(/git\/blobs/);

describe("the first sync", () => {
  it("builds the site from the repository", async () => {
    const t = await setup();
    const outcome = await t.sync();
    expect(outcome).toMatchObject({ status: "SUCCEEDED", unchanged: false, toSha: t.repo.head() });
    expect(outcome.stats).toMatchObject({ added: 4, markdownFiles: 3 });

    const p = await pages();
    expect(p["README.md"]).toMatchObject({ title: "Welcome", slug: "welcome", managedBy: "GIT", order: 0 });
    expect(p["dir:guides"]).toMatchObject({ isGroup: true, title: "Guides" });
    expect(p["guides/install.md"]).toMatchObject({ title: "Install", parentId: p["dir:guides"]!.id });
    expect(textOf(p["README.md"]!)).toContain("Hello.");
    // The leading # Heading became the title, not a repeated heading.
    expect(textOf(p["README.md"]!)).not.toContain('"heading"');
  });

  it("rewrites a link to a neighbouring file as a path relative to the page", async () => {
    const t = await setup();
    await t.sync();
    const install = (await pages())["guides/install.md"]!;
    expect(textOf(install)).toContain('"href":"configure"');
    expect(textOf(install)).not.toContain("configure.md");
  });

  it("records the run, the commit and where it got to", async () => {
    const t = await setup();
    const outcome = await t.sync("MANUAL");
    const run = await prisma.gitSyncRun.findUniqueOrThrow({ where: { id: outcome.runId! } });
    expect(run).toMatchObject({ status: "SUCCEEDED", trigger: "MANUAL", toSha: t.repo.head(), error: null });
    expect(run.finishedAt).not.toBeNull();
    expect(run.stats).toMatchObject({ added: 4, errors: 0 });
    const source = await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } });
    expect(source).toMatchObject({ status: "IDLE", lastSyncedSha: t.repo.head(), lastError: null });
    expect(source.lastSyncedAt).not.toBeNull();
    expect((await prisma.pageVersion.findMany()).every((v) => v.origin === "GIT" && v.commitSha === t.repo.head())).toBe(true);
  });

  it("reads only the docs directory when the source has one", async () => {
    const t = await setup({ files: { "README.md": "# Outside", "docs/index.md": "# Inside\n", "docs/a.md": "# A\n" }, rootDir: "docs" });
    await t.sync();
    expect(Object.keys(await pages()).sort()).toEqual(["a.md", "index.md"]);
  });

  it("warns that the branch is not protected", async () => {
    const t = await setup();
    const outcome = await t.sync();
    expect(outcome.diagnostics.map((d) => d.code)).toContain("GS-305");
  });
});

describe("syncing again", () => {
  it("does nothing, and fetches nothing, when the branch has not moved", async () => {
    const t = await setup();
    await t.sync();
    const before = t.github.requests.length;
    const outcome = await t.sync("POLL");
    expect(outcome).toMatchObject({ status: "SUCCEEDED", unchanged: true });
    expect(t.github.requests.length - before).toBe(1); // the conditional branch request
    expect(blobRequests(t.github)).toBe(3);
  });

  it("answers an unchanged branch with a conditional request that costs nothing", async () => {
    const t = await setup();
    await t.sync();
    await t.sync("POLL");
    await t.sync("POLL");
    expect(t.github.requests.at(-1)!.headers["if-none-match"]).toMatch(/^W\//);
  });

  it("re-reads everything on a full sync, and still changes nothing", async () => {
    const t = await setup();
    await t.sync();
    const before = JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }));
    const outcome = await t.sync("FULL");
    expect(outcome.unchanged).toBe(false);
    expect(outcome.stats).toMatchObject({ added: 0, updated: 0, deleted: 0, moved: 0 });
    expect(JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }))).toBe(before);
  });

  it("fetches only the file that was edited", async () => {
    const t = await setup();
    await t.sync();
    const requestsBefore = blobRequests(t.github);
    t.repo.commit({ "guides/configure.md": "# Configure\n\nNew settings.\n" });
    const outcome = await t.sync();
    expect(outcome.stats).toMatchObject({ updated: 1, added: 0, deleted: 0 });
    expect(blobRequests(t.github) - requestsBefore).toBe(1);
    const p = await pages();
    expect(textOf(p["guides/configure.md"]!)).toContain("New settings.");
    expect(p["guides/configure.md"]!.contentVersion).toBe(2);
    expect(p["guides/install.md"]!.contentVersion).toBe(1);
  });

  it("adds a new file in a new place", async () => {
    const t = await setup();
    await t.sync();
    t.repo.commit({ "reference/cli.md": "# CLI\n\nFlags.\n" });
    await t.sync();
    const p = await pages();
    expect(p["reference/cli.md"]).toMatchObject({ title: "CLI", parentId: p["dir:reference"]!.id });
  });
});

describe("moving and deleting", () => {
  it("keeps a moved page's identity and leaves a redirect, without downloading the moved file again", async () => {
    const t = await setup();
    await t.sync();
    const before = (await pages())["guides/configure.md"]!;
    const fetched = blobRequests(t.github);

    // The commit that moves the file also fixes the link that pointed at it, as a real one would.
    t.repo.commit({ "guides/configure.md": null, "setup/configure.md": "# Configure\n\nSettings.\n", "guides/install.md": "# Install\n\nRun it. See [configure](../setup/configure.md).\n" });
    const outcome = await t.sync();
    expect(outcome.stats).toMatchObject({ moved: 1, deleted: 0, updated: 1, added: 1 /* the new group */ });

    const p = await pages();
    expect(p["setup/configure.md"]!.id).toBe(before.id);
    expect((await prisma.siteRedirect.findMany()).map((r) => [r.fromPath, r.toPath])).toEqual([["guides/configure", "setup/configure"]]);
    expect(textOf(p["guides/install.md"]!)).toContain('"href":"../setup/configure"');
    // Only the page that was edited was downloaded.
    expect(blobRequests(t.github) - fetched).toBe(1);
  });

  it("reads a page again when something it links to moves, even though the page itself did not change", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n[to guide](./guides/install.md)\n", "guides/install.md": "# Install\n", "guides/other.md": "# Other\n" } });
    await t.sync();
    expect(textOf((await pages())["a.md"]!)).toContain('"href":"guides/install"');
    // The folder gets a page of its own with a new URL segment; nothing about a.md changed.
    t.repo.commit({ "guides/index.md": "---\nslug: manual\n---\n# Manual\n" });
    await t.sync();
    expect(textOf((await pages())["a.md"]!)).toContain('"href":"manual/install"');
  });

  it("keeps block ids when a page moves", async () => {
    const t = await setup();
    await t.sync();
    const ids = (content: unknown) => (content as { id: string }[]).map((b) => b.id);
    const before = ids((await pages())["guides/configure.md"]!.content);
    t.repo.commit({ "guides/configure.md": null, "setup/configure.md": "# Configure\n\nSettings.\n" });
    await t.sync();
    expect(ids((await pages())["setup/configure.md"]!.content)).toEqual(before);
  });

  it("follows a page through a rename that also edits it, by its front-matter id", async () => {
    const t = await setup({ files: { "old.md": "---\nid: stable\n---\n# Old\n\nBody.\n" } });
    await t.sync();
    const id = (await pages())["old.md"]!.id;
    t.repo.commit({ "old.md": null, "new.md": "---\nid: stable\n---\n# New\n\nChanged body.\n" });
    const outcome = await t.sync();
    expect(outcome.stats).toMatchObject({ moved: 1, deleted: 0 });
    const page = (await pages())["new.md"]!;
    expect(page.id).toBe(id);
    expect(textOf(page)).toContain("Changed body.");
    expect(page.contentVersion).toBe(2);
  });

  it("soft-deletes a removed file, and brings it back with its history if it returns", async () => {
    const t = await setup();
    await t.sync();
    const id = (await pages())["guides/install.md"]!.id;
    t.repo.commit({ "guides/install.md": null });
    await t.sync();
    expect((await prisma.page.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
    expect(Object.keys(await pages())).not.toContain("guides/install.md");

    t.repo.commit({ "guides/install.md": "# Install\n\nRun it. See [configure](./configure.md).\n" });
    const outcome = await t.sync();
    expect(outcome.stats.revived).toBe(1);
    expect((await prisma.page.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });

  it("removes a page for good once its grace period is over", async () => {
    const t = await setup();
    await t.sync();
    const id = (await pages())["guides/install.md"]!.id;
    t.repo.commit({ "guides/install.md": null });
    await t.sync();
    await prisma.page.update({ where: { id }, data: { deletedAt: new Date(Date.now() - 15 * 86_400_000) } });
    t.repo.commit({ "extra.md": "# Extra\n" });
    await t.sync();
    expect(await prisma.page.findUnique({ where: { id } })).toBeNull();
  });

  it("is not fooled by a force-push to unrelated history", async () => {
    const t = await setup();
    await t.sync();
    t.repo.forcePush({ "README.md": "# Welcome\n\nHello.\n", "guides/install.md": "# Install\n\nRewritten.\n", "extra.md": "# Extra\n" });
    const outcome = await t.sync();
    expect(outcome.status).toBe("SUCCEEDED");
    const p = await pages();
    expect(Object.keys(p).filter((k) => !k.startsWith("dir:")).sort()).toEqual(["README.md", "extra.md", "guides/install.md"]);
    expect(textOf(p["guides/install.md"]!)).toContain("Rewritten.");
    expect(await prisma.page.count({ where: { sourcePath: "guides/configure.md", deletedAt: { not: null } } })).toBe(1);
  });
});

describe("navigation", () => {
  it("follows SUMMARY.md", async () => {
    const t = await setup({ files: { "SUMMARY.md": "## Start\n\n* [Second](b.md)\n* [First](a.md)\n", "a.md": "# A\n", "b.md": "# B\n" } });
    await t.sync();
    const p = await pages();
    expect(p["b.md"]!.order).toBe(0);
    expect(p["a.md"]!.order).toBe(1);
    expect(p["SUMMARY.md"]).toBeUndefined();
  });

  it("follows gitcrook.yaml, and does not publish what it leaves out", async () => {
    const t = await setup({ files: { "gitcrook.yaml": "nav:\n  - b.md\n", "a.md": "# A\n", "b.md": "# B\n" } });
    const outcome = await t.sync();
    expect(Object.keys(await pages())).toEqual(["b.md"]);
    expect(outcome.diagnostics.find((d) => d.code === "GS-120")).toMatchObject({ path: "a.md" });
  });

  it("is rebuilt from every file, not just the ones that changed", async () => {
    const t = await setup({ files: { "a.md": "---\norder: 1\n---\n# A\n", "b.md": "---\norder: 2\n---\n# B\n" } });
    await t.sync();
    t.repo.commit({ "b.md": "---\norder: 0\n---\n# B\n" });
    await t.sync();
    const p = await pages();
    expect([p["b.md"]!.order, p["a.md"]!.order]).toEqual([0, 1]);
  });
});

describe("what goes wrong in the repository", () => {
  it("stops, changing nothing, when gitcrook.yaml is not valid", async () => {
    const t = await setup();
    await t.sync();
    const before = JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }));
    t.repo.commit({ "gitcrook.yaml": "nav: [unclosed\n", "guides/new.md": "# New\n" });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("gitcrook.yaml");
    expect(JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }))).toBe(before);
    const source = await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } });
    expect(source.lastSyncedSha).not.toBe(t.repo.head());
    expect(source.lastError).toContain("gitcrook.yaml");
  });

  it("stops when the navigation names a file that is not there", async () => {
    const t = await setup({ files: { "gitcrook.yaml": "nav:\n  - nope.md\n", "a.md": "# A\n" } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("nope.md");
    expect(await prisma.page.count()).toBe(0);
  });

  it("publishes the rest when one page has bad front matter, and says which", async () => {
    const t = await setup({ files: { "good.md": "# Good\n", "bad.md": "---\ntitle: [oops\n---\n# Bad\n\nBody.\n" } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("PARTIAL");
    expect(outcome.diagnostics.find((d) => d.code === "GS-101")).toMatchObject({ path: "bad.md", severity: "error" });
    expect(Object.keys(await pages()).sort()).toEqual(["bad.md", "good.md"]);
  });

  it("keeps reporting a page's problems on later syncs until they are fixed", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n[gone](./missing.md)\n" } });
    const first = await t.sync();
    expect(first.diagnostics.map((d) => d.code)).toContain("GS-130");
    t.repo.commit({ "b.md": "# B\n" });
    const second = await t.sync();
    expect(second.diagnostics.filter((d) => d.code === "GS-130")).toHaveLength(1);
    t.repo.commit({ "a.md": "# A\n\nFixed.\n" });
    const third = await t.sync();
    expect(third.diagnostics.map((d) => d.code)).not.toContain("GS-130");
  });

  it("skips a Git LFS pointer, a binary file and an oversized one, and carries on", async () => {
    const lfs = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12345\n";
    const t = await setup({ files: { "ok.md": "# OK\n", "lfs.md": lfs, "big.md": `# Big\n\n${"x".repeat(200)}\n` } });
    t.deps.limits = { maxMarkdownBytes: 100 };
    t.repo.commit({ "bin.md": new Uint8Array([35, 32, 0, 1, 2]) as never });
    const outcome = await t.sync();
    const codes = outcome.diagnostics.map((d) => [d.code, d.path]);
    expect(codes).toEqual(expect.arrayContaining([["GS-160", "lfs.md"], ["GS-150", "big.md"], ["GS-140", "bin.md"]]));
    expect(Object.keys(await pages())).toEqual(["ok.md"]);
  });

  it("will not touch a variant that already has pages of its own", async () => {
    const t = await setup();
    await prisma.page.create({ data: { variantId: t.variant.id, siteId: t.site.id, slug: "handmade", title: "Handmade", order: 0, content: [] } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("does not manage");
    expect(await prisma.page.count()).toBe(1);
  });
});

describe("files the pages use", () => {
  it("imports an image once, and points the page at it", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n![Logo](./img/logo.png)\n", "img/logo.png": "PNGDATA" } });
    const outcome = await t.sync();
    expect(outcome.stats.assetsImported).toBe(1);
    const asset = await prisma.asset.findFirstOrThrow({ where: { sourcePath: "img/logo.png" } });
    expect(textOf((await pages())["a.md"]!)).toContain(`/api/files/${asset.id}`);

    t.repo.commit({ "b.md": "# B\n" });
    await t.sync();
    expect(t.assets.imported).toEqual(["img/logo.png"]); // not imported again
  });

  it("imports it again when the image changes", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n![Logo](./img/logo.png)\n", "img/logo.png": "ONE" } });
    await t.sync();
    t.repo.commit({ "img/logo.png": "TWO" });
    // The image changed, not the page: nothing links to a different place, so the page is untouched, but the asset is stale.
    await t.sync("FULL");
    t.repo.commit({ "a.md": "# A\n\n![Logo](./img/logo.png)\n\nEdited.\n" });
    await t.sync();
    expect(t.assets.imported).toEqual(["img/logo.png", "img/logo.png"]);
  });

  it("does not import files nothing refers to", async () => {
    const t = await setup({ files: { "a.md": "# A\n", "img/unused.png": "X" } });
    await t.sync();
    expect(t.assets.imported).toEqual([]);
  });

  it("reports an image that is not in the repository", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n![Gone](./nope.png)\n" } });
    const outcome = await t.sync();
    expect(outcome.diagnostics.find((d) => d.code === "GS-131")).toMatchObject({ path: "a.md" });
  });

  it("reports an image the importer refuses", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n![x](./bad.png)\n", "bad.png": "NOT AN IMAGE" } });
    t.deps.assets = { import: async () => ({ error: "unsupported file type" }) };
    const outcome = await t.sync();
    expect(outcome.diagnostics.find((d) => d.code === "GS-131")?.message).toContain("unsupported file type");
  });
});

describe("credentials", () => {
  it("reads a private repository with its token, and the token is stored encrypted", async () => {
    const t = await setup({ private: true, token: "ghp_privateRepoToken123" });
    const outcome = await t.sync();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(t.github.requests.every((r) => r.headers.authorization === "Bearer ghp_privateRepoToken123")).toBe(true);
    const stored = await prisma.gitCredential.findFirstOrThrow();
    expect(Buffer.from(stored.secretCiphertext!).toString("latin1")).not.toContain("privateRepoToken");
  });

  it("fails clearly when the token is rejected, without the token appearing anywhere that is stored", async () => {
    const t = await setup({ private: true, token: "ghp_goodToken123456" });
    t.github.validTokens.delete("ghp_goodToken123456");
    const outcome = await t.sync();
    expect(outcome).toMatchObject({ status: "FAILED" });
    const stored = JSON.stringify([await prisma.gitSyncRun.findMany(), await prisma.gitSource.findMany()]);
    expect(stored).not.toContain("ghp_goodToken123456");
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } })).status).toBe("ERROR");
  });

  it("explains a private repository that the token cannot see", async () => {
    const t = await setup({ private: true, token: "ghp_goodToken123456" });
    t.github.repo("acme", "docs", { private: true, tokens: ["someone-else"] });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toMatch(/not found|cannot see/);
  });

  it("fails if the encryption key is gone, and says why", async () => {
    const t = await setup({ private: true, token: "ghp_goodToken123456" });
    t.deps.secrets = null;
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("GIT_SYNC_ENCRYPTION_KEY");
  });
});

describe("GitHub having a bad day", () => {
  it("waits out a short rate limit and finishes", async () => {
    const t = await setup();
    t.github.fail(/branches\/main$/, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(t.github.now() + 2) } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.diagnostics.map((d) => d.code)).toContain("GS-301");
  });

  it("gives up on a long one without marking the source broken", async () => {
    const t = await setup();
    t.github.fail(/branches\/main$/, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(t.github.now() + 7200) } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("rate limit");
    const source = await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } });
    expect(source.status).toBe("IDLE"); // it will try again by itself
    expect(source.lastError).toContain("rate limit");
  });

  it("survives a dropped connection part-way and leaves nothing half-done", async () => {
    const t = await setup();
    t.github.fail(/git\/blobs/, "drop", 100);
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(await prisma.page.count()).toBe(0);
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } })).lastSyncedSha).toBeNull();
    t.github.requests.length = 0;
  });

  it("carries on after a transient failure on the next attempt", async () => {
    const t = await setup();
    t.github.fail(/git\/blobs/, { status: 502 }, 20);
    expect((await t.sync()).status).toBe("FAILED");
    expect((await t.sync()).status).toBe("SUCCEEDED");
    expect(await prisma.page.count({ where: { deletedAt: null } })).toBe(4);
  });

  it("walks a repository whose listing GitHub truncates", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 25; i++) files[`d${i % 4}/s${i % 3}/f${i}.md`] = `# File ${i}\n`;
    const t = await setup({ files });
    t.github.maxTreeEntries = 8;
    const outcome = await t.sync();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(await prisma.page.count({ where: { sourcePath: { endsWith: ".md" } } })).toBe(25);
  });

  it("stops a run that takes too long", async () => {
    const t = await setup();
    let clock = Date.now();
    t.deps.now = () => new Date((clock += 400));
    t.deps.limits = { runTimeoutMs: 1000 };
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain("too long");
    expect(await prisma.page.count()).toBe(0);
  });

  it("reports a docs directory that does not exist", async () => {
    const t = await setup({ rootDir: "nope" });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toContain('"nope" does not exist');
  });

  it("reports a branch that does not exist", async () => {
    const t = await setup();
    await prisma.gitSource.update({ where: { id: t.source.id }, data: { branch: "ghost" } });
    const outcome = await t.sync();
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error).toMatch(/ghost/);
  });
});

describe("a dry run", () => {
  it("shows what would happen and changes nothing at all", async () => {
    const t = await setup();
    const outcome = await t.sync("MANUAL", { dryRun: true });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.runId).toBeNull();
    expect(outcome.preview!.plan.added.sort()).toEqual(["README.md", "guides/configure.md", "guides/install.md"]);
    expect(outcome.preview!.tree.map((n) => [n.key, n.children.map((c) => c.key)])).toEqual([["README.md", []], ["dir:guides", ["guides/configure.md", "guides/install.md"]]]);
    expect(await prisma.page.count()).toBe(0);
    expect(await prisma.gitSyncRun.count()).toBe(0);
    const source = await prisma.gitSource.findUniqueOrThrow({ where: { id: t.source.id } });
    expect(source).toMatchObject({ status: "IDLE", lastSyncedSha: null });
  });
});

describe("pages that link to each other", () => {
  it("are rewritten when the page they link to is renamed in its front matter", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n[to b](./b.md)\n", "b.md": "# B\n" } });
    await t.sync();
    expect(textOf((await pages())["a.md"]!)).toContain('"href":"b"');
    t.repo.commit({ "b.md": "---\nslug: renamed\n---\n# B\n" });
    await t.sync();
    expect(textOf((await pages())["a.md"]!)).toContain('"href":"renamed"');
  });

  it("start to resolve when the missing page appears", async () => {
    const t = await setup({ files: { "a.md": "# A\n\n[to b](./b.md)\n" } });
    const first = await t.sync();
    expect(first.diagnostics.map((d) => d.code)).toContain("GS-130");
    t.repo.commit({ "b.md": "# B\n" });
    const second = await t.sync();
    expect(second.diagnostics.map((d) => d.code)).not.toContain("GS-130");
    expect(textOf((await pages())["a.md"]!)).toContain('"href":"b"');
  });
});

describe("files that are hostile or too much", () => {
  it("stops a file the parser cannot finish, reports it, and publishes everything else", async () => {
    const pool = new ParserPool({ timeoutMs: 500 });
    try {
      const t = await setup({ files: { "ok.md": "# OK\n\nFine.\n", "evil.md": ":::a\n".repeat(3000), "also-ok.md": "# Also OK\n" } });
      t.deps.parser = pool;
      const outcome = await t.sync();
      expect(outcome.status).toBe("PARTIAL");
      expect(outcome.diagnostics.find((d) => d.code === "GS-208")).toMatchObject({ path: "evil.md", severity: "error" });
      expect(Object.keys(await pages()).sort()).toEqual(["also-ok.md", "ok.md"]);
    } finally {
      pool.close();
    }
  }, 60_000);

  it("leaves a page as it was when its file stops being readable", async () => {
    const t = await setup({ files: { "a.md": "# A\n\nOriginal text.\n", "b.md": "# B\n" } });
    await t.sync();
    t.deps.limits = { maxMarkdownBytes: 200 };
    t.repo.commit({ "a.md": `# A\n\nChanged.\n${"x".repeat(500)}\n` });
    const outcome = await t.sync();
    expect(outcome.diagnostics.map((d) => [d.code, d.path])).toContainEqual(["GS-150", "a.md"]);
    const p = await pages();
    expect(Object.keys(p).sort()).toEqual(["a.md", "b.md"]);
    expect(textOf(p["a.md"]!)).toContain("Original text.");
    expect(p["a.md"]!.deletedAt).toBeNull();

    // And once it is small again, it is read again.
    t.repo.commit({ "a.md": "# A\n\nShort again.\n" });
    await t.sync();
    expect(textOf((await pages())["a.md"]!)).toContain("Short again.");
  }, 60_000);

  it("fetches identical files once, however many names they have", async () => {
    const same = "# Same\n\nIdentical content.\n";
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`copy-${i}.md`, same]));
    const t = await setup({ files });
    const outcome = await t.sync();
    expect(outcome.stats.added).toBeGreaterThanOrEqual(12);
    expect(blobRequests(t.github)).toBe(1);
  }, 60_000);

  it("stops reading Markdown once a run has read as much as it may", async () => {
    const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`p${i}.md`, `# P${i}\n\n${String(i).repeat(300)}\n`]));
    const t = await setup({ files });
    t.deps.limits = { maxMarkdownRunBytes: 1000 };
    const outcome = await t.sync();
    const skipped = outcome.diagnostics.filter((d) => d.code === "GS-150");
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]!.message).toContain("already read");
    expect(Object.keys(await pages()).length).toBeLessThan(8);
    expect(Object.keys(await pages()).length).toBeGreaterThan(0);
  }, 60_000);
});
