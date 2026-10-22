import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, resetDatabase } from "../../../../tests/support/factory";
import { isUniqueViolation, withFreeSlug } from "./withFreeSlug";

beforeEach(resetDatabase);

async function fixture() {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  return { site: built.site, variant: built.variant };
}

describe("the sibling-slug unique indexes", () => {
  it("reject a duplicate top-level slug in the same variant", async () => {
    const { site, variant } = await fixture();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    const error = await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" }).catch((e) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("reject a duplicate slug under the same parent", async () => {
    const { site, variant } = await fixture();
    const parent = await makePage({ variantId: variant.id, siteId: site.id, slug: "group", isGroup: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "child", parentId: parent.id });
    const error = await makePage({ variantId: variant.id, siteId: site.id, slug: "child", parentId: parent.id }).catch((e) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("allow the same slug under different parents, at different levels, and in different variants", async () => {
    const { site, variant } = await fixture();
    const g1 = await makePage({ variantId: variant.id, siteId: site.id, slug: "g1", isGroup: true });
    const g2 = await makePage({ variantId: variant.id, siteId: site.id, slug: "g2", isGroup: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "same", parentId: g1.id });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "same", parentId: g2.id });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "same" }); // top level
    const other = await prisma.variant.create({ data: { spaceId: variant.spaceId, name: "v2", slug: "v2", order: 1 } });
    await makePage({ variantId: other.id, siteId: site.id, slug: "same" });
    expect(await prisma.page.count({ where: { slug: "same" } })).toBe(4);
  });

  it("reject moving a page under a parent that already has that slug", async () => {
    const { site, variant } = await fixture();
    const parent = await makePage({ variantId: variant.id, siteId: site.id, slug: "group", isGroup: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "page", parentId: parent.id });
    const loose = await makePage({ variantId: variant.id, siteId: site.id, slug: "page" });
    const error = await prisma.page.update({ where: { id: loose.id }, data: { parentId: parent.id } }).catch((e) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });
});

describe("withFreeSlug", () => {
  const create = (variantId: string, siteId: string, parentId: string | null = null) => (slug: string) =>
    prisma.page.create({ data: { variantId, siteId, parentId, slug, title: slug, order: 0, content: [], contentText: "" } });

  it("picks the base slug when it is free and numbers when it is not", async () => {
    const { site, variant } = await fixture();
    const a = await withFreeSlug({ variantId: variant.id, parentId: null }, "Getting Started", create(variant.id, site.id));
    const b = await withFreeSlug({ variantId: variant.id, parentId: null }, "Getting Started", create(variant.id, site.id));
    const c = await withFreeSlug({ variantId: variant.id, parentId: null }, "Getting Started", create(variant.id, site.id));
    expect([a.slug, b.slug, c.slug]).toEqual(["getting-started", "getting-started-1", "getting-started-2"]);
  });

  it("steps around reserved slugs", async () => {
    const { site, variant } = await fixture();
    const page = await withFreeSlug({ variantId: variant.id, parentId: null }, "API", create(variant.id, site.id));
    expect(page.slug).toBe("api-1");
  });

  it("is scoped to the parent", async () => {
    const { site, variant } = await fixture();
    const group = await makePage({ variantId: variant.id, siteId: site.id, slug: "group", isGroup: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    const nested = await withFreeSlug({ variantId: variant.id, parentId: group.id }, "Intro", create(variant.id, site.id, group.id));
    expect(nested.slug).toBe("intro");
  });

  it("ignores the page being renamed, so keeping its slug is not a clash", async () => {
    const { site, variant } = await fixture();
    const page = await makePage({ variantId: variant.id, siteId: site.id, slug: "intro" });
    const out = await withFreeSlug({ variantId: variant.id, parentId: null, exceptPageId: page.id }, "Intro", async (slug) => slug);
    expect(out).toBe("intro");
  });

  // The race D2 is about: many requests choosing a slug for the same title at the same moment.
  it("gives 20 simultaneous creations of the same title 20 distinct slugs", async () => {
    const { site, variant } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => withFreeSlug({ variantId: variant.id, parentId: null }, "Same Title", create(variant.id, site.id))),
    );
    const slugs = results.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(20);
    expect(await prisma.page.count({ where: { variantId: variant.id } })).toBe(20);
  });

  it("rethrows errors that are not slug clashes", async () => {
    const { variant } = await fixture();
    await expect(
      withFreeSlug({ variantId: variant.id, parentId: null }, "x", async () => {
        throw new Error("disk on fire");
      }),
    ).rejects.toThrow("disk on fire");
  });

  it("gives up with a readable error when it keeps losing the race", async () => {
    const { variant } = await fixture();
    const clash = Object.assign(new Error("unique"), { code: "P2002" });
    await expect(
      withFreeSlug({ variantId: variant.id, parentId: null }, "x", async () => {
        throw clash;
      }),
    ).rejects.toThrow(/free URL/);
  });
});
