import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { buildNavigation, emptyFrontMatter, type Block, type FrontMatter, type NavNode } from "@gitcrook/markdown";
import { makeOrg, makePage, makeSite, resetDatabase } from "../../../tests/support/factory";
import { applyTree, ForeignPagesError, type PageWrite } from "./apply";
import type { Move } from "./plan";

beforeEach(resetDatabase);

async function fixture() {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  const source = await prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main" } });
  return { org, site: built.site, variant: built.variant, source };
}

type FileSpec = { fm?: Partial<FrontMatter>; title?: string; text?: string; sha?: string };
const paragraph = (text: string): Block => ({ id: `b-${text}`, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });

/** A tree and the writes for it, as the sync engine would produce them from these files. */
function treeOf(files: Record<string, FileSpec>) {
  const result = buildNavigation({ files: Object.entries(files).map(([path, f]) => ({ path, frontMatter: { ...emptyFrontMatter(), ...f.fm }, title: f.title ?? null })) });
  const writes = new Map<string, PageWrite>();
  for (const [path, f] of Object.entries(files)) {
    const text = f.text ?? `text of ${path}`;
    writes.set(path, { blocks: [paragraph(text)], contentText: text, blobSha: f.sha ?? `sha-${text}`, meta: null });
  }
  return { tree: result.nodes, writes, diagnostics: result.diagnostics };
}

async function apply(
  ctx: Awaited<ReturnType<typeof fixture>>,
  files: Record<string, FileSpec>,
  options: { moves?: Move[]; commit?: string; only?: string[]; prefix?: string[] } = {},
) {
  const { tree, writes } = treeOf(files);
  const subset = options.only ? new Map([...writes].filter(([k]) => options.only!.includes(k))) : writes;
  return prisma.$transaction((tx) => applyTree(tx, { source: ctx.source, tree, writes: subset, moves: options.moves ?? [], commitSha: options.commit ?? "c1", prefix: options.prefix ?? [], now: new Date() }), { timeout: 60_000 });
}

const live = () => prisma.page.findMany({ where: { deletedAt: null }, orderBy: [{ parentId: "asc" }, { order: "asc" }] });
const bySourcePath = async () => Object.fromEntries((await prisma.page.findMany()).map((p) => [p.sourcePath, p]));

describe("the first apply", () => {
  it("creates the tree: groups, pages, order, parents and ownership", async () => {
    const ctx = await fixture();
    const stats = await apply(ctx, { "README.md": { title: "Welcome" }, "guides/install.md": { title: "Install" }, "guides/configure.md": { title: "Configure" }, "reference/cli.md": { title: "CLI" } });
    expect(stats).toMatchObject({ added: 6, updated: 0, deleted: 0, moved: 0 });

    const pages = await bySourcePath();
    expect(pages["group:guides"] ?? pages["dir:guides"]).toMatchObject({ isGroup: true, title: "Guides", parentId: null });
    const guides = pages["dir:guides"]!;
    expect(pages["guides/configure.md"]).toMatchObject({ parentId: guides.id, slug: "configure", order: 0, title: "Configure", managedBy: "GIT", sourceId: ctx.source.id, isGroup: false });
    expect(pages["guides/install.md"]).toMatchObject({ parentId: guides.id, slug: "install", order: 1 });
    expect(pages["README.md"]).toMatchObject({ parentId: null, order: 0, slug: "welcome", variantId: ctx.variant.id, siteId: ctx.site.id });
    expect(pages["guides/install.md"]!.contentText).toBe("text of guides/install.md");
    expect(pages["guides/install.md"]!.sourceBlobSha).toBe("sha-text of guides/install.md");
  });

  it("records where each version came from", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {} }, { commit: "abc123" });
    const versions = await prisma.pageVersion.findMany();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ origin: "GIT", commitSha: "abc123", version: 1 });
  });

  it("stores group pages with no content and generated pages with what they were given", async () => {
    const ctx = await fixture();
    const { tree } = treeOf({ "a/b/c.md": {} });
    const generatedKey = tree[0]!.children[0]!.key;
    const writes = new Map<string, PageWrite>([[generatedKey, { blocks: [paragraph("generated")], contentText: "generated", blobSha: null, meta: null }]]);
    await prisma.$transaction((tx) => applyTree(tx, { source: ctx.source, tree, writes, moves: [], commitSha: "c", prefix: [], now: new Date() }));
    const pages = await bySourcePath();
    expect(pages["dir:a"]).toMatchObject({ isGroup: true, content: [] });
    expect(pages["dir:a/b"]).toMatchObject({ isGroup: false, contentText: "generated" });
    expect(pages["a/b/c.md"]!.content).toEqual([]);
  });
});

describe("applying the same tree again", () => {
  it("changes nothing and writes no history", async () => {
    const ctx = await fixture();
    const files = { "a.md": {}, "g/b.md": {} };
    await apply(ctx, files);
    const before = await prisma.page.findMany({ orderBy: { id: "asc" } });
    const stats = await apply(ctx, files, { commit: "c2" });
    expect(stats).toMatchObject({ added: 0, updated: 0, moved: 0, deleted: 0, unchanged: 3 });
    expect(await prisma.page.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.pageVersion.count()).toBe(2);
  });

  it("writes a new version only for content that changed", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { text: "one" }, "b.md": { text: "two" } });
    const stats = await apply(ctx, { "a.md": { text: "one edited", sha: "new" }, "b.md": { text: "two" } }, { commit: "c2" });
    expect(stats).toMatchObject({ updated: 1, unchanged: 1 });
    const pages = await bySourcePath();
    expect(pages["a.md"]).toMatchObject({ contentVersion: 2, contentText: "one edited", sourceBlobSha: "new" });
    expect(pages["b.md"]).toMatchObject({ contentVersion: 1 });
    const versions = await prisma.pageVersion.findMany({ where: { pageId: pages["a.md"]!.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.commitSha])).toEqual([[1, "c1"], [2, "c2"]]);
  });

  it("leaves content alone for pages that were not rewritten", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { text: "keep" }, "b.md": {} });
    await apply(ctx, { "a.md": { text: "ignored" }, "b.md": {} }, { only: ["b.md"] });
    expect((await bySourcePath())["a.md"]!.contentText).toBe("keep");
  });
});

describe("moves", () => {
  it("keep the row, its id and its history, and leave a redirect behind", async () => {
    const ctx = await fixture();
    await apply(ctx, { "old/page.md": { title: "Page" }, "other.md": {} });
    const before = (await bySourcePath())["old/page.md"]!;

    const stats = await apply(ctx, { "new/page.md": { title: "Page", sha: before.sourceBlobSha!, text: "text of old/page.md" }, "other.md": {} }, { moves: [{ from: "old/page.md", to: "new/page.md", by: "content" }], commit: "c2" });
    expect(stats.moved).toBe(1);

    const after = (await bySourcePath())["new/page.md"]!;
    expect(after.id).toBe(before.id);
    expect(after.slug).toBe("page");
    expect(after.parentId).not.toBe(before.parentId);
    expect(after.contentVersion).toBe(1); // same content: nothing was rewritten

    const redirects = await prisma.siteRedirect.findMany();
    expect(redirects).toMatchObject([{ fromPath: "old/page", toPath: "new/page", sourceId: ctx.source.id, origin: "MOVE" }]);
    expect(await prisma.page.count({ where: { sourcePath: "old/page.md" } })).toBe(0);
  });

  it("redirect every page below a renamed folder", async () => {
    const ctx = await fixture();
    await apply(ctx, { "guides/a.md": {}, "guides/b.md": {} });
    await apply(ctx, { "manual/a.md": { text: "text of guides/a.md" }, "manual/b.md": { text: "text of guides/b.md" } }, { moves: [{ from: "guides/a.md", to: "manual/a.md", by: "content" }, { from: "guides/b.md", to: "manual/b.md", by: "content" }] });
    const redirects = await prisma.siteRedirect.findMany({ orderBy: { fromPath: "asc" } });
    // The folder itself is a header with no page of its own, so only the pages are redirected.
    expect(redirects.map((r) => [r.fromPath, r.toPath])).toEqual([
      ["guides/a", "manual/a"],
      ["guides/b", "manual/b"],
    ]);
  });

  it("put the section, space and variant prefix in front of redirects", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {} }, { prefix: ["~v", "next"] });
    await apply(ctx, { "b.md": { text: "text of a.md" } }, { prefix: ["~v", "next"], moves: [{ from: "a.md", to: "b.md", by: "content" }] });
    expect((await prisma.siteRedirect.findMany()).map((r) => [r.fromPath, r.toPath])).toEqual([["~v/next/a", "~v/next/b"]]);
  });

  it("follow a page that moves twice: the old redirect points at the latest address", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {} });
    await apply(ctx, { "b.md": { text: "text of a.md" } }, { moves: [{ from: "a.md", to: "b.md", by: "content" }] });
    await apply(ctx, { "c.md": { text: "text of a.md" } }, { moves: [{ from: "b.md", to: "c.md", by: "content" }] });
    const redirects = (await prisma.siteRedirect.findMany({ orderBy: { fromPath: "asc" } })).map((r) => [r.fromPath, r.toPath]);
    expect(redirects).toEqual([["a", "c"], ["b", "c"]]);
  });

  it("drop a redirect when its old address becomes a page again", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {} });
    await apply(ctx, { "b.md": { text: "text of a.md" } }, { moves: [{ from: "a.md", to: "b.md", by: "content" }] });
    expect(await prisma.siteRedirect.count()).toBe(1);
    await apply(ctx, { "b.md": { text: "text of a.md" }, "a.md": { text: "a new a" } });
    expect(await prisma.siteRedirect.count()).toBe(0);
  });

  it("do not overwrite a redirect someone made by hand", async () => {
    const ctx = await fixture();
    await prisma.siteRedirect.create({ data: { siteId: ctx.site.id, fromPath: "a", toPath: "somewhere-else" } });
    await apply(ctx, { "a.md": {} });
    await apply(ctx, { "b.md": { text: "text of a.md" } }, { moves: [{ from: "a.md", to: "b.md", by: "content" }] });
    const r = await prisma.siteRedirect.findUnique({ where: { siteId_fromPath: { siteId: ctx.site.id, fromPath: "a" } } });
    expect(r).toMatchObject({ toPath: "somewhere-else", sourceId: null });
  });
});

describe("slugs", () => {
  it("can swap between two pages without tripping the unique index", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { slug: "x" } }, "b.md": { fm: { slug: "y" } } });
    await apply(ctx, { "a.md": { fm: { slug: "y" } }, "b.md": { fm: { slug: "x" } } });
    const pages = await bySourcePath();
    expect([pages["a.md"]!.slug, pages["b.md"]!.slug]).toEqual(["y", "x"]);
  });

  it("can rotate through three and move between parents", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { slug: "p" } }, "b.md": { fm: { slug: "q" } }, "c.md": { fm: { slug: "r" } }, "g/d.md": { fm: { slug: "p" } } });
    await apply(ctx, { "a.md": { fm: { slug: "q" } }, "b.md": { fm: { slug: "r" } }, "c.md": { fm: { slug: "p" } }, "d.md": { fm: { slug: "z" }, text: "text of g/d.md" } }, { moves: [{ from: "g/d.md", to: "d.md", by: "content" }] });
    const pages = await bySourcePath();
    expect(["a.md", "b.md", "c.md", "d.md"].map((k) => pages[k]!.slug)).toEqual(["q", "r", "p", "z"]);
  });
});

describe("pages whose file is gone", () => {
  it("are soft-deleted: kept, hidden from readers, and no longer holding their URL", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {}, "b.md": {} });
    const stats = await apply(ctx, { "a.md": {} });
    expect(stats.deleted).toBe(1);
    const gone = (await bySourcePath())["b.md"]!;
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.isDraft).toBe(true);
    expect(await prisma.page.count({ where: { deletedAt: null } })).toBe(1);
    // The URL is free for a new page.
    await makePage({ variantId: ctx.variant.id, siteId: ctx.site.id, slug: "b" }).catch(() => {
      throw new Error("a deleted page still held its URL");
    });
  });

  it("come back, with their history, when the file does", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {}, "b.md": {} });
    const id = (await bySourcePath())["b.md"]!.id;
    await apply(ctx, { "a.md": {} });
    const stats = await apply(ctx, { "a.md": {}, "b.md": {} });
    expect(stats.revived).toBe(1);
    const back = (await bySourcePath())["b.md"]!;
    expect(back).toMatchObject({ id, deletedAt: null, isDraft: false });
  });

  it("do not stop a returning page being written, even when its URL was taken meanwhile", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": {}, "b.md": {} });
    await apply(ctx, { "a.md": {} });
    // The same address, now with a different file.
    await apply(ctx, { "a.md": {}, "other/b.md": { fm: { slug: "b" } } });
    const stats = await apply(ctx, { "a.md": {}, "b.md": {}, "other/b.md": { fm: { slug: "b" } } });
    expect(stats.revived).toBe(1);
    const siblings = (await live()).map((p) => `${p.parentId}/${p.slug}`);
    expect(new Set(siblings).size).toBe(siblings.length);
    expect(siblings).toHaveLength(4);
  });

  it("take their children with them", async () => {
    const ctx = await fixture();
    await apply(ctx, { "g/a.md": {}, "g/b.md": {}, "keep.md": {} });
    await apply(ctx, { "keep.md": {} });
    expect((await live()).map((p) => p.sourcePath)).toEqual(["keep.md"]);
  });
});

describe("redirect_from", () => {
  it("makes redirects to the page, and removes them when the front matter does", async () => {
    const ctx = await fixture();
    await apply(ctx, { "guides/install.md": { fm: { redirect_from: ["old/setup", "/legacy/install/"] } } });
    const first = await prisma.siteRedirect.findMany({ orderBy: { fromPath: "asc" } });
    expect(first.map((r) => [r.fromPath, r.toPath, r.origin])).toEqual([
      ["legacy/install", "guides/install", "FRONT_MATTER"],
      ["old/setup", "guides/install", "FRONT_MATTER"],
    ]);
    await apply(ctx, { "guides/install.md": { fm: { redirect_from: ["old/setup"] } } });
    expect((await prisma.siteRedirect.findMany()).map((r) => r.fromPath)).toEqual(["old/setup"]);
    await apply(ctx, { "guides/install.md": {} });
    expect(await prisma.siteRedirect.count()).toBe(0);
  });

  it("follows the page when it moves", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { redirect_from: ["old"] } } });
    await apply(ctx, { "b.md": { fm: { redirect_from: ["old"] }, text: "text of a.md" } }, { moves: [{ from: "a.md", to: "b.md", by: "content" }] });
    const redirects = await prisma.siteRedirect.findMany({ orderBy: { fromPath: "asc" } });
    expect(redirects.map((r) => [r.fromPath, r.toPath])).toEqual([["a", "b"], ["old", "b"]]);
  });

  it("ignores entries that are not usable paths, and ones that name a real page", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { redirect_from: ["../escape", "", "b", "a"] } }, "b.md": {} });
    expect(await prisma.siteRedirect.count()).toBe(0);
  });

  it("does not create one for a draft page", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { draft: true, redirect_from: ["old"] } } });
    expect(await prisma.siteRedirect.count()).toBe(0);
  });
});

describe("page flags", () => {
  it("carries draft, hidden, icon, description and front-matter id", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { fm: { draft: true, hidden: true, icon: "rocket", description: "About", id: "stable-1" } } });
    expect((await bySourcePath())["a.md"]).toMatchObject({ isDraft: true, isHidden: true, icon: "rocket", description: "About", frontMatterId: "stable-1" });
    await apply(ctx, { "a.md": {} });
    expect((await bySourcePath())["a.md"]).toMatchObject({ isDraft: false, isHidden: false, icon: null, description: null, frontMatterId: null });
  });
});

describe("pages someone else manages", () => {
  it("stop the apply, changing nothing", async () => {
    const ctx = await fixture();
    await makePage({ variantId: ctx.variant.id, siteId: ctx.site.id, slug: "handmade" });
    const error = await apply(ctx, { "a.md": {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ForeignPagesError);
    expect(error.code).toBe("GS-304");
    expect(await prisma.page.count()).toBe(1);
  });

  it("do not include editor pages in another variant", async () => {
    const ctx = await fixture();
    const other = await prisma.variant.create({ data: { spaceId: ctx.variant.spaceId, name: "v2", slug: "v2", order: 1 } });
    await makePage({ variantId: other.id, siteId: ctx.site.id, slug: "elsewhere" });
    await expect(apply(ctx, { "a.md": {} })).resolves.toMatchObject({ added: 1 });
  });
});

describe("atomicity", () => {
  it("leaves the site exactly as it was when the apply fails part-way", async () => {
    const ctx = await fixture();
    await apply(ctx, { "a.md": { text: "one" }, "b.md": {} });
    const before = JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }));
    const { tree, writes } = treeOf({ "a.md": { text: "changed", sha: "x" }, "c.md": {} });
    const failing = new Map(writes);
    failing.set("c.md", { ...writes.get("c.md")!, blocks: undefined as never });
    await expect(prisma.$transaction((tx) => applyTree(tx, { source: ctx.source, tree, writes: failing, moves: [], commitSha: "c2", prefix: [], now: new Date() }))).rejects.toBeDefined();
    expect(JSON.stringify(await prisma.page.findMany({ orderBy: { id: "asc" } }))).toBe(before);
  });
});

describe("a large tree", () => {
  it("applies hundreds of pages in one transaction", async () => {
    const ctx = await fixture();
    const files: Record<string, FileSpec> = {};
    for (let g = 0; g < 10; g++) for (let p = 0; p < 40; p++) files[`group${g}/page${p}.md`] = {};
    const started = Date.now();
    const stats = await apply(ctx, files);
    expect(stats.added).toBe(410);
    expect(Date.now() - started).toBeLessThan(30_000);
    const again = await apply(ctx, files);
    expect(again.unchanged).toBe(410);
  }, 60_000);
});

// Silence "unused" for a type used only in signatures above.
export type { NavNode };
