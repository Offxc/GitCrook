import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { claimNextRun, enqueueDueSources, enqueueRun, pruneRuns, reapStuckRuns } from "./queue";

beforeEach(resetDatabase);

async function source(overrides: Partial<{ status: "IDLE" | "ERROR" | "PAUSED" | "SYNCING"; lastCheckedAt: Date | null; pollIntervalSec: number }> = {}) {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  return prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "a", repo: "b", branch: "main", ...overrides } });
}
const pending = (sourceId: string) => prisma.gitSyncRun.findMany({ where: { sourceId, status: "PENDING" } });

describe("enqueueRun", () => {
  it("queues a run", async () => {
    const s = await source();
    const result = await enqueueRun(s.id, { trigger: "MANUAL" });
    expect(result.kind).toBe("queued");
    expect(await pending(s.id)).toHaveLength(1);
  });

  it("merges requests into the run that is already waiting, keeping the newest commit", async () => {
    const s = await source();
    const first = await enqueueRun(s.id, { trigger: "WEBHOOK", deliveryId: "d1", toSha: "aaa" });
    const second = await enqueueRun(s.id, { trigger: "WEBHOOK", deliveryId: "d2", toSha: "bbb" });
    expect(first.kind).toBe("queued");
    expect(second).toMatchObject({ kind: "merged", runId: (first as { runId: string }).runId });
    const waiting = await pending(s.id);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ toSha: "bbb", deliveryId: "d1" });
  });

  it("lets a full sync upgrade a waiting one, and never downgrades it", async () => {
    const s = await source();
    await enqueueRun(s.id, { trigger: "POLL" });
    await enqueueRun(s.id, { trigger: "FULL" });
    expect((await pending(s.id))[0]!.trigger).toBe("FULL");
    await enqueueRun(s.id, { trigger: "WEBHOOK" });
    expect((await pending(s.id))[0]!.trigger).toBe("FULL");
  });

  it("recognises a webhook delivery it has seen", async () => {
    const s = await source();
    await enqueueRun(s.id, { trigger: "WEBHOOK", deliveryId: "same" });
    await prisma.gitSyncRun.updateMany({ data: { status: "SUCCEEDED" } });
    expect(await enqueueRun(s.id, { trigger: "WEBHOOK", deliveryId: "same" })).toEqual({ kind: "duplicate" });
    expect(await prisma.gitSyncRun.count()).toBe(1);
  });

  it("queues one run for a burst of simultaneous requests", async () => {
    const s = await source();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueueRun(s.id, { trigger: "WEBHOOK", deliveryId: `d${i}`, toSha: `sha${i}` })));
    expect(results.filter((r) => r.kind === "queued")).toHaveLength(1);
    expect(await pending(s.id)).toHaveLength(1);
    expect(await prisma.gitSyncRun.count()).toBe(1);
  });

  it("queues a new run once the waiting one has been claimed", async () => {
    const s = await source();
    await enqueueRun(s.id, { trigger: "MANUAL" });
    await claimNextRun();
    const again = await enqueueRun(s.id, { trigger: "MANUAL" });
    expect(again.kind).toBe("queued");
    expect(await prisma.gitSyncRun.count()).toBe(2);
  });
});

describe("claimNextRun", () => {
  it("takes the oldest waiting run and marks it running", async () => {
    const a = await source();
    const b = await source();
    await enqueueRun(a.id, { trigger: "MANUAL" });
    await new Promise((r) => setTimeout(r, 5));
    await enqueueRun(b.id, { trigger: "MANUAL" });
    const claimed = await claimNextRun();
    expect(claimed).toMatchObject({ sourceId: a.id, trigger: "MANUAL" });
    const run = await prisma.gitSyncRun.findUniqueOrThrow({ where: { id: claimed!.runId } });
    expect(run).toMatchObject({ status: "RUNNING" });
    expect(run.startedAt).not.toBeNull();
    expect(run.heartbeatAt).not.toBeNull();
  });

  it("returns nothing when nothing is waiting", async () => {
    expect(await claimNextRun()).toBeNull();
  });

  it("does not start a second run of a source that is already being synced", async () => {
    const s = await source();
    await enqueueRun(s.id, { trigger: "MANUAL" });
    await claimNextRun();
    await enqueueRun(s.id, { trigger: "MANUAL" });
    expect(await claimNextRun()).toBeNull();
    await prisma.gitSyncRun.updateMany({ where: { status: "RUNNING" }, data: { status: "SUCCEEDED" } });
    expect(await claimNextRun()).not.toBeNull();
  });

  it("gives each run to exactly one of many workers", async () => {
    const sources = await Promise.all(Array.from({ length: 6 }, () => source()));
    for (const s of sources) await enqueueRun(s.id, { trigger: "MANUAL" });
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimNextRun()));
    const got = claims.filter((c) => c !== null).map((c) => c!.runId);
    expect(got).toHaveLength(6);
    expect(new Set(got).size).toBe(6);
  });
});

describe("enqueueDueSources", () => {
  const ago = (sec: number) => new Date(Date.now() - sec * 1000);

  it("queues a source that has never been checked, or whose interval has passed", async () => {
    const never = await source({ lastCheckedAt: null });
    const stale = await source({ lastCheckedAt: ago(600), pollIntervalSec: 300 });
    const fresh = await source({ lastCheckedAt: ago(10), pollIntervalSec: 300 });
    expect(await enqueueDueSources()).toBe(2);
    expect((await pending(never.id)).length).toBe(1);
    expect((await pending(stale.id)).length).toBe(1);
    expect((await pending(fresh.id)).length).toBe(0);
  });

  it("leaves paused sources alone", async () => {
    const paused = await source({ status: "PAUSED", lastCheckedAt: null });
    expect(await enqueueDueSources()).toBe(0);
    expect(await pending(paused.id)).toHaveLength(0);
  });

  it("looks at a source in error less often", async () => {
    const broken = await source({ status: "ERROR", lastCheckedAt: ago(400), pollIntervalSec: 300 });
    expect(await enqueueDueSources()).toBe(0);
    const longAgo = await source({ status: "ERROR", lastCheckedAt: ago(1000), pollIntervalSec: 300 });
    expect(await enqueueDueSources()).toBe(1);
    expect(await pending(longAgo.id)).toHaveLength(1);
    expect(await pending(broken.id)).toHaveLength(0);
  });

  it("does not queue a source that already has a run waiting or running", async () => {
    const s = await source({ lastCheckedAt: null });
    await enqueueRun(s.id, { trigger: "MANUAL" });
    expect(await enqueueDueSources()).toBe(0);
    await claimNextRun();
    expect(await enqueueDueSources()).toBe(0);
  });

  it("is safe to call from several workers at once", async () => {
    for (let i = 0; i < 5; i++) await source({ lastCheckedAt: null });
    await Promise.all(Array.from({ length: 6 }, () => enqueueDueSources()));
    expect(await prisma.gitSyncRun.count({ where: { status: "PENDING" } })).toBe(5);
  });
});

describe("reapStuckRuns", () => {
  it("fails a run whose worker stopped, frees its source, and leaves live runs alone", async () => {
    const dead = await source({ status: "SYNCING" });
    const alive = await source({ status: "SYNCING" });
    const longAgo = new Date(Date.now() - 10 * 60_000);
    const deadRun = await prisma.gitSyncRun.create({ data: { sourceId: dead.id, trigger: "MANUAL", toSha: "x", status: "RUNNING", startedAt: longAgo, heartbeatAt: longAgo } });
    const liveRun = await prisma.gitSyncRun.create({ data: { sourceId: alive.id, trigger: "MANUAL", toSha: "x", status: "RUNNING", startedAt: longAgo, heartbeatAt: new Date() } });

    expect(await reapStuckRuns()).toBe(1);
    expect(await prisma.gitSyncRun.findUniqueOrThrow({ where: { id: deadRun.id } })).toMatchObject({ status: "FAILED" });
    expect((await prisma.gitSyncRun.findUniqueOrThrow({ where: { id: deadRun.id } })).error).toContain("worker stopped");
    expect(await prisma.gitSyncRun.findUniqueOrThrow({ where: { id: liveRun.id } })).toMatchObject({ status: "RUNNING" });
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe("IDLE");
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: alive.id } })).status).toBe("SYNCING");
  });

  it("treats a run that never sent a heartbeat as stale once it is old enough", async () => {
    const s = await source({ status: "SYNCING" });
    await prisma.gitSyncRun.create({ data: { sourceId: s.id, trigger: "MANUAL", toSha: "x", status: "RUNNING", startedAt: new Date(Date.now() - 10 * 60_000), heartbeatAt: null } });
    expect(await reapStuckRuns()).toBe(1);
  });
});

describe("pruneRuns", () => {
  it("keeps the newest finished runs and never touches waiting or running ones", async () => {
    const s = await source();
    for (let i = 0; i < 8; i++) await prisma.gitSyncRun.create({ data: { sourceId: s.id, trigger: "POLL", toSha: `s${i}`, status: "SUCCEEDED", createdAt: new Date(Date.now() - (8 - i) * 1000) } });
    await prisma.gitSyncRun.create({ data: { sourceId: s.id, trigger: "POLL", toSha: "w", status: "PENDING", createdAt: new Date(Date.now() - 99_000) } });
    expect(await pruneRuns(s.id, 3)).toBe(5);
    expect((await prisma.gitSyncRun.findMany({ where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" } })).map((r) => r.toSha)).toEqual(["s7", "s6", "s5"]);
    expect(await pending(s.id)).toHaveLength(1);
  });
});
