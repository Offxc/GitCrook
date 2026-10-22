import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "./rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  let n = 0;
  const key = () => `test:${n++}`;

  it("allows up to the limit and counts down", () => {
    const k = key();
    expect(checkRateLimit(k, 3, 1000)).toEqual({ allowed: true, remaining: 2, retryAfterMs: 0 });
    expect(checkRateLimit(k, 3, 1000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit(k, 3, 1000)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("refuses past the limit and says when to retry", () => {
    const k = key();
    for (let i = 0; i < 3; i++) checkRateLimit(k, 3, 1000);
    vi.advanceTimersByTime(400);
    const blocked = checkRateLimit(k, 3, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(600);
  });

  it("starts a new window once the old one has passed", () => {
    const k = key();
    for (let i = 0; i < 3; i++) checkRateLimit(k, 3, 1000);
    expect(checkRateLimit(k, 3, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(checkRateLimit(k, 3, 1000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("keeps keys independent", () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 3; i++) checkRateLimit(a, 3, 1000);
    expect(checkRateLimit(a, 3, 1000).allowed).toBe(false);
    expect(checkRateLimit(b, 3, 1000).allowed).toBe(true);
  });

  it("a limit of 1 allows exactly one", () => {
    const k = key();
    expect(checkRateLimit(k, 1, 1000).allowed).toBe(true);
    expect(checkRateLimit(k, 1, 1000).allowed).toBe(false);
  });
});
