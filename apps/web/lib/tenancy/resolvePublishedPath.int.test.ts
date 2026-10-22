import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, resetDatabase, type StructureSpec } from "../../../../tests/support/factory";
import { resolveLegacyPath, resolvePublishedPath } from "./resolvePublishedPath";
import { getPageTree } from "./getPageTree";
import type { ResolvedSite } from "./resolveSite";

beforeEach(resetDatabase);

async function build(structure?: StructureSpec) {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id, structure });
  return { ...built, resolved: built.site as unknown as ResolvedSite };
}

describe("resolvePublishedPath on a plain site", () => {
  it("resolves the root to the first top-level page", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "welcome", order: 0 });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "second", order: 1 });
    expect((await resolvePublishedPath(resolved, []))?.page.slug).toBe("welcome");
    expect((await resolvePublishedPath(resolved, ["second"]))?.page.slug).toBe("second");
  });

  it("is null for an unknown page, and for an empty site", async () => {
    const { site, variant, resolved } = await build();
    expect(await resolvePublishedPath(resolved, [])).toBeNull();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "only" });
    expect(await resolvePublishedPath(resolved, ["nope"])).toBeNull();
    expect(await resolvePublishedPath(resolved, ["only", "deeper"])).toBeNull();
  });

  it("resolves nested pages by their slug chain", async () => {
    const { site, variant, resolved } = await build();
    const parent = await makePage({ variantId: variant.id, siteId: site.id, slug: "guides", isGroup: true });
    const child = await makePage({ variantId: variant.id, siteId: site.id, slug: "install", parentId: parent.id });
    expect((await resolvePublishedPath(resolved, ["guides", "install"]))?.page.id).toBe(child.id);
  });

  it("lands on a group's first child rather than the group", async () => {
    const { site, variant, resolved } = await build();
    const group = await makePage({ variantId: variant.id, siteId: site.id, slug: "guides", isGroup: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "second", parentId: group.id, order: 1 });
    const first = await makePage({ variantId: variant.id, siteId: site.id, slug: "first", parentId: group.id, order: 0 });
    expect((await resolvePublishedPath(resolved, ["guides"]))?.page.id).toBe(first.id);
  });

  it("skips an empty first group when resolving the site root", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "empty", isGroup: true, order: 0 });
    const real = await makePage({ variantId: variant.id, siteId: site.id, slug: "real", order: 1 });
    expect((await resolvePublishedPath(resolved, []))?.page.id).toBe(real.id);
  });

  it("never serves drafts", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "secret", isDraft: true });
    expect(await resolvePublishedPath(resolved, ["secret"])).toBeNull();
    expect(await resolvePublishedPath(resolved, [])).toBeNull();
  });

  it("reports an empty prefix and a single section", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "p" });
    const r = await resolvePublishedPath(resolved, ["p"]);
    expect(r?.pathPrefix).toEqual([]);
    expect(r?.sections).toHaveLength(1);
    expect(r?.variantOptions).toEqual([]);
  });
});

describe("resolvePublishedPath on a structured site", () => {
  const structure: StructureSpec = [
    { slug: "guides", spaces: [{ slug: "main", variants: [{ slug: "v2", isDefault: true }, { slug: "v1" }] }] },
    { slug: "api", spaces: [{ slug: "ref", variants: [{ slug: "main", isDefault: true }] }] },
  ];

  it("needs the section slug and reports it as the prefix", async () => {
    const { site, variants, resolved } = await build(structure);
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "intro" });
    expect(await resolvePublishedPath(resolved, ["intro"])).toBeNull();
    const r = await resolvePublishedPath(resolved, ["guides", "intro"]);
    expect(r?.page.slug).toBe("intro");
    expect(r?.pathPrefix).toEqual(["guides"]);
    expect(r?.sections.map((s) => s.slug)).toEqual(["guides", "api"]);
  });

  it("serves a non-default variant under ~v, and offers the equivalent page in each variant", async () => {
    const { site, variants, resolved } = await build(structure);
    const [v2, v1] = variants as [(typeof variants)[number], (typeof variants)[number]];
    await makePage({ variantId: v2.id, siteId: site.id, slug: "intro" });
    await makePage({ variantId: v2.id, siteId: site.id, slug: "only-in-v2" });
    await makePage({ variantId: v1.id, siteId: site.id, slug: "intro" });

    const r = await resolvePublishedPath(resolved, ["guides", "~v", "v1", "intro"]);
    expect(r?.variant.slug).toBe("v1");
    expect(r?.page.variantId).toBe(v1.id);

    const onDefault = await resolvePublishedPath(resolved, ["guides", "intro"]);
    const options = Object.fromEntries(onDefault!.variantOptions.map((o) => [o.variant.slug, o.pagePath]));
    expect(options).toEqual({ v2: ["intro"], v1: ["intro"] });

    const missing = await resolvePublishedPath(resolved, ["guides", "only-in-v2"]);
    const missingOptions = Object.fromEntries(missing!.variantOptions.map((o) => [o.variant.slug, o.pagePath]));
    expect(missingOptions).toEqual({ v2: ["only-in-v2"], v1: null }); // no equivalent in v1 → the switcher falls back to its root
  });

  it("is null for an unknown variant", async () => {
    const { site, variants, resolved } = await build(structure);
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "intro" });
    expect(await resolvePublishedPath(resolved, ["guides", "~v", "v9", "intro"])).toBeNull();
  });
});

describe("getPageTree", () => {
  it("returns visible pages nested, in order, without drafts", async () => {
    const { site, variant } = await build();
    const group = await makePage({ variantId: variant.id, siteId: site.id, slug: "g", isGroup: true, order: 1 });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "b", parentId: group.id, order: 1 });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "a", parentId: group.id, order: 0 });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "draft", parentId: group.id, order: 2, isDraft: true });
    await makePage({ variantId: variant.id, siteId: site.id, slug: "first", order: 0 });
    const tree = await getPageTree(variant.id);
    expect(tree.map((n) => n.slug)).toEqual(["first", "g"]);
    expect(tree[1]!.children.map((n) => n.slug)).toEqual(["a", "b"]);
  });
});

describe("resolveLegacyPath: addresses from before the site had two sections", () => {
  const twoSections: StructureSpec = [
    { slug: "guides", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
    { slug: "api", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
  ];

  it("points an old page address at the first section", async () => {
    const { site, variants, resolved } = await build(twoSections);
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "install" });
    expect(await resolvePublishedPath(resolved, ["install"])).toBeNull();
    expect(await resolveLegacyPath(resolved, ["install"])).toEqual(["guides", "install"]);
  });

  it("points the site's old root at the first section's root", async () => {
    const { site, variants, resolved } = await build(twoSections);
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "welcome" });
    expect(await resolveLegacyPath(resolved, [])).toEqual(["guides"]);
  });

  it("follows nested pages and groups", async () => {
    const { site, variants, resolved } = await build(twoSections);
    const group = await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "setup", isGroup: true });
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "install", parentId: group.id });
    expect(await resolveLegacyPath(resolved, ["setup", "install"])).toEqual(["guides", "setup", "install"]);
    expect(await resolveLegacyPath(resolved, ["setup"])).toEqual(["guides", "setup"]);
  });

  it("does not invent pages: drafts, deleted pages and unknown paths are still not found", async () => {
    const { site, variants, resolved } = await build(twoSections);
    await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "draft", isDraft: true });
    const gone = await makePage({ variantId: variants[0]!.id, siteId: site.id, slug: "gone" });
    await prisma.page.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    expect(await resolveLegacyPath(resolved, ["draft"])).toBeNull();
    expect(await resolveLegacyPath(resolved, ["gone"])).toBeNull();
    expect(await resolveLegacyPath(resolved, ["nope"])).toBeNull();
  });

  it("does not look in the second section", async () => {
    const { site, variants, resolved } = await build(twoSections);
    await makePage({ variantId: variants[1]!.id, siteId: site.id, slug: "reference" });
    expect(await resolveLegacyPath(resolved, ["reference"])).toBeNull();
  });

  it("has no legacy addresses on a site with one section", async () => {
    const { site, variant, resolved } = await build();
    await makePage({ variantId: variant.id, siteId: site.id, slug: "install" });
    expect(await resolveLegacyPath(resolved, ["install"])).toBeNull();
    expect(await resolveLegacyPath(resolved, ["nope"])).toBeNull();
  });
});
