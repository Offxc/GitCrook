import { describe, expect, it } from "vitest";
import {
  basePrefix,
  joinUrl,
  matchLegacyStructure,
  matchStructure,
  publishedBaseUrl,
  variantPrefix,
  variantSegments,
  type StructureSection,
} from "./sitePaths";

const v = (id: string, slug: string, isDefault = false) => ({ id, slug, isDefault });
const space = (id: string, slug: string, variants = [v(`${id}-main`, "main", true)]) => ({ id, slug, variants });
const section = (id: string, slug: string, spaces = [space(`${id}-docs`, "docs")]): StructureSection => ({ id, slug, spaces });

describe("matchStructure", () => {
  it("consumes nothing on a one-section, one-space, one-variant site", () => {
    const m = matchStructure([section("s", "guide")], ["getting-started", "install"]);
    expect(m).toMatchObject({ prefix: [], explicitVariant: false, rest: ["getting-started", "install"] });
    expect(m?.variant.isDefault).toBe(true);
  });

  it("an empty path is the structure root", () => {
    expect(matchStructure([section("s", "guide")], [])).toMatchObject({ prefix: [], rest: [] });
  });

  it("requires the section slug once there are two sections", () => {
    const sections = [section("a", "guides"), section("b", "api")];
    expect(matchStructure(sections, ["api", "intro"])).toMatchObject({ section: { id: "b" }, prefix: ["api"], rest: ["intro"] });
    // The old implicit URL no longer resolves — this is the A7 behaviour the redirect has to cover.
    expect(matchStructure(sections, ["intro"])).toBeNull();
    expect(matchStructure(sections, [])).toBeNull();
  });

  it("requires the space slug once a section has two spaces", () => {
    const sections = [section("s", "guide", [space("a", "alpha"), space("b", "beta")])];
    expect(matchStructure(sections, ["beta", "page"])).toMatchObject({ space: { id: "b" }, prefix: ["beta"], rest: ["page"] });
    expect(matchStructure(sections, ["page"])).toBeNull();
  });

  it("combines section and space segments in that order", () => {
    const sections = [section("a", "guides", [space("a1", "x"), space("a2", "y")]), section("b", "api")];
    expect(matchStructure(sections, ["guides", "y", "p"])).toMatchObject({ prefix: ["guides", "y"], rest: ["p"] });
  });

  it("selects a non-default variant with ~v", () => {
    const sections = [section("s", "g", [space("sp", "d", [v("v1", "v1"), v("v2", "v2", true)])])];
    const def = matchStructure(sections, ["page"]);
    expect(def?.variant.id).toBe("v2");
    expect(def?.explicitVariant).toBe(false);
    const other = matchStructure(sections, ["~v", "v1", "page"]);
    expect(other).toMatchObject({ variant: { id: "v1" }, explicitVariant: true, rest: ["page"] });
    expect(matchStructure(sections, ["~v", "nope", "page"])).toBeNull();
  });

  it("falls back to the first variant when none is marked default", () => {
    const sections = [section("s", "g", [space("sp", "d", [v("v1", "one"), v("v2", "two")])])];
    expect(matchStructure(sections, [])?.variant.id).toBe("v1");
  });

  it("treats a bare ~v as an ordinary page segment", () => {
    expect(matchStructure([section("s", "g")], ["~v"])).toMatchObject({ explicitVariant: false, rest: ["~v"] });
  });

  it("returns null for empty levels", () => {
    expect(matchStructure([], ["x"])).toBeNull();
    expect(matchStructure([{ id: "s", slug: "s", spaces: [] }], ["x"])).toBeNull();
    expect(matchStructure([{ id: "s", slug: "s", spaces: [{ id: "p", slug: "p", variants: [] }] }], ["x"])).toBeNull();
  });
});

describe("the two directions are exact inverses", () => {
  // Every shape of site: 1 or 2 sections × 1 or 2 spaces × 1 or 2 variants, default variant first or second.
  const shapes: StructureSection[][] = [];
  for (const sectionCount of [1, 2]) {
    for (const spaceCount of [1, 2]) {
      for (const variantCount of [1, 2]) {
        for (const defaultIndex of variantCount === 1 ? [0] : [0, 1]) {
          shapes.push(
            Array.from({ length: sectionCount }, (_, si) =>
              section(
                `s${si}`,
                `sec${si}`,
                Array.from({ length: spaceCount }, (_, pi) =>
                  space(
                    `s${si}p${pi}`,
                    `sp${pi}`,
                    Array.from({ length: variantCount }, (_, vi) => v(`s${si}p${pi}v${vi}`, `var${vi}`, vi === defaultIndex)),
                  ),
                ),
              ),
            ),
          );
        }
      }
    }
  }

  it.each(shapes.map((s, i) => [i, s] as const))("shape %i: variantPrefix then matchStructure lands on the same variant", (_i, sections) => {
    for (const sec of sections) {
      for (const sp of sec.spaces) {
        for (const variant of sp.variants) {
          const prefix = variantPrefix(sections, variant.id)!;
          expect(prefix).not.toBeNull();
          const match = matchStructure(sections, [...prefix, "some-page", "child"]);
          expect(match?.variant.id).toBe(variant.id);
          expect(match?.space.id).toBe(sp.id);
          expect(match?.section.id).toBe(sec.id);
          expect(match?.rest).toEqual(["some-page", "child"]);
        }
      }
    }
  });

  it("variantPrefix is null for an unknown variant", () => {
    expect(variantPrefix([section("s", "g")], "missing")).toBeNull();
  });
});

describe("prefix building", () => {
  it("basePrefix spells a level out only when it has siblings", () => {
    const sec = { slug: "guides" };
    const sp = { slug: "docs" };
    expect(basePrefix({ sections: 1, spacesInSection: 1 }, sec, sp)).toEqual([]);
    expect(basePrefix({ sections: 2, spacesInSection: 1 }, sec, sp)).toEqual(["guides"]);
    expect(basePrefix({ sections: 1, spacesInSection: 2 }, sec, sp)).toEqual(["docs"]);
    expect(basePrefix({ sections: 2, spacesInSection: 3 }, sec, sp)).toEqual(["guides", "docs"]);
  });

  it("variantSegments omits the default variant", () => {
    expect(variantSegments({ slug: "v1", isDefault: true })).toEqual([]);
    expect(variantSegments({ slug: "v1", isDefault: false })).toEqual(["~v", "v1"]);
  });
});

describe("site URLs", () => {
  const base = { protocol: "https", rootDomain: "docs.example.com", siteSlug: "acme" };

  it("uses the root domain and slug by default", () => {
    expect(publishedBaseUrl(base)).toBe("https://docs.example.com/acme");
  });

  it("uses a verified custom domain", () => {
    expect(publishedBaseUrl({ ...base, customDomain: { hostname: "help.acme.io", status: "ACTIVE" } })).toBe("https://help.acme.io");
  });

  it("ignores a custom domain that has not been verified", () => {
    for (const status of ["PENDING", "FAILED"]) {
      expect(publishedBaseUrl({ ...base, customDomain: { hostname: "help.acme.io", status } })).toBe("https://docs.example.com/acme");
    }
  });

  it("keeps the configured protocol and port", () => {
    expect(publishedBaseUrl({ protocol: "http", rootDomain: "localhost:3000", siteSlug: "demo" })).toBe("http://localhost:3000/demo");
  });

  it("joins segments without a trailing slash", () => {
    expect(joinUrl("https://x.test/s", [])).toBe("https://x.test/s");
    expect(joinUrl("https://x.test/s", ["a", "b"])).toBe("https://x.test/s/a/b");
  });
});

describe("matchLegacyStructure", () => {
  const two = [section("a", "guides"), section("b", "api")];

  it("has nothing to say about a site that has not changed shape", () => {
    expect(matchLegacyStructure([section("a", "guides")], ["intro"])).toBeNull();
    expect(matchLegacyStructure([], ["intro"])).toBeNull();
  });

  it("places an old address inside the first section", () => {
    const legacy = matchLegacyStructure(two, ["getting-started", "install"]);
    expect(legacy?.match.section.id).toBe("a");
    expect(legacy?.match.rest).toEqual(["getting-started", "install"]);
    expect(legacy?.canonical).toEqual(["guides", "getting-started", "install"]);
  });

  it("sends the site's old root to the first section's root", () => {
    expect(matchLegacyStructure(two, [])?.canonical).toEqual(["guides"]);
  });

  it("keeps an explicit version", () => {
    const sections = [section("a", "guides", [space("s", "docs", [v("v2", "v2", true), v("v1", "v1")])]), section("b", "api")];
    expect(matchLegacyStructure(sections, ["~v", "v1", "page"])?.canonical).toEqual(["guides", "~v", "v1", "page"]);
    expect(matchLegacyStructure(sections, ["~v", "nope", "page"])).toBeNull();
  });

  it("covers a section that gained a second space", () => {
    const sections = [section("a", "guides", [space("x", "alpha"), space("y", "beta")])];
    expect(matchLegacyStructure(sections, ["page"])?.canonical).toEqual(["alpha", "page"]);
  });

  it("spells out both levels when both have siblings", () => {
    const sections = [section("a", "guides", [space("x", "alpha"), space("y", "beta")]), section("b", "api")];
    expect(matchLegacyStructure(sections, ["page"])?.canonical).toEqual(["guides", "alpha", "page"]);
  });

  it("every canonical address resolves to the same place the legacy one pointed at", () => {
    const sections = [section("a", "guides", [space("x", "alpha"), space("y", "beta")]), section("b", "api")];
    for (const path of [[], ["page"], ["a", "b", "c"]]) {
      const legacy = matchLegacyStructure(sections, path)!;
      const again = matchStructure(sections, legacy.canonical)!;
      expect(again.section.id).toBe(legacy.match.section.id);
      expect(again.space.id).toBe(legacy.match.space.id);
      expect(again.variant.id).toBe(legacy.match.variant.id);
      expect(again.rest).toEqual(legacy.match.rest);
    }
  });
});
