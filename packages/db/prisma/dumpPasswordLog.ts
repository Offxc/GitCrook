/**
 * Dumps every AuditLog row for a site's password-gate attempts, raw —
 * for diagnosing why the Analytics UI might be showing fewer/different
 * entries than expected. Content-free (IPs are the point, but this is
 * read-only diagnostic output to the console, not published anywhere).
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/dumpPasswordLog.ts <siteSlug>
 */
import { prisma } from "../src/client";

async function main() {
  const siteSlug = process.argv[2];
  if (!siteSlug) throw new Error("Usage: tsx prisma/dumpPasswordLog.ts <siteSlug>");

  const site = await prisma.site.findUnique({ where: { slug: siteSlug } });
  if (!site) throw new Error(`No site with slug "${siteSlug}"`);
  console.log(`Site: ${site.name} (${site.id}), audienceMode=${site.audienceMode}`);

  const rows = await prisma.auditLog.findMany({
    where: { action: "site.passwordGateAttempt", targetId: site.id },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\nTotal AuditLog rows for this site's password attempts: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.createdAt.toISOString()}  ip=${r.ipAddress}  metadata=${JSON.stringify(r.metadata)}`);
  }

  // Also check: is there ANY AuditLog row at all with a different action
  // name that might indicate the logging call used a different string than
  // what the reader queries for (a typo/mismatch between write and read).
  const allActionsForSite = await prisma.auditLog.groupBy({
    by: ["action"],
    where: { targetId: site.id },
    _count: { _all: true },
  });
  console.log(`\nAll AuditLog action types targeting this site:`);
  for (const a of allActionsForSite) console.log(`  ${a.action}: ${a._count._all}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
