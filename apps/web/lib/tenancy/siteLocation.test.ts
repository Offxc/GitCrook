import { describe, expect, it } from "vitest";
import { deriveLocation, pathsFor, segmentsFromPathname, type ShellNode, type ShellSection } from "./siteLocation";

const node = (id: string, slug: string, children: ShellNode[] = [], isGroup = false): ShellNode => ({ id, title: id, slug, icon: null, iconPaths: null, isGroup, children });
const variant = (id: string, slug: string, isDefault: boolean, tree: ShellNode[]) => ({ id, name: id, slug, isDefault, tree });
const space = (id: string, slug: string, variants: ReturnType<typeof variant>[]) => ({ id, title: id, slug, variants });
const section = (id: string, slug: string, spaces: ReturnType<typeof space>[]): ShellSection => ({ id, title: id, slug, icon: null, iconPaths: null, spaces });

const docsTree = [node("intro", "intro"), node("guides", "guides", [node("install", "install"), node("usage", "usage", [node("usage-adv", "advanced")])], true)];

describe("segmentsFromPathname", () => {
  it("strips the site's base path", () => {
    expect(segmentsFromPathname("/acme/guides/install", "/acme")).toEqual(["guides", "install"]);
    expect(segmentsFromPathname("/acme", "/acme")).toEqual([]);
    expect(segmentsFromPathname("/acme/", "/acme")).toEqual([]);
  });

  it("uses the whole path on a custom domain (empty base)", () => {
    expect(segmentsFromPathname("/guides/install", "")).toEqual(["guides", "install"]);
    expect(segmentsFromPathname("/", "")).toEqual([]);
  });

  it("decodes percent-escapes and survives malformed ones", () => {
    expect(segmentsFromPathname("/acme/caf%C3%A9", "/acme")).toEqual(["café"]);
    expect(segmentsFromPathname("/acme/%E0%A4%A", "/acme")).toEqual(["%E0%A4%A"]);
  });

  it("ignores doubled slashes", () => {
    expect(segmentsFromPathname("/acme//guides///install", "/acme")).toEqual(["guides", "install"]);
  });
});

describe("deriveLocation on a plain site", () => {
  const sections = [section("s", "documentation", [space("sp", "docs", [variant("v", "main", true, docsTree)])])];

  it("finds the active page", () => {
    const loc = deriveLocation(sections, ["guides", "install"])!;
    expect(loc.matched).toBe(true);
    expect(loc.activeNode?.id).toBe("install");
    expect(loc.base).toEqual([]);
    expect(loc.prefix).toEqual([]);
    expect(loc.rest).toEqual(["guides", "install"]);
  });

  it("lands on a group's first child and on the first page for the root", () => {
    expect(deriveLocation(sections, ["guides"])!.activeNode?.id).toBe("install");
    expect(deriveLocation(sections, [])!.activeNode?.id).toBe("intro");
  });

  it("an unknown page is matched structurally but has no active node", () => {
    const loc = deriveLocation(sections, ["nope"])!;
    expect(loc.matched).toBe(true);
    expect(loc.activeNode).toBeNull();
  });

  it("builds link paths for the whole tree", () => {
    const paths = pathsFor(deriveLocation(sections, [])!);
    expect(paths.get("install")).toEqual(["guides", "install"]);
    expect(paths.get("usage-adv")).toEqual(["guides", "usage", "advanced"]);
  });
});

describe("deriveLocation with sections, spaces and variants", () => {
  const sections = [
    section("guides", "guides", [
      space("a", "alpha", [variant("a-v2", "v2", true, [node("p", "page")]), variant("a-v1", "v1", false, [node("p1", "page")])]),
      space("b", "beta", [variant("b-main", "main", true, [node("q", "other")])]),
    ]),
    section("api", "api", [space("c", "ref", [variant("c-main", "main", true, [node("r", "reference")])])]),
  ];

  it("needs section and space slugs where there are siblings", () => {
    const loc = deriveLocation(sections, ["guides", "alpha", "page"])!;
    expect(loc.section.id).toBe("guides");
    expect(loc.space.id).toBe("a");
    expect(loc.variant.id).toBe("a-v2");
    expect(loc.base).toEqual(["guides", "alpha"]);
    expect(loc.activeNode?.id).toBe("p");
  });

  it("a section with a single space doesn't spell the space out", () => {
    const loc = deriveLocation(sections, ["api", "reference"])!;
    expect(loc.base).toEqual(["api"]);
    expect(loc.activeNode?.id).toBe("r");
  });

  it("selects a non-default variant and prefixes its links with ~v", () => {
    const loc = deriveLocation(sections, ["guides", "alpha", "~v", "v1", "page"])!;
    expect(loc.variant.id).toBe("a-v1");
    expect(loc.prefix).toEqual(["guides", "alpha", "~v", "v1"]);
    expect(loc.activeNode?.id).toBe("p1");
    expect(pathsFor(loc).get("p1")).toEqual(["guides", "alpha", "~v", "v1", "page"]);
  });

  it("the default variant's links need no ~v even when the URL spelled it out", () => {
    const loc = deriveLocation(sections, ["guides", "alpha", "~v", "v2", "page"])!;
    expect(loc.variant.isDefault).toBe(true);
    expect(loc.prefix).toEqual(["guides", "alpha"]);
  });

  it("falls back to the first section's default variant for a URL that names nothing", () => {
    const loc = deriveLocation(sections, ["unknown-section", "x"])!;
    expect(loc.matched).toBe(false);
    expect(loc.section.id).toBe("guides");
    expect(loc.variant.id).toBe("a-v2");
    expect(loc.activeNode).toBeNull();
    expect(loc.prefix).toEqual(["guides", "alpha"]);
  });

  it("is null for a site with nothing in it", () => {
    expect(deriveLocation([], [])).toBeNull();
    expect(deriveLocation([section("s", "s", [])], [])).toBeNull();
  });
});
