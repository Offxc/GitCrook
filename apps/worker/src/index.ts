import { prisma } from "@voiddocs/db";
import { runExportPdfJob } from "./jobs/exportPdf";

const POLL_INTERVAL_MS = 3000;

/** Read-then-conditional-update rather than a single UPDATE ... LIMIT 1 (Postgres has no LIMIT on UPDATE) — the updateMany's own WHERE status:"PENDING" is what actually makes the claim atomic; a second worker racing on the same row just gets count 0 and moves on. */
async function claimNextJob(): Promise<string | null> {
  const next = await prisma.exportJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (!next) return null;
  const claimed = await prisma.exportJob.updateMany({ where: { id: next.id, status: "PENDING" }, data: { status: "PROCESSING" } });
  return claimed.count === 1 ? next.id : null;
}

async function tick(): Promise<void> {
  const jobId = await claimNextJob();
  if (!jobId) return;
  console.log(`[worker] processing export job ${jobId}`);
  await runExportPdfJob(jobId);
  console.log(`[worker] finished export job ${jobId}`);
}

async function main(): Promise<void> {
  console.log(`[worker] started, polling for export jobs every ${POLL_INTERVAL_MS}ms`);
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
