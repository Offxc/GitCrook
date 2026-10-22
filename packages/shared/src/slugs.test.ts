import { describe, expect, it } from "vitest";
import { freeSlug, slugify } from "./slugs";
import { isReservedSlug, isValidSlugFormat, validateSlug } from "./reservedSlugs";

describe("slugify", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["  Spaces   everywhere  ", "spaces-everywhere"],
    ["API: v2 (beta)!", "api-v2-beta"],
    ["Ünïcödé Tïtle", "unicode-title"],
    ["naïve café", "naive-cafe"],
    ["---", "page"],
    ["日本語", "page"],
    ["", "page"],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps the length and never ends on a hyphen", () => {
    const slug = slugify(`${"a".repeat(95)} b c d`);
    expect(slug.length).toBeLessThanOrEqual(96);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlugFormat(slug)).toBe(true);
  });

  it("always produces a valid slug", () => {
    for (const input of ["x", "a-b", "A_B", "1 2 3", "&&&", "a".repeat(300), "-a-", "naïve café"]) {
      expect(isValidSlugFormat(slugify(input))).toBe(true);
    }
  });
});

describe("freeSlug", () => {
  it("returns the base when nothing is taken", () => {
    expect(freeSlug("intro", new Set())).toBe("intro");
  });

  it("numbers on collision", () => {
    expect(freeSlug("intro", new Set(["intro"]))).toBe("intro-1");
    expect(freeSlug("intro", new Set(["intro", "intro-1", "intro-2"]))).toBe("intro-3");
  });

  it("steps around reserved slugs", () => {
    expect(freeSlug("api", new Set())).toBe("api-1");
    expect(freeSlug("login", new Set(["login-1"]))).toBe("login-2");
  });

  it("keeps long slugs within the limit when numbering", () => {
    const base = "a".repeat(96);
    const out = freeSlug(base, new Set([base]));
    expect(out.length).toBeLessThanOrEqual(96);
    expect(out.endsWith("-1")).toBe(true);
    expect(isValidSlugFormat(out)).toBe(true);
  });

  it("repairs a base that isn't a valid slug", () => {
    expect(freeSlug("Not A Slug!", new Set())).toBe("not-a-slug");
  });
});

describe("slug validation", () => {
  it("accepts ordinary slugs", () => {
    for (const s of ["a", "intro", "v2", "a-b-c", "2024-notes"]) expect(validateSlug(s)).toEqual({ ok: true });
  });

  it.each(["", "A", "a_b", "a b", "-a", "a-", "a--b", "a/b", "é", "a".repeat(97)])("rejects the malformed slug %j", (s) => {
    expect(validateSlug(s).ok).toBe(false);
  });

  it.each(["api", "login", "dashboard", "_next", "~v", "robots.txt", "API"])("reserves %j", (s) => {
    expect(isReservedSlug(s)).toBe(true);
    expect(validateSlug(s).ok).toBe(false);
  });
});
