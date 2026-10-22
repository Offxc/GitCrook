import { describe, expect, it } from "vitest";
import { safeHref, safeMediaUrl, safeRedirectPath } from "./urls";

describe("safeHref", () => {
  it.each([
    "https://example.com/a?b=c#d",
    "http://example.com",
    "HTTPS://EXAMPLE.COM",
    "mailto:someone@example.com",
    "tel:+15551234567",
    "/docs/intro",
    "./sibling",
    "../parent/page",
    "page-without-slash",
    "dir/page",
    "?query=1",
    "#heading",
    "//cdn.example.com/x.png",
    "docs/a:b", // a colon after a slash is not a scheme
  ])("keeps %s", (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "blob:https://example.com/uuid",
    "",
    "   ",
  ])("drops %j", (url) => {
    expect(safeHref(url)).toBe("");
  });

  it("drops non-strings", () => {
    for (const v of [undefined, null, 3, {}, []]) expect(safeHref(v)).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(safeHref("  https://example.com  ")).toBe("https://example.com");
  });
});

describe("safeMediaUrl", () => {
  it("accepts http(s) and relative sources", () => {
    expect(safeMediaUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeMediaUrl("/api/files/abc")).toBe("/api/files/abc");
  });

  it("rejects mail and phone links and unsafe schemes", () => {
    expect(safeMediaUrl("mailto:a@b.c")).toBe("");
    expect(safeMediaUrl("tel:123")).toBe("");
    expect(safeMediaUrl("javascript:alert(1)")).toBe("");
    expect(safeMediaUrl("data:image/svg+xml,<svg/>")).toBe("");
  });
});

describe("safeRedirectPath", () => {
  it.each(["/", "/docs/page", "/site/page?x=1#h", "/a//b"])("keeps %s", (p) => {
    expect(safeRedirectPath(p)).toBe(p);
  });

  it.each(["//evil.com", "//evil.com/x", "https://evil.com", "http://evil.com", "javascript:alert(1)", "/\\evil.com", "\\\\evil.com", "page", "", "/x\ny", "/x\ty"])(
    "falls back for %j",
    (p) => {
      expect(safeRedirectPath(p)).toBe("/");
    },
  );

  it("uses the fallback given, and tolerates non-strings", () => {
    expect(safeRedirectPath("//x", "/home")).toBe("/home");
    for (const v of [undefined, null, 3, {}]) expect(safeRedirectPath(v, "/z")).toBe("/z");
  });
});
