"use server";

import { prisma, type ExportJobStatus } from "@voiddocs/db";
import { canUserDoX, getSessionUserId } from "@voiddocs/auth";

export interface ExportJobState {
  jobId?: string;
  status?: ExportJobStatus;
  resultAssetId?: string | null;
  error?: string;
}

/** Requesting a page's own PDF only needs view access to that page — exporting isn't a heavier privilege than reading. */
export async function requestPdfExport(pageId: string): Promise<ExportJobState> {
  const userId = await getSessionUserId();
  if (!userId) return { error: "Unauthorized" };

  const allowed = await canUserDoX(userId, "content.view", { type: "page", id: pageId });
  if (!allowed) return { error: "You don't have permission to export this page." };

  const job = await prisma.exportJob.create({ data: { pageId, requestedById: userId, status: "PENDING" } });
  return { jobId: job.id, status: job.status };
}

export async function getExportJobStatus(jobId: string): Promise<ExportJobState> {
  const userId = await getSessionUserId();
  if (!userId) return { error: "Unauthorized" };

  const job = await prisma.exportJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Export job not found." };
  if (job.requestedById !== userId) return { error: "Not your export job." };

  return { jobId: job.id, status: job.status, resultAssetId: job.resultAssetId, error: job.error ?? undefined };
}
