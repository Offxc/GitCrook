import { notFound, redirect } from "next/navigation";
import { prisma, type Role } from "@gitcrook/db";
import { getSessionUserId } from "@gitcrook/auth";

export interface OrgContext {
  organization: { id: string; name: string; slug: string };
  role: Role;
  userId: string;
}

/**
 * Every /dashboard/[orgSlug]/** page calls this first. It re-derives the
 * membership from the session + a fresh DB lookup (never trusts the orgSlug
 * URL segment alone) — OWASP A01: a org slug in the URL is not authorization.
 */
export async function requireOrgMembership(orgSlug: string): Promise<OrgContext> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const organization = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!organization) notFound();

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: organization.id, userId } },
  });
  if (!membership) notFound(); // deny by default — no membership row, no access, no leak of the org's existence via a 403 vs 404 distinction

  return { organization, role: membership.role, userId };
}
