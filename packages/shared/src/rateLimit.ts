/**
 * Fixed-window rate limiter (OWASP A04/A07 — brute-force protection on the
 * password gate). In-memory: correct for the single `web` process this
 * stack actually deploys as (see docker-compose.yml — one replica, no
 * horizontal scaling), and REDIS_URL is documented as optional/no-op until
 * this exact feature (packages/shared/src/env.ts) — swap the Map for a
 * Redis INCR+EXPIRE pair behind this same function signature if that
 * changes. Never persisted, so a process restart resets everyone's count;
 * that's a fail-open in the attacker's favor, not the defender's, so it's
 * an acceptable trade for a self-hosted single-tenant-ops deployment.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Sweep occasionally so `buckets` doesn't grow unboundedly across a long
// process lifetime — not on every call, since that would defeat the point
// of an O(1) check.
let lastSweep = Date.now();
function sweepIfDue(now: number, windowMs: number) {
  if (now - lastSweep < windowMs * 10) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/** `key` should already include whatever scope matters (e.g. `password-gate:{siteId}:{ip}`). */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now, windowMs);

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: windowMs - (now - existing.windowStart) };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterMs: 0 };
}
