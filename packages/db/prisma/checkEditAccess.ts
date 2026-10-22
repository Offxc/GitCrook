/**
 * Diagnoses why canEdit might be false for a site's in-place editor:
 * prints the theme's showToolbarForMembers flag, and every Membership /
 * SitePermission row tied to the site's organization. Content-free.
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/checkEditAccess.ts <siteSlug>
 */
import { prisma } from "../src/client";

async function main() {
  const siteSlug = process.argv[2];
  if (!siteSlug) throw new Error("Usage: tsx prisma/checkEditAccess.ts <siteSlug>");

  const site = await prisma.site.findUnique({ where: { slug: siteSlug } });
  if (!site) throw new Error(`No site with slug "${siteSlug}"`);

  const theme = site.theme as Record<string, unknown>;
  console.log(`Site: ${site.name} (${site.id}), organizationId=${site.organizationId}`);
  console.log(`theme.showToolbarForMembers = ${JSON.stringify(theme?.showToolbarForMembers)}`);

  const memberships = await prisma.membership.findMany({
    where: { organizationId: site.organizationId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  console.log(`\nMemberships on organization ${site.organizationId}:`);
  if (memberships.length === 0) console.log("  (none — this is very likely the problem: no Membership row means canUserDoX denies by default)");
  for (const m of memberships) {
    console.log(`  role=${m.role}  user=${m.user.email} (${m.user.id})  name=${m.user.name ?? "—"}`);
  }

  const sitePerms = await prisma.sitePermission.findMany({ where: { siteId: site.id }, include: { user: { select: { email: true } } } });
  console.log(`\nSitePermission overrides on this site:`);
  if (sitePerms.length === 0) console.log("  (none)");
  for (const p of sitePerms) console.log(`  role=${p.role}  user=${p.user.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
