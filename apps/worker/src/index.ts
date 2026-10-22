import { createAssetImporter } from "@gitcrook/assets";
import { prisma } from "@gitcrook/db";
import { closeParserPool, createGitSyncRunner, hostConfigFromEnv } from "@gitcrook/git-sync";
import { SecretBox } from "@gitcrook/shared/server";
import { runExportPdfJob } from "./jobs/exportPdf";

const POLL_INTERVAL_MS = 3000;

/**
 * Git Sync. A malformed encryption key is reported once and sources with credentials then fail with a clear message;
 * it must not stop the PDF exporter. Which hosts the worker may talk to is fixed here, not taken from a source.
 */
function startGitSync() {
  let secrets: SecretBox | null = null;
  try {
    secrets = SecretBox.fromEnv();
  } catch (error) {
    console.error(`[git-sync] ${error instanceof Error ? error.message : String(error)} Sources that need a credential will not sync.`);
  }
  const { apiBase, allowedHosts } = hostConfigFromEnv();
  return createGitSyncRunner(
    { secrets, assets: createAssetImporter(undefined, { maxOrganizationBytes: (Number(process.env.GIT_SYNC_ORG_ASSET_QUOTA_MB) || 2048) * 1024 * 1024 }), apiBase, allowedHosts, log: (m) => console.log(m) },
    { concurrency: Math.max(1, Number(process.env.GIT_SYNC_CONCURRENCY) || 2), log: (m) => console.log(m) },
  );
}

const gitSync = startGitSync();

/** Read-then-conditional-update rather than a single UPDATE ... LIMIT 1 (Postgres has no LIMIT on UPDATE) — the updateMany's own WHERE status:"PENDING" is what actually makes the claim atomic; a second worker racing on the same row just gets count 0 and moves on. */
async function claimNextJob(): Promise<string | null> {
  const next = await prisma.exportJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (!next) return null;
  const claimed = await prisma.exportJob.updateMany({ where: { id: next.id, status: "PENDING" }, data: { status: "PROCESSING" } });
  return claimed.count === 1 ? next.id : null;
}

async function tick(): Promise<void> {
  // Git Sync starts its syncs in the background and returns at once, so a slow repository never delays a PDF.
  await gitSync.tick().catch((err) => console.error("[git-sync] tick failed:", err));
  const jobId = await claimNextJob();
  if (!jobId) return;
  console.log(`[worker] processing export job ${jobId}`);
  await runExportPdfJob(jobId);
  console.log(`[worker] finished export job ${jobId}`);
}

async function main(): Promise<void> {
  console.log(`[worker] started, polling for export jobs and Git Sync every ${POLL_INTERVAL_MS}ms`);
  // Let syncs that are running finish (their transactions either commit or roll back; nothing is left half-done).
  const shutdown = async () => {
    console.log("[worker] stopping; waiting for Git Sync runs to finish");
    await Promise.race([gitSync.idle(), new Promise((resolve) => setTimeout(resolve, 20_000))]);
    closeParserPool();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
