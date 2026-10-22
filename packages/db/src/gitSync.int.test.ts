import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index";
import { makeOrg, makePage, makeSite, makeUser, resetDatabase } from "../../../tests/support/factory";

beforeEach(resetDatabase);

async function fixture() {
  const user = await makeUser();
  const org = await makeOrg([{ user, role: "ADMIN" }]);
  const built = await makeSite({ organizationId: org.id });
  const source = await prisma.gitSource.create({
    data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main", createdById: user.id },
  });
  return { user, org, site: built.site, variant: built.variant, source };
}

const code = (error: unknown) => (error as { code?: string; cause?: { originalCode?: string } })?.code ?? (error as { cause?: { originalCode?: string } })?.cause?.originalCode;
const isUnique = (error: unknown) => code(error) === "P2002" || code(error) === "23505";

describe("a page that left the repository", () => {
  it("does not hold its URL: a new page may take the slug", async () => {
    const { site, variant, source } = await fixture();
    const old = await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    await prisma.page.update({ where: { id: old.id }, data: { sourceId: source.id, sourcePath: "intro.md", managedBy: "GIT", deletedAt: new Date(), isDraft: true } });

    await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    expect(await prisma.page.count({ where: { slug: "intro" } })).toBe(2);
  });

  it("does the same under a parent", async () => {
    const { site, variant } = await fixture();
    const parent = await makePage({ variantId: variant.id, siteId: site.id, slug: "group", isGroup: true });
    const old = await makePage({ variantId: variant.id, siteId: site.id, slug: "child", parentId: parent.id });
    await prisma.page.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "child", parentId: parent.id });
    expect(await prisma.page.count({ where: { slug: "child" } })).toBe(2);
  });

  it("cannot come back while a live page has its slug", async () => {
    const { site, variant } = await fixture();
    const old = await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    await prisma.page.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    const error = await prisma.page.update({ where: { id: old.id }, data: { deletedAt: null } }).catch((e) => e);
    expect(isUnique(error)).toBe(true);
  });

  it("still blocks two live pages with one slug", async () => {
    const { site, variant } = await fixture();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    expect(isUnique(await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" }).catch((e) => e))).toBe(true);
  });
});

describe("a source", () => {
  it("manages one variant, once", async () => {
    const { org, site, variant } = await fixture();
    const error = await prisma.gitSource.create({ data: { organizationId: org.id, siteId: site.id, variantId: variant.id, owner: "a", repo: "b", branch: "main" } }).catch((e) => e);
    expect(isUnique(error)).toBe(true);
  });

  it("has the defaults the sync relies on", async () => {
    const { source } = await fixture();
    expect(source).toMatchObject({ provider: "GITHUB", status: "IDLE", rootDir: "", pollIntervalSec: 300, deleteGraceDays: 14, lastSyncedSha: null, credentialId: null });
  });

  it("identifies a page by its path, once per source", async () => {
    const { site, variant, source } = await fixture();
    const a = await makePage({ variantId: variant.id, siteId: site.id, slug: "a" });
    const b = await makePage({ variantId: variant.id, siteId: site.id, slug: "b" });
    await prisma.page.update({ where: { id: a.id }, data: { sourceId: source.id, sourcePath: "docs/a.md" } });
    const error = await prisma.page.update({ where: { id: b.id }, data: { sourceId: source.id, sourcePath: "docs/a.md" } }).catch((e) => e);
    expect(isUnique(error)).toBe(true);
  });

  it("lets many editor-managed pages have no path", async () => {
    const { site, variant } = await fixture();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "a" });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "b" });
    expect(await prisma.page.count({ where: { sourceId: null, sourcePath: null, managedBy: "EDITOR" } })).toBe(2);
  });

  it("leaves its pages behind, no longer managed by it, when it is removed", async () => {
    const { site, variant, source } = await fixture();
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "a" });
    await prisma.page.update({ where: { id: page.id }, data: { sourceId: source.id, sourcePath: "a.md", managedBy: "GIT" } });
    await prisma.gitSource.delete({ where: { id: source.id } });
    expect(await prisma.page.findUnique({ where: { id: page.id }, select: { sourceId: true, sourcePath: true } })).toEqual({ sourceId: null, sourcePath: "a.md" });
  });

  it("goes with its variant and its runs go with it", async () => {
    const { variant, source } = await fixture();
    await prisma.gitSyncRun.create({ data: { sourceId: source.id, trigger: "MANUAL", toSha: "abc" } });
    await prisma.variant.delete({ where: { id: variant.id } });
    expect(await prisma.gitSource.count()).toBe(0);
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("keeps its credential's removal from breaking it", async () => {
    const { org, source } = await fixture();
    const credential = await prisma.gitCredential.create({ data: { organizationId: org.id, kind: "TOKEN", keyId: "abcd1234", secretCiphertext: Buffer.from("x") } });
    await prisma.gitSource.update({ where: { id: source.id }, data: { credentialId: credential.id } });
    await prisma.gitCredential.delete({ where: { id: credential.id } });
    expect((await prisma.gitSource.findUnique({ where: { id: source.id } }))!.credentialId).toBeNull();
  });
});

describe("runs", () => {
  it("record one delivery once", async () => {
    const { source } = await fixture();
    await prisma.gitSyncRun.create({ data: { sourceId: source.id, trigger: "WEBHOOK", deliveryId: "d-1", toSha: "abc" } });
    const error = await prisma.gitSyncRun.create({ data: { sourceId: source.id, trigger: "WEBHOOK", deliveryId: "d-1", toSha: "abc" } }).catch((e) => e);
    expect(isUnique(error)).toBe(true);
  });

  it("allow any number without a delivery id", async () => {
    const { source } = await fixture();
    for (let i = 0; i < 3; i++) await prisma.gitSyncRun.create({ data: { sourceId: source.id, trigger: "POLL", toSha: `sha${i}` } });
    expect(await prisma.gitSyncRun.count()).toBe(3);
  });

  it("start pending", async () => {
    const { source } = await fixture();
    const run = await prisma.gitSyncRun.create({ data: { sourceId: source.id, trigger: "MANUAL", toSha: "abc" } });
    expect(run.status).toBe("PENDING");
  });
});

describe("assets from a repository", () => {
  it("are identified by path, once per source", async () => {
    const { org, site, source } = await fixture();
    const data = { organizationId: org.id, siteId: site.id, kind: "IMAGE" as const, storageKey: "k", mimeType: "image/png", sizeBytes: 1, checksumSha256: "x", sourceId: source.id, sourcePath: "img/a.png", sourceBlobSha: "sha" };
    await prisma.asset.create({ data });
    expect(isUnique(await prisma.asset.create({ data: { ...data, storageKey: "k2" } }).catch((e) => e))).toBe(true);
  });
});

describe("page versions", () => {
  it("say where they came from", async () => {
    const { site, variant } = await fixture();
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "a" });
    const editor = await prisma.pageVersion.create({ data: { pageId: page.id, content: [], version: 1 } });
    const git = await prisma.pageVersion.create({ data: { pageId: page.id, content: [], version: 2, origin: "GIT", commitSha: "0123abc" } });
    expect([editor.origin, editor.commitSha, git.origin, git.commitSha]).toEqual(["EDITOR", null, "GIT", "0123abc"]);
  });
});
