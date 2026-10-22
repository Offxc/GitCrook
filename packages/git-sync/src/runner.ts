import { claimNextRun, enqueueDueSources, pruneOrphanCredentials, pruneRuns, reapStuckRuns } from "./queue";
import { runSync, type SyncDeps } from "./sync";
import { prisma } from "@gitcrook/db";

export interface RunnerOptions {
  /** Syncs in flight at once, across all sources. */
  concurrency?: number;
  /** How often the poller and the reaper run, at most. */
  maintenanceEveryMs?: number;
  log?: (message: string) => void;
  now?: () => Date;
}

/**
 * The worker's side of Git Sync. `tick()` is cheap and non-blocking: it claims waiting runs and starts them in the
 * background, so the worker's other jobs (PDF export) are never held up by a slow repository. Every so often it also
 * looks for sources that are due for a poll and for runs whose worker died.
 */
export function createGitSyncRunner(deps: SyncDeps, options: RunnerOptions = {}) {
  const concurrency = options.concurrency ?? 2;
  const maintenanceEvery = options.maintenanceEveryMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const active = new Set<Promise<void>>();
  let lastMaintenance = 0;

  async function maintain() {
    const t = now().getTime();
    if (t - lastMaintenance < maintenanceEvery) return;
    lastMaintenance = t;
    const reaped = await reapStuckRuns(now());
    if (reaped > 0) log(`[git-sync] ended ${reaped} run${reaped === 1 ? "" : "s"} whose worker had stopped`);
    const queued = await enqueueDueSources(now());
    if (queued > 0) log(`[git-sync] queued ${queued} poll${queued === 1 ? "" : "s"}`);
    const orphans = await pruneOrphanCredentials(now());
    if (orphans > 0) log(`[git-sync] removed ${orphans} saved access token${orphans === 1 ? "" : "s"} that no repository uses`);
  }

  return {
    /** Starts whatever can be started. Resolves quickly; the syncs themselves finish in the background. */
    async tick(): Promise<void> {
      await maintain();
      while (active.size < concurrency) {
        const claimed = await claimNextRun(now());
        if (!claimed) break;
        log(`[git-sync] ${claimed.trigger.toLowerCase()} sync of source ${claimed.sourceId}`);
        const job: Promise<void> = runSync({ ...deps, log: deps.log ?? log }, claimed.sourceId, { trigger: claimed.trigger, runId: claimed.runId })
          .then(async (outcome) => {
            log(`[git-sync] source ${claimed.sourceId}: ${outcome.unchanged ? "unchanged" : outcome.status.toLowerCase()}${outcome.error ? ` (${outcome.error})` : ""}`);
            await pruneRuns(claimed.sourceId).catch(() => undefined);
          })
          .catch(async (error) => {
            // runSync reports problems in its outcome; reaching here means it could not even record one.
            log(`[git-sync] source ${claimed.sourceId}: ${error instanceof Error ? error.message : String(error)}`);
            await prisma.gitSyncRun.updateMany({ where: { id: claimed.runId, status: "RUNNING" }, data: { status: "FAILED", finishedAt: now(), error: "Git Sync hit an unexpected error." } }).catch(() => undefined);
          })
          .finally(() => void active.delete(job));
        active.add(job);
      }
    },
    /** Waits for the syncs that are running. For shutdown and for tests. */
    async idle(): Promise<void> {
      while (active.size > 0) await Promise.allSettled([...active]);
    },
    get running(): number {
      return active.size;
    },
  };
}
