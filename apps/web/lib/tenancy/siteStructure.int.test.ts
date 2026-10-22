import { beforeEach, describe, expect, it } from "vitest";
import { computePagePaths, prisma } from "@gitcrook/db";
import { variantPrefix } from "@gitcrook/shared";
import { makeOrg, makePage, makeSite, resetDatabase, type StructureSpec } from "../../../../tests/support/factory";
import { resolvePublishedPath } from "./resolvePublishedPath";
import { loadShellStructure } from "./siteStructure";
import { deriveLocation } from "./siteLocation";
import type { ResolvedSite } from "./resolveSite";

beforeEach(resetDatabase);

// The sidebar decides which page is active in the browser, from the structure alone; the server decides
// which page to render from the database. If they ever disagree the reader sees one page highlighted and
// another displayed. This is the check that they don't.
describe("the browser's idea of the active page matches the server's", () => {
  const structures: Record<string, StructureSpec | undefined> = {
    "plain site": undefined,
    "two sections": [
      { slug: "guides", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
      { slug: "api", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
    ],
    "spaces and versions": [
      {
        slug: "docs",
        spaces: [
          { slug: "alpha", variants: [{ slug: "v2", isDefault: true }, { slug: "v1" }] },
          { slug: "beta", variants: [{ slug: "main", isDefault: true }] },
        ],
      },
    ],
  };

  it.each(Object.entries(structures))("%s", async (_name, structure) => {
    const org = await makeOrg();
    const built = await makeSite({ organizationId: org.id, structure });
    const site = built.site as unknown as ResolvedSite;

    // Fill every variant with groups, an empty group, nested pages and a draft.
    for (const v of built.variants) {
      await makePage({ variantId: v.id, siteId: built.site.id, slug: "empty", isGroup: true, order: 0 });
      const group = await makePage({ variantId: v.id, siteId: built.site.id, slug: "guides", isGroup: true, order: 1 });
      await makePage({ variantId: v.id, siteId: built.site.id, slug: "install", parentId: group.id, order: 0 });
      const usage = await makePage({ variantId: v.id, siteId: built.site.id, slug: "usage", parentId: group.id, order: 1 });
      await makePage({ variantId: v.id, siteId: built.site.id, slug: "advanced", parentId: usage.id, order: 0 });
      await makePage({ variantId: v.id, siteId: built.site.id, slug: "intro", order: 2 });
      await makePage({ variantId: v.id, siteId: built.site.id, slug: "hidden", order: 3, isDraft: true });
    }

    const sections = await loadShellStructure(built.site.id);

    // Every real page's own URL, every group's URL, every variant root, and some URLs that name nothing.
    const allPages = await prisma.page.findMany({ where: { siteId: built.site.id }, select: { id: true } });
    const pagePaths = [...(await computePagePaths(allPages.map((p) => p.id))).values()];
    const roots = built.variants.map((v) => variantPrefix(sections, v.id)!);
    const candidates = [...pagePaths, ...roots, ["nope"], ["guides", "nope"], [], ["empty"]];

    let compared = 0;
    for (const segments of candidates) {
      const server = await resolvePublishedPath(site, segments);
      const location = deriveLocation(sections, segments);
      if (server) {
        expect(location?.matched, segments.join("/")).toBe(true);
        expect(location?.activeNode?.id, segments.join("/")).toBe(server.page.id);
        expect(location?.variant.id, segments.join("/")).toBe(server.variant.id);
        compared++;
      } else if (location?.matched) {
        expect(location.activeNode, `${segments.join("/")} should have no active page`).toBeNull();
      }
    }
    expect(compared).toBeGreaterThan(5);
  });
});

describe("loadShellStructure", () => {
  it("excludes drafts, orders siblings, and resolves icon paths on the server", async () => {
    const org = await makeOrg();
    const built = await makeSite({ organizationId: org.id });
    const v = built.variant;
    await makePage({ variantId: v.id, siteId: built.site.id, slug: "b", order: 1 });
    const a = await makePage({ variantId: v.id, siteId: built.site.id, slug: "a", order: 0 });
    await makePage({ variantId: v.id, siteId: built.site.id, slug: "draft", order: 2, isDraft: true });
    await prisma.page.update({ where: { id: a.id }, data: { icon: "rocket" } });
    await makePage({ variantId: v.id, siteId: built.site.id, slug: "emoji", order: 3 }).then((p) => prisma.page.update({ where: { id: p.id }, data: { icon: "🚀" } }));

    const [section] = await loadShellStructure(built.site.id);
    const tree = section!.spaces[0]!.variants[0]!.tree;
    expect(tree.map((n) => n.slug)).toEqual(["a", "b", "emoji"]);
    expect(tree[0]!.icon).toBe("rocket");
    expect(tree[0]!.iconPaths?.length).toBeGreaterThan(0); // path data, so the browser needs no icon table
    expect(tree[1]!.iconPaths).toBeNull();
    expect(tree[2]!.icon).toBe("🚀");
    expect(tree[2]!.iconPaths).toBeNull(); // a legacy emoji icon renders as text
  });
});
