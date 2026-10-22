import { prisma, Prisma } from "@gitcrook/db";

/**
 * The queue of sync runs is the `GitSyncRun` table itself. A run is PENDING until a worker claims it, RUNNING while
 * it works (refreshing `heartbeatAt`), and then SUCCEEDED, PARTIAL or FAILED. There is no other state to lose when a
 * process dies, and no second system to run.
 */

export type Trigger = "WEBHOOK" | "POLL" | "MANUAL" | "FULL";

export type Enqueued =
  /** A new run is waiting. */
  | { kind: "queued"; runId: string }
  /** A run was already waiting; this request was merged into it. */
  | { kind: "merged"; runId: string }
  /** The same webhook delivery had been seen before. */
  | { kind: "duplicate" };

const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Asks for a sync. If one is already waiting, the request is merged into it (a full sync wins over a normal one),
 * because a waiting run reads the branch head when it starts, so it already covers anything pushed since.
 */
export async function enqueueRun(sourceId: string, request: { trigger: Trigger; deliveryId?: string | null; toSha?: string | null }): Promise<Enqueued> {
  if (request.deliveryId) {
    const seen = await prisma.gitSyncRun.findUnique({ where: { deliveryId: request.deliveryId }, select: { id: true } });
    if (seen) return { kind: "duplicate" };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const waiting = await prisma.gitSyncRun.findFirst({ where: { sourceId, status: "PENDING" }, select: { id: true, trigger: true } });
    if (waiting) {
      await prisma.gitSyncRun.update({
        where: { id: waiting.id },
        data: { ...(request.trigger === "FULL" ? { trigger: "FULL" as const } : {}), ...(request.toSha ? { toSha: request.toSha } : {}) },
      });
      return { kind: "merged", runId: waiting.id };
    }
    try {
      const run = await prisma.gitSyncRun.create({ data: { sourceId, trigger: request.trigger, deliveryId: request.deliveryId ?? null, toSha: request.toSha ?? "" }, select: { id: true } });
      return { kind: "queued", runId: run.id };
    } catch (error) {
      // Lost a race for the one waiting slot, or the same delivery arrived twice at once: look again.
      if (!isUnique(error)) throw error;
      if (request.deliveryId && (await prisma.gitSyncRun.findUnique({ where: { deliveryId: request.deliveryId }, select: { id: true } }))) return { kind: "duplicate" };
    }
  }
  throw new Error("Could not queue a sync run.");
}

export interface Claimed {
  runId: string;
  sourceId: string;
  trigger: Trigger;
}

/**
 * Takes the oldest waiting run whose source is not already being synced. Two workers can call this at once: each
 * run is locked by whoever reaches it first, and the other skips it.
 */
export async function claimNextRun(now: Date = new Date()): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<{ id: string; sourceId: string; trigger: Trigger }[]>`
    UPDATE "GitSyncRun"
    SET status = 'RUNNING', "startedAt" = ${now}, "heartbeatAt" = ${now}
    WHERE id = (
      SELECT r.id FROM "GitSyncRun" r
      WHERE r.status = 'PENDING'
        AND NOT EXISTS (SELECT 1 FROM "GitSyncRun" x WHERE x."sourceId" = r."sourceId" AND x.status = 'RUNNING')
      ORDER BY r."createdAt", r.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "sourceId", trigger`;
  const row = rows[0];
  return row ? { runId: row.id, sourceId: row.sourceId, trigger: row.trigger } : null;
}

/**
 * Sources that are due for a look at their branch: not paused, with no run waiting or running, and whose last
 * check is older than their interval. A source that is in error is looked at more slowly: it usually needs a
 * person, but a new commit that fixes it should still be noticed.
 */
export async function enqueueDueSources(now: Date = new Date(), options: { errorIntervalSec?: number } = {}): Promise<number> {
  const errorInterval = options.errorIntervalSec ?? 900;
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM "GitSource" s
    WHERE s.status <> 'PAUSED'
      AND (s."lastCheckedAt" IS NULL
           OR s."lastCheckedAt" + make_interval(secs => CASE WHEN s.status = 'ERROR' THEN GREATEST(s."pollIntervalSec", ${errorInterval}) ELSE s."pollIntervalSec" END) <= ${now})
      AND NOT EXISTS (SELECT 1 FROM "GitSyncRun" r WHERE r."sourceId" = s.id AND r.status IN ('PENDING', 'RUNNING'))
    ORDER BY s."lastCheckedAt" NULLS FIRST
    LIMIT 200`;
  let queued = 0;
  for (const { id } of due) {
    const result = await enqueueRun(id, { trigger: "POLL" });
    if (result.kind === "queued") queued++;
  }
  return queued;
}

/**
 * A run that is RUNNING but has not refreshed its heartbeat belongs to a worker that died. Mark it failed so the
 * source is not stuck, and let the poller schedule another. The run's transaction either committed or did not, so
 * the site is never left half-updated.
 */
export async function reapStuckRuns(now: Date = new Date(), staleAfterMs = 90_000): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const stuck = await prisma.gitSyncRun.findMany({ where: { status: "RUNNING", OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] }, select: { id: true, sourceId: true } });
  for (const run of stuck) {
    await prisma.$transaction([
      prisma.gitSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: now, error: WORKER_STOPPED } }),
      prisma.gitSource.updateMany({ where: { id: run.sourceId, status: "SYNCING" }, data: { status: "IDLE", lastError: "A sync was interrupted; it will be tried again." } }),
    ]);
    // A redeploy interrupts a run now and then, and the poller tries again at once. A repository that stops the worker
    // every time it is read is a different matter: after a second time in a row it waits a full interval, and after a
    // third it is paused until someone looks, rather than taking the worker down over and over.
    const recent = await prisma.gitSyncRun.findMany({ where: { sourceId: run.sourceId, status: { notIn: ["PENDING", "RUNNING"] } }, orderBy: { createdAt: "desc" }, take: STOPS_BEFORE_PAUSE, select: { error: true } });
    let stops = 0;
    while (stops < recent.length && recent[stops]!.error === WORKER_STOPPED) stops++;
    if (stops >= 2) await prisma.gitSource.updateMany({ where: { id: run.sourceId, status: { not: "PAUSED" } }, data: { lastCheckedAt: now } });
    if (stops >= STOPS_BEFORE_PAUSE) {
      await prisma.gitSource.updateMany({
        where: { id: run.sourceId, status: { not: "PAUSED" } },
        data: { status: "PAUSED", lastError: `Reading this repository stopped the sync worker ${STOPS_BEFORE_PAUSE} times in a row, so syncing is paused. Check the repository for very large or unusual files, then resume.` },
      });
    }
  }
  return stuck.length;
}

const WORKER_STOPPED = "The worker stopped before this run finished. The site was not changed by it.";
const STOPS_BEFORE_PAUSE = 3;

/** Old finished runs are history nobody reads past a point. Keeps the last `keep` per source. */
export async function pruneRuns(sourceId: string, keep = 200): Promise<number> {
  const old = await prisma.gitSyncRun.findMany({ where: { sourceId, status: { notIn: ["PENDING", "RUNNING"] } }, orderBy: { createdAt: "desc" }, skip: keep, select: { id: true } });
  if (old.length === 0) return 0;
  return (await prisma.gitSyncRun.deleteMany({ where: { id: { in: old.map((r) => r.id) } } })).count;
}

/**
 * Access tokens belong to a source. When the source goes — disconnected, or its site or version deleted — a token
 * that nothing uses must not stay in the database. The grace period covers the moment between a token being saved
 * and the source that will use it being created.
 */
export async function pruneOrphanCredentials(now: Date = new Date(), graceMs = 60 * 60_000): Promise<number> {
  return (await prisma.gitCredential.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - graceMs) }, sources: { none: {} } } })).count;
}
