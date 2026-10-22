import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signPasswordProof, verifyPasswordProof } from "./visitorAccess";

describe("password proof cookie", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("verifies for the site and password version it was issued for", () => {
    const token = signPasswordProof("site-1", 3);
    expect(verifyPasswordProof("site-1", 3, token)).toBe(true);
  });

  it("does not verify for another site", () => {
    expect(verifyPasswordProof("site-2", 3, signPasswordProof("site-1", 3))).toBe(false);
  });

  it("stops verifying once the password version moves on", () => {
    const token = signPasswordProof("site-1", 3);
    expect(verifyPasswordProof("site-1", 4, token)).toBe(false);
    expect(verifyPasswordProof("site-1", 2, token)).toBe(false);
  });

  it("expires after a week", () => {
    const token = signPasswordProof("site-1", 1);
    vi.advanceTimersByTime(7 * 24 * 3600 * 1000 - 1000);
    expect(verifyPasswordProof("site-1", 1, token)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(verifyPasswordProof("site-1", 1, token)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const [expiry, signature] = signPasswordProof("site-1", 1).split(".");
    const later = String(Number(expiry) + 10 * 24 * 3600 * 1000);
    expect(verifyPasswordProof("site-1", 1, `${later}.${signature}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const [expiry, signature] = signPasswordProof("site-1", 1).split(".");
    const flipped = signature!.slice(0, -1) + (signature!.endsWith("A") ? "B" : "A");
    expect(verifyPasswordProof("site-1", 1, `${expiry}.${flipped}`)).toBe(false);
  });

  it.each([undefined, "", "garbage", "123", "abc.def", ".", "1.2.3", "NaN.sig"])("rejects malformed token %j", (token) => {
    expect(verifyPasswordProof("site-1", 1, token)).toBe(false);
  });

  it("does not verify under a different secret", async () => {
    const token = signPasswordProof("site-1", 1);
    const original = process.env.AUTH_SECRET;
    // getEnv() caches the parsed environment per module instance, so load a fresh copy of the
    // module under a different secret and ask it to verify the token minted above.
    process.env.AUTH_SECRET = "a-completely-different-secret-with-32-plus-chars";
    vi.resetModules();
    try {
      const other = await import("./visitorAccess");
      expect(other.verifyPasswordProof("site-1", 1, token)).toBe(false);
      expect(other.verifyPasswordProof("site-1", 1, other.signPasswordProof("site-1", 1))).toBe(true);
    } finally {
      process.env.AUTH_SECRET = original;
      vi.resetModules();
    }
  });
});
