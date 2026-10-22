import { describe, expect, it } from "vitest";
import { canonicalJson, cleanRedirectPath } from "./apply";

describe("canonicalJson", () => {
  it("does not care what order keys came in, at any depth", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  });

  it("does care about array order, values and types", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: "1" }));
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it("treats an undefined property as absent, as JSON storage does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("handles primitives and empty containers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson({})).toBe("{}");
  });
});

describe("cleanRedirectPath", () => {
  it.each([
    ["old/setup", "old/setup"],
    ["/legacy/install/", "legacy/install"],
    ["./a//b", "a/b"],
    ["page?x=1#top", "page"],
    ["  spaced  ", "spaced"],
  ])("%j → %j", (raw, expected) => {
    expect(cleanRedirectPath(raw)).toBe(expected);
  });

  it.each(["", "/", "../up", "a/../b", "a\\b", "tab\tname"])("refuses %j", (raw) => {
    expect(cleanRedirectPath(raw)).toBeNull();
  });
});
