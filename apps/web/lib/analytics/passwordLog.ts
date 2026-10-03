import { prisma } from "@gitcrook/db";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ACTION = "site.passwordGateAttempt";

export interface PasswordLogEntry {
  id: string;
  result: "success" | "failure" | "rateLimited";
  ip: string;
  country: string | null;
  occurredAt: Date;
}

/**
 * Password-gate attempts carry a real IP (see passwordGateActions.ts), which
 * is more sensitive than anything else this app retains — rather than a
 * dedicated cron/worker job, expired rows are opportunistically deleted the
 * next time anyone actually looks at this log. No separate scheduler exists
 * in this codebase yet (the worker only polls for PDF export jobs), and a
 * security log that's only ever read from the dashboard doesn't need one:
 * worst case, cleanup lags until an owner next opens this page, which only
 * delays deletion, never under-retains.
 */
export async function getPasswordLog(siteId: string, limit = 50): Promise<PasswordLogEntry[]> {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  await prisma.auditLog.deleteMany({
    where: { action: ACTION, targetId: siteId, createdAt: { lt: cutoff } },
  });

  const rows = await prisma.auditLog.findMany({
    where: { action: ACTION, targetId: siteId, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, ipAddress: true, metadata: true, createdAt: true },
  });

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as { result?: string; country?: string | null };
    const result = meta.result === "success" || meta.result === "failure" || meta.result === "rateLimited" ? meta.result : "failure";
    return { id: r.id, result, ip: r.ipAddress ?? "unknown", country: meta.country ?? null, occurredAt: r.createdAt };
  });
}
