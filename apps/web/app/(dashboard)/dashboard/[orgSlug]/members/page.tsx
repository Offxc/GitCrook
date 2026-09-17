import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { requireOrgMembership } from "@/lib/dashboard/org";
import { MembersTable } from "./MembersTable";
import { AddMemberForm } from "./AddMemberForm";

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgMembership(orgSlug);
  const canManage = await canUserDoX(ctx.userId, "org.manageMembers", { type: "org", id: ctx.organization.id });
  if (!canManage) notFound();

  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organization.id },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { role: "desc" },
  });

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <p className="text-sm text-ink-muted">
        <Link href={`/dashboard/${orgSlug}/sites`} className="hover:text-ink">
          ← {ctx.organization.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Members</h1>
      <p className="mt-1 text-sm text-ink-muted">Who has access to this organization, and at what role.</p>

      <div className="mt-6 rounded-xl border border-border bg-canvas p-5">
        <MembersTable orgSlug={orgSlug} memberships={memberships} currentUserId={ctx.userId} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-canvas p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">Add a member</h2>
        <p className="mb-3 text-xs text-ink-muted">They need to have signed in with Discord at least once before you can add them by email.</p>
        <AddMemberForm orgSlug={orgSlug} />
      </div>
    </div>
  );
}
