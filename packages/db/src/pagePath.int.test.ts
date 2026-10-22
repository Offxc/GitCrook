import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchStructure } from "@gitcrook/shared";
import { makeOrg, makePage, makeSite, resetDatabase, type StructureSpec } from "../../../tests/support/factory";
import { computePagePath, computePagePaths } from "./pagePath";
import { prisma } from "./client";

beforeEach(resetDatabase);

async function siteWith(structure?: StructureSpec) {
  const org = await makeOrg();
  return makeSite({ organizationId: org.id, structure });
}

describe("computePagePath", () => {
  it("is just the slug chain on a plain site", async () => {
    const { site, variant } = await siteWith();
    const group = await makePage({ variantId: variant.id, siteId: site.id, slug: "guides", isGroup: true });
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "install", parentId: group.id });
    expect(await computePagePath(page.id)).toEqual(["guides", "install"]);
    expect(await computePagePath(group.id)).toEqual(["guides"]);
  });

  it("walks arbitrarily deep chains", async () => {
    const { site, variant } = await siteWith();
    let parentId: string | null = null;
    let last = "";
    for (const slug of ["a", "b", "c", "d", "e"]) {
      const page: { id: string } = await makePage({ variantId: variant.id, siteId: site.id, slug, parentId });
      parentId = page.id;
      last = page.id;
    }
    expect(await computePagePath(last)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is null for a page that does not exist", async () => {
    expect(await computePagePath("missing")).toBeNull();
  });

  it("adds section, space and ~v segments only where the site needs them", async () => {
    const structure: StructureSpec = [
      {
        slug: "guides",
        spaces: [
          { slug: "alpha", variants: [{ slug: "latest", isDefault: true }, { slug: "legacy" }] },
          { slug: "beta", variants: [{ slug: "main", isDefault: true }] },
        ],
      },
      { slug: "api", spaces: [{ slug: "ref", variants: [{ slug: "main", isDefault: true }] }] },
    ];
    const { site, variants } = await siteWith(structure);
    const byKey = Object.fromEntries(variants.map((v) => [`${v.sectionId}/${v.spaceId}/${v.slug}`, v]));
    const [latest, legacy, beta, apiMain] = variants;
    expect(latest!.slug).toBe("latest");

    const pages = [];
    for (const v of [latest!, legacy!, beta!, apiMain!]) pages.push(await makePage({ variantId: v.id, siteId: site.id, slug: "intro" }));
    void byKey;

    expect(await computePagePath(pages[0]!.id)).toEqual(["guides", "alpha", "intro"]);
    expect(await computePagePath(pages[1]!.id)).toEqual(["guides", "alpha", "~v", "legacy", "intro"]);
    expect(await computePagePath(pages[2]!.id)).toEqual(["guides", "beta", "intro"]);
    // Two sections, but the second has a single space: only the section is spelled out.
    expect(await computePagePath(pages[3]!.id)).toEqual(["api", "intro"]);
  });

  it("every computed path resolves back to the same variant and slugs", async () => {
    const structure: StructureSpec = [
      { slug: "one", spaces: [{ slug: "a", variants: [{ slug: "v1", isDefault: true }, { slug: "v2" }] }, { slug: "b", variants: [{ slug: "v1", isDefault: true }] }] },
      { slug: "two", spaces: [{ slug: "a", variants: [{ slug: "v1", isDefault: false }, { slug: "v2", isDefault: true }] }] },
    ];
    const { site, variants } = await siteWith(structure);
    const pageIds: Record<string, string> = {};
    for (const v of variants) {
      const parent = await makePage({ variantId: v.id, siteId: site.id, slug: "top" });
      const child = await makePage({ variantId: v.id, siteId: site.id, slug: "child", parentId: parent.id });
      pageIds[v.id] = child.id;
    }

    const sections = await prisma.section.findMany({ where: { siteId: site.id }, orderBy: { order: "asc" }, include: { spaces: { orderBy: { order: "asc" }, include: { variants: { orderBy: { order: "asc" } } } } } });
    const paths = await computePagePaths(Object.values(pageIds));
    expect(paths.size).toBe(variants.length);
    for (const v of variants) {
      const path = paths.get(pageIds[v.id]!)!;
      const match = matchStructure(sections, path);
      expect(match?.variant.id, path.join("/")).toBe(v.id);
      expect(match?.rest).toEqual(["top", "child"]);
    }
  });
});

describe("computePagePaths", () => {
  it("batches: the number of queries does not grow with the number of pages", async () => {
    const { site, variant } = await siteWith();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push((await makePage({ variantId: variant.id, siteId: site.id, slug: `p${i}` })).id);

    const calls = () =>
      [prisma.page.findMany, prisma.variant.findMany, prisma.section.groupBy].reduce((n, fn) => n + vi.mocked(fn).mock.calls.length, 0);
    vi.spyOn(prisma.page, "findMany");
    vi.spyOn(prisma.variant, "findMany");
    vi.spyOn(prisma.section, "groupBy");

    const few = await computePagePaths(ids.slice(0, 2));
    const afterFew = calls();
    const many = await computePagePaths(ids);
    const afterMany = calls() - afterFew;

    expect(few.size).toBe(2);
    expect(many.size).toBe(25);
    expect(many.get(ids[7]!)).toEqual(["p7"]);
    expect(afterMany).toBe(afterFew);
    expect(afterFew).toBe(4); // wanted pages, their variants' pages, the variants, the section counts
    vi.restoreAllMocks();
  });

  it("silently omits unknown ids and handles duplicates and the empty list", async () => {
    const { site, variant } = await siteWith();
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "only" });
    const out = await computePagePaths([page.id, page.id, "nope"]);
    expect([...out.keys()]).toEqual([page.id]);
    expect((await computePagePaths([])).size).toBe(0);
  });
});
