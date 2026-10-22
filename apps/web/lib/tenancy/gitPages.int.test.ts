import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, resetDatabase } from "../../../../tests/support/factory";
import { anyPageIsManaged, variantIsManaged } from "../pages/managed";
import { flattenNavigablePages, getPageTree } from "./getPageTree";
import { resolvePublishedPath } from "./resolvePublishedPath";
import type { ResolvedSite } from "./resolveSite";
import { loadShellStructure } from "./siteStructure";

beforeEach(resetDatabase);

async function build() {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  return { org, ...built, resolved: built.site as unknown as ResolvedSite };
}
const tree = async (variantId: string) => flattenNavigablePages(await getPageTree(variantId)).map((n) => n.slug);

describe("pages that come from a repository, as readers see them", () => {
  it("leave a hidden page out of the navigation but still serve it", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "visible", order: 0 });
    const hidden = await makePage({ variantId: variant.id, siteId: site.id, slug: "secret-url", order: 1 });
    await prisma.page.update({ where: { id: hidden.id }, data: { isHidden: true } });

    expect(await tree(variant.id)).toEqual(["visible"]);
    const shell = await loadShellStructure(site.id);
    const slugsInShell = shell.flatMap((s) => s.spaces.flatMap((sp) => sp.variants.flatMap((v) => v.tree.map((n) => n.slug))));
    expect(slugsInShell).toEqual(["visible"]);
    expect((await resolvePublishedPath(resolved, ["secret-url"]))?.page.id).toBe(hidden.id);
  });

  it("leave everything below a hidden page out of the navigation too, and still serve it", async () => {
    const { site, variant, resolved } = await build();
    const parent = await makePage({ variantId: variant.id, siteId: site.id, slug: "hidden-parent", order: 0 });
    const child = await makePage({ variantId: variant.id, siteId: site.id, slug: "child", parentId: parent.id });
    await prisma.page.update({ where: { id: parent.id }, data: { isHidden: true } });
    expect(await tree(variant.id)).toEqual([]);
    expect((await resolvePublishedPath(resolved, ["hidden-parent", "child"]))?.page.id).toBe(child.id);
  });

  it("never serve, list or find a page whose file was deleted", async () => {
    const { site, variant, resolved } = await build();
    const gone = await makePage({ variantId: variant.id, siteId: site.id, slug: "removed", order: 0 });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "stays", order: 1 });
    // Exactly what a sync does to a page whose file left the repository.
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: new Date(), isDraft: true } });
    expect(await tree(variant.id)).toEqual(["stays"]);
    expect(await resolvePublishedPath(resolved, ["removed"])).toBeNull();
    expect((await resolvePublishedPath(resolved, []))?.page.slug).toBe("stays");
  });

  it("stay hidden even if only deletedAt is set", async () => {
    const { site, variant, resolved } = await build();
    const gone = await makePage({ variantId: variant.id, siteId: site.id, slug: "removed" });
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    expect(await tree(variant.id)).toEqual([]);
    expect(await resolvePublishedPath(resolved, ["removed"])).toBeNull();
  });
});

describe("the guards that keep managed pages read-only", () => {
  it("know which variants and pages a repository manages", async () => {
    const { org, site, variant } = await build();
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "p" });
    const editable = await makePage({ variantId: variant.id, siteId: site.id, slug: "q" });
    expect(await variantIsManaged(variant.id)).toBe(false);
    expect(await anyPageIsManaged([page.id, editable.id])).toBe(false);

    const source = await prisma.gitSource.create({ data: { organizationId: org.id, siteId: site.id, variantId: variant.id, owner: "a", repo: "b", branch: "main" } });
    await prisma.page.update({ where: { id: page.id }, data: { managedBy: "GIT", sourceId: source.id, sourcePath: "p.md" } });
    expect(await variantIsManaged(variant.id)).toBe(true);
    expect(await anyPageIsManaged([page.id])).toBe(true);
    expect(await anyPageIsManaged([editable.id])).toBe(false);
    expect(await anyPageIsManaged([editable.id, page.id])).toBe(true);
    expect(await anyPageIsManaged([])).toBe(false);
  });
});
