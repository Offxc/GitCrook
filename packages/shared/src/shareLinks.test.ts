import { describe, expect, it } from "vitest";
import { addShareToken, isShareToken, parseShareCookie } from "./shareLinks";

const t = (n: number) => `token${String(n).padStart(2, "0")}_abcdefghijklmnop`;

describe("isShareToken", () => {
  it("accepts url-safe base64 of a plausible length", () => {
    expect(isShareToken("AbCdEf0123456789_-AbCd")).toBe(true);
  });

  it.each(["", "short", "has space in it!!!!!!!!", "semi;colon;semi;colon;", "a,b,c,d,e,f,g,h,i,j,k", "x".repeat(65), 12, null, undefined])("rejects %j", (v) => {
    expect(isShareToken(v)).toBe(false);
  });
});

describe("parseShareCookie", () => {
  it("splits and drops anything that is not a token", () => {
    expect(parseShareCookie(`${t(1)},garbage,${t(2)}`)).toEqual([t(1), t(2)]);
  });

  it("handles nothing", () => {
    expect(parseShareCookie(undefined)).toEqual([]);
    expect(parseShareCookie("")).toEqual([]);
  });

  it("never returns more than five", () => {
    expect(parseShareCookie(Array.from({ length: 9 }, (_, i) => t(i)).join(","))).toHaveLength(5);
  });
});

describe("addShareToken", () => {
  it("starts a cookie", () => {
    expect(addShareToken(undefined, t(1))).toBe(t(1));
  });

  it("puts the new token first", () => {
    expect(addShareToken(t(1), t(2))).toBe(`${t(2)},${t(1)}`);
  });

  it("moves a repeated token to the front without duplicating it", () => {
    expect(addShareToken(`${t(1)},${t(2)}`, t(2))).toBe(`${t(2)},${t(1)}`);
  });

  it("drops the oldest beyond five", () => {
    const full = [1, 2, 3, 4, 5].map(t).join(",");
    expect(addShareToken(full, t(6)).split(",")).toEqual([6, 1, 2, 3, 4].map(t));
  });

  it("discards junk already in the cookie", () => {
    expect(addShareToken(`junk,${t(1)}`, t(2))).toBe(`${t(2)},${t(1)}`);
  });
});
