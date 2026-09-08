import { createHash } from "node:crypto";
import { prisma } from "@voiddocs/db";
import { getEnv, writeStoredFile } from "@voiddocs/shared/server";
import { launchBrowser } from "../browser";
import { computePagePath } from "../computePagePath";

/**
 * Runs one already-claimed ExportJob (status already flipped to PROCESSING
 * by the caller's atomic claim — see index.ts) end to end: resolve the
 * page's real published URL, render it exactly as a visitor would see it
 * (same CSS, same theme, same auth-free page since PDF export is only ever
 * offered for pages the requester can already view), print to PDF, store it
 * as a FILE asset, and mark the job DONE or FAILED.
 */
export async function runExportPdfJob(jobId: string): Promise<void> {
  const job = await prisma.exportJob.findUnique({ where: { id: jobId }, include: { page: { include: { site: { include: { customDomain: true } } } } } });
  if (!job) return;

  try {
    const path = await computePagePath(job.pageId);
    if (path === null) throw new Error("Page no longer exists or has no resolvable path.");

    const site = job.page.site;
    const baseUrl = site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${getEnv().ROOT_PROTOCOL}://${getEnv().ROOT_DOMAIN}/${site.slug}`;
    const url = path.length > 0 ? `${baseUrl}/${path.join("/")}` : baseUrl;

    const browser = await launchBrowser();
    let pdf: Buffer;
    try {
      const browserPage = await browser.newPage();
      await browserPage.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      pdf = await browserPage.pdf({ format: "A4", printBackground: true, margin: { top: "20mm", bottom: "20mm", left: "16mm", right: "16mm" } });
    } finally {
      await browser.close();
    }

    const checksum = createHash("sha256").update(pdf).digest("hex");
    const storageKey = `${site.organizationId}/exports/${checksum}.pdf`;
    await writeStoredFile(storageKey, pdf);

    const asset = await prisma.asset.create({
      data: {
        organizationId: site.organizationId,
        uploaderId: job.requestedById,
        siteId: site.id, // so /api/files applies this site's own visitor access check — an exported PDF of a Private page must stay just as gated as the page itself
        kind: "FILE",
        storageKey,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        checksumSha256: checksum,
      },
    });

    await prisma.exportJob.update({ where: { id: job.id }, data: { status: "DONE", resultAssetId: asset.id, completedAt: new Date() } });
  } catch (err) {
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : "Unknown error", completedAt: new Date() },
    });
  }
}
