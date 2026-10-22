import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { SecretBox } from "@gitcrook/shared/server";
import { makeOrg, makePage, makeSite, resetDatabase } from "../../../tests/support/factory";
import { hostConfigFromEnv } from "./config";
import { connectSource, disconnectSource, requestSync, setPaused, updateSource, MAX_SOURCES_PER_ORGANIZATION, type ManageDeps } from "./manage";
import { runSync } from "./sync";
import { FakeGitHub } from "./testing/fakeGitHub";

beforeEach(resetDatabase);

async function world(options: { token?: string; withSecrets?: boolean } = {}) {
  const github = new FakeGitHub();
  const repo = github.repo("acme", "docs", { private: Boolean(options.token), tokens: options.token ? [options.token] : [] });
  repo.commit({ "README.md": "# Home\n", "guides/a.md": "# A\n" });
  repo.commit({ "docs/index.md": "# Docs\n" }, { branch: "develop" });
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  const secrets = options.withSecrets === false ? null : new SecretBox(randomBytes(32));
  const deps: ManageDeps = { secrets, host: hostConfigFromEnv({}), fetch: github.fetch };
  const input = { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", rootDir: "", replaceExistingPages: false, createdById: null };
  return { github, repo, org, site: built.site, variant: built.variant, deps, input, secrets };
}

describe("connectSource", () => {
  it("connects a public repository on its default branch and queues the first sync", async () => {
    const w = await world();
    const result = await connectSource(w.deps, w.input);
    expect(result).toMatchObject({ ok: true, replaced: 0 });
    if (!result.ok) return;
    const source = await prisma.gitSource.findUniqueOrThrow({ where: { id: result.sourceId } });
    expect(source).toMatchObject({ owner: "acme", repo: "docs", branch: "main", rootDir: "", status: "IDLE", credentialId: null, pollIntervalSec: 300, deleteGraceDays: 14, variantId: w.variant.id });
    const run = await prisma.gitSyncRun.findFirstOrThrow();
    expect(run).toMatchObject({ sourceId: result.sourceId, trigger: "MANUAL", status: "PENDING" });
  });

  it("then syncs for real", async () => {
    const w = await world();
    const result = await connectSource(w.deps, { ...w.input, replaceExistingPages: true });
    if (!result.ok) throw new Error(result.error);
    const outcome = await runSync({ secrets: w.secrets, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, result.sourceId, { trigger: "MANUAL", runId: result.runId! });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(await prisma.page.count({ where: { managedBy: "GIT", deletedAt: null } })).toBe(3);
  });

  it("uses the branch and docs folder it is given", async () => {
    const w = await world();
    const result = await connectSource(w.deps, { ...w.input, branch: "develop", rootDir: "docs" });
    expect(result.ok).toBe(true);
    expect(await prisma.gitSource.findFirstOrThrow()).toMatchObject({ branch: "develop", rootDir: "docs" });
  });

  it("stores a token encrypted, and the repository needs it", async () => {
    const w = await world({ token: "ghp_privateToken123456" });
    const without = await connectSource(w.deps, w.input);
    expect(without).toMatchObject({ ok: false, field: "repository" });
    const result = await connectSource(w.deps, { ...w.input, token: "ghp_privateToken123456" });
    expect(result.ok).toBe(true);
    const credential = await prisma.gitCredential.findFirstOrThrow();
    expect(Buffer.from(credential.secretCiphertext!).toString("latin1")).not.toContain("privateToken");
    expect((await prisma.gitSource.findFirstOrThrow()).credentialId).toBe(credential.id);
  });

  it("says the token is wrong, against the token field, and saves nothing", async () => {
    const w = await world({ token: "ghp_privateToken123456" });
    w.github.validTokens.delete("ghp_privateToken123456");
    const result = await connectSource(w.deps, { ...w.input, token: "ghp_privateToken123456" });
    expect(result).toMatchObject({ ok: false, field: "token" });
    expect(await prisma.gitSource.count()).toBe(0);
    expect(await prisma.gitCredential.count()).toBe(0);
  });

  it("will not save a token when the server has no encryption key", async () => {
    const w = await world({ withSecrets: false });
    const result = await connectSource(w.deps, { ...w.input, token: "ghp_whateverToken123" });
    expect(result).toMatchObject({ ok: false, field: "token" });
    expect((result as { error: string }).error).toContain("GIT_SYNC_ENCRYPTION_KEY");
    expect(await prisma.gitSource.count()).toBe(0);
  });

  it("explains a repository, a branch or a docs folder that is not there", async () => {
    const w = await world();
    expect(await connectSource(w.deps, { ...w.input, repo: "nope" })).toMatchObject({ ok: false, field: "repository" });
    expect(await connectSource(w.deps, { ...w.input, branch: "ghost" })).toMatchObject({ ok: false });
    const dir = await connectSource(w.deps, { ...w.input, rootDir: "missing" });
    expect(dir).toMatchObject({ ok: false });
    expect((dir as { error: string }).error).toContain('"missing" does not exist');
    expect(await prisma.gitSource.count()).toBe(0);
  });

  it("refuses names that could change the request", async () => {
    const w = await world();
    for (const bad of [{ owner: "a/b" }, { owner: "../x" }, { repo: "docs?x" }, { repo: ".." }, { branch: "a b" }, { branch: "../x" }]) {
      expect(await connectSource(w.deps, { ...w.input, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(w.github.requests).toHaveLength(0);
  });

  it("will not take over a version that has pages unless told to, and then replaces them", async () => {
    const w = await world();
    await makePage({ variantId: w.variant.id, siteId: w.site.id, slug: "intro", title: "Introduction" });
    await makePage({ variantId: w.variant.id, siteId: w.site.id, slug: "other", title: "Other" });
    const refused = await connectSource(w.deps, w.input);
    expect(refused).toMatchObject({ ok: false, field: "replace" });
    expect((refused as { error: string }).error).toMatch(/2 pages.*Introduction/);
    expect(await prisma.page.count()).toBe(2);

    const replaced = await connectSource(w.deps, { ...w.input, replaceExistingPages: true });
    expect(replaced).toMatchObject({ ok: true, replaced: 2 });
    expect(await prisma.page.count()).toBe(0);
  });

  it("will not use a version from another site, or one that is already connected", async () => {
    const w = await world();
    const other = await makeSite({ organizationId: w.org.id });
    expect(await connectSource(w.deps, { ...w.input, variantId: other.variant.id })).toMatchObject({ ok: false, field: "variant" });
    expect((await connectSource(w.deps, w.input)).ok).toBe(true);
    expect(await connectSource(w.deps, w.input)).toMatchObject({ ok: false, field: "variant" });
  });

  it("limits how many repositories an organization connects", async () => {
    const w = await world();
    for (let i = 0; i < MAX_SOURCES_PER_ORGANIZATION; i++) {
      const built = await makeSite({ organizationId: w.org.id });
      await prisma.gitSource.create({ data: { organizationId: w.org.id, siteId: built.site.id, variantId: built.variant.id, owner: "a", repo: `r${i}`, branch: "main" } });
    }
    expect(await connectSource(w.deps, w.input)).toMatchObject({ ok: false });
  });

  it("clamps the polling interval and the grace period", async () => {
    const w = await world();
    await connectSource(w.deps, { ...w.input, pollIntervalSec: 1, deleteGraceDays: 9999 });
    expect(await prisma.gitSource.findFirstOrThrow()).toMatchObject({ pollIntervalSec: 60, deleteGraceDays: 90 });
  });
});

describe("updateSource", () => {
  async function connected(w: Awaited<ReturnType<typeof world>>, extra: Partial<Parameters<typeof connectSource>[1]> = {}) {
    const result = await connectSource(w.deps, { ...w.input, ...extra });
    if (!result.ok) throw new Error(result.error);
    await prisma.gitSyncRun.deleteMany();
    await prisma.gitSource.update({ where: { id: result.sourceId }, data: { lastSyncedSha: "abc", status: "IDLE" } });
    return result.sourceId;
  }

  it("changes how often and how long without a new sync", async () => {
    const w = await world();
    const id = await connected(w);
    expect(await updateSource(w.deps, id, { pollIntervalSec: 900, deleteGraceDays: 30 })).toMatchObject({ ok: true, resync: false });
    expect(await prisma.gitSource.findUniqueOrThrow({ where: { id } })).toMatchObject({ pollIntervalSec: 900, deleteGraceDays: 30, lastSyncedSha: "abc" });
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("starts a full sync when the branch or folder changes, after checking it exists", async () => {
    const w = await world();
    const id = await connected(w);
    expect(await updateSource(w.deps, id, { branch: "ghost" })).toMatchObject({ ok: false });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id } })).branch).toBe("main");

    expect(await updateSource(w.deps, id, { branch: "develop", rootDir: "docs" })).toMatchObject({ ok: true, resync: true });
    expect(await prisma.gitSource.findUniqueOrThrow({ where: { id } })).toMatchObject({ branch: "develop", rootDir: "docs", lastSyncedSha: null });
    expect(await prisma.gitSyncRun.findFirstOrThrow()).toMatchObject({ trigger: "FULL", status: "PENDING" });
  });

  it("replaces and removes a saved token", async () => {
    const w = await world({ token: "ghp_oldToken1234567" });
    const id = await connected(w, { token: "ghp_oldToken1234567" });
    const credentialId = (await prisma.gitSource.findUniqueOrThrow({ where: { id } })).credentialId!;
    w.github.validTokens.add("ghp_newToken1234567");
    w.github.repo("acme", "docs", { private: true, tokens: ["ghp_newToken1234567"] }).commit({ "README.md": "# Home\n" });

    expect(await updateSource(w.deps, id, { token: "ghp_newToken1234567" })).toMatchObject({ ok: true, resync: true });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id } })).credentialId).toBe(credentialId);
    const plain = w.secrets!.open((await prisma.gitCredential.findUniqueOrThrow({ where: { id: credentialId } })).secretCiphertext!, (await prisma.gitCredential.findUniqueOrThrow({ where: { id: credentialId } })).keyId, `git-credential:${credentialId}`);
    expect(plain).toBe("ghp_newToken1234567");

    // Removing the token from a private repository would cut it off, so that is refused before anything changes.
    const removal = await updateSource(w.deps, id, { token: null });
    expect(removal).toMatchObject({ ok: false });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id } })).credentialId).toBe(credentialId);
  });

  it("refuses a rejected token without changing anything", async () => {
    const w = await world({ token: "ghp_goodToken1234567" });
    const id = await connected(w, { token: "ghp_goodToken1234567" });
    const result = await updateSource(w.deps, id, { token: "ghp_bogusToken123456" });
    expect(result).toMatchObject({ ok: false, field: "token" });
    expect(await prisma.gitCredential.count()).toBe(1);
  });
});

describe("disconnectSource", () => {
  async function synced() {
    const w = await world();
    const result = await connectSource(w.deps, { ...w.input, replaceExistingPages: true });
    if (!result.ok) throw new Error(result.error);
    await runSync({ secrets: w.secrets, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, result.sourceId, { trigger: "MANUAL", runId: result.runId! });
    return { w, sourceId: result.sourceId };
  }

  it("can keep the pages as ordinary, editable pages", async () => {
    const { w, sourceId } = await synced();
    const result = await disconnectSource(sourceId, "keep-pages");
    expect(result).toMatchObject({ ok: true, pages: 3 });
    expect(await prisma.gitSource.count()).toBe(0);
    const pages = await prisma.page.findMany();
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.managedBy === "EDITOR" && p.sourceId === null && p.sourcePath === null)).toBe(true);
    // And the editor can add to the version again.
    await makePage({ variantId: w.variant.id, siteId: w.site.id, slug: "new" });
  });

  it("can delete the pages with the connection", async () => {
    const { sourceId } = await synced();
    expect(await disconnectSource(sourceId, "delete-pages")).toMatchObject({ ok: true, pages: 3 });
    expect(await prisma.page.count()).toBe(0);
  });

  it("drops pages that were already waiting to be removed, and the credential nobody uses", async () => {
    const w = await world({ token: "ghp_privateToken123456" });
    const result = await connectSource(w.deps, { ...w.input, token: "ghp_privateToken123456", replaceExistingPages: true });
    if (!result.ok) throw new Error(result.error);
    await runSync({ secrets: w.secrets, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, result.sourceId, { trigger: "MANUAL", runId: result.runId! });
    w.repo.commit({ "guides/a.md": null });
    await runSync({ secrets: w.secrets, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, result.sourceId, { trigger: "MANUAL" });
    // The file, and the folder that had nothing else in it.
    expect(await prisma.page.count({ where: { deletedAt: { not: null } } })).toBe(2);

    await disconnectSource(result.sourceId, "keep-pages");
    expect(await prisma.page.count({ where: { deletedAt: { not: null } } })).toBe(0);
    expect(await prisma.gitCredential.count()).toBe(0);
  });

  it("reports a source that is already gone", async () => {
    expect(await disconnectSource("nope", "keep-pages")).toMatchObject({ ok: false });
  });
});

describe("requestSync and setPaused", () => {
  it("queues one run however often it is asked, and a full one wins", async () => {
    const w = await world();
    const r = await connectSource(w.deps, w.input);
    if (!r.ok) throw new Error(r.error);
    await prisma.gitSyncRun.deleteMany();
    const first = await requestSync(r.sourceId, false);
    const second = await requestSync(r.sourceId, true);
    expect(first).toMatchObject({ ok: true, merged: false });
    expect(second).toMatchObject({ ok: true, merged: true });
    expect(await prisma.gitSyncRun.findMany()).toHaveLength(1);
    expect((await prisma.gitSyncRun.findFirstOrThrow()).trigger).toBe("FULL");
  });

  it("pauses and resumes, and a finishing run does not undo a pause", async () => {
    const w = await world();
    const r = await connectSource(w.deps, { ...w.input, replaceExistingPages: true });
    if (!r.ok) throw new Error(r.error);
    expect(await setPaused(r.sourceId, true)).toMatchObject({ ok: true });
    expect(await setPaused(r.sourceId, true)).toMatchObject({ ok: false });
    await runSync({ secrets: w.secrets, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, r.sourceId, { trigger: "MANUAL", runId: r.runId! });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: r.sourceId } })).status).toBe("PAUSED");
    expect(await setPaused(r.sourceId, false)).toMatchObject({ ok: true });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: r.sourceId } })).status).toBe("IDLE");
  });
});
