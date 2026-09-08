import { redirect } from "next/navigation";
import { prisma } from "@voiddocs/db";
import { getSessionUserId } from "@voiddocs/auth";

export default async function DashboardIndexPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  // Auto-provisioning on sign-up (see @voiddocs/auth's createUser event) means
  // this should always exist, but a user could theoretically end up with zero
  // memberships (e.g. their only org was deleted) — send them somewhere sane
  // rather than a dead end.
  if (!membership) redirect("/login");

  redirect(`/dashboard/${membership.organization.slug}/sites`);
}
