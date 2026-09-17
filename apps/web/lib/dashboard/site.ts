import { notFound } from "next/navigation";
import { prisma } from "@gitcrook/db";
import { requireOrgMembership } from "./org";

/** Resolves a Site scoped to its org, after confirming the caller is an org member. */
export async function requireSite(orgSlug: string, siteId: string) {
  const ctx = await requireOrgMembership(orgSlug);
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { customDomain: true } });
  if (!site || site.organizationId !== ctx.organization.id) notFound();
  return { ...ctx, site };
}
