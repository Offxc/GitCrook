import { notFound } from "next/navigation";
import { prisma, type Site, type CustomDomain } from "@gitcrook/db";
import { getEnv } from "@gitcrook/shared/server";
import { requireOrgMembership } from "./org";

/** Resolves a Site scoped to its org, after confirming the caller is an org member. */
export async function requireSite(orgSlug: string, siteId: string) {
  const ctx = await requireOrgMembership(orgSlug);
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { customDomain: true } });
  if (!site || site.organizationId !== ctx.organization.id) notFound();
  return { ...ctx, site };
}

/** The live, published URL a site resolves at — same rule everywhere one is shown
 * (the site overview page, and every settings page's link back to the live site). */
export function publishedUrlFor(site: Site & { customDomain: CustomDomain | null }): string {
  const env = getEnv();
  return site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;
}
