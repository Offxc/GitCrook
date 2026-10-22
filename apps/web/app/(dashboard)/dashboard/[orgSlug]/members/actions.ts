"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, Role } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { requireOrgMembership } from "@/lib/dashboard/org";

export interface MemberActionState {
  error?: string;
  /** A success message worth showing (e.g. "invited") for a result that isn't just "done". */
  notice?: string;
}

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function assertCanManage(orgSlug: string) {
  const ctx = await requireOrgMembership(orgSlug);
  const allowed = await canUserDoX(ctx.userId, "org.manageMembers", { type: "org", id: ctx.organization.id });
  if (!allowed) throw new Error("You don't have permission to manage this organization's members.");
  return ctx;
}

const RoleSchema = z.enum(Object.keys(Role) as [string, ...string[]]);

export async function addMember(orgSlug: string, _prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const ctx = await assertCanManage(orgSlug);
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  const role = RoleSchema.safeParse(formData.get("role"));
  if (!email.success) return { error: "Enter a valid email address." };
  if (!role.success) return { error: "Invalid role." };

  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (!user) {
    // Sign-up is closed by default, so "sign in once first" is no longer something an
    // outsider can do. An invitation is what lets them create an account: when they
    // sign in with a verified Discord email matching this one, they join with this role.
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await prisma.invitation.upsert({
      where: { organizationId_email: { organizationId: ctx.organization.id, email: email.data } },
      create: { organizationId: ctx.organization.id, email: email.data, role: role.data as Role, invitedById: ctx.userId, expiresAt },
      update: { role: role.data as Role, invitedById: ctx.userId, expiresAt },
    });
    await prisma.auditLog.create({
      data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.invite", targetType: "Invitation", targetId: email.data, metadata: { role: role.data } },
    });
    revalidatePath(`/dashboard/${orgSlug}/members`);
    return {
      notice: `Invited ${email.data}. They can sign in with Discord using a verified email address of ${email.data} and will join as ${role.data}. The invitation expires in 14 days.`,
    };
  }

  const existing = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: ctx.organization.id, userId: user.id } } });
  if (existing) return { error: "Already a member." };

  await prisma.membership.create({ data: { organizationId: ctx.organization.id, userId: user.id, role: role.data as Role } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.add", targetType: "User", targetId: user.id, metadata: { role: role.data } },
  });

  revalidatePath(`/dashboard/${orgSlug}/members`);
  return {};
}

export async function updateMemberRole(orgSlug: string, membershipId: string, role: string): Promise<MemberActionState> {
  const ctx = await assertCanManage(orgSlug);
  const parsed = RoleSchema.safeParse(role);
  if (!parsed.success) return { error: "Invalid role." };

  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.organizationId !== ctx.organization.id) return { error: "Membership not found." };

  if (membership.userId === ctx.userId && parsed.data !== "ADMIN") {
    const adminCount = await prisma.membership.count({ where: { organizationId: ctx.organization.id, role: "ADMIN" } });
    if (adminCount <= 1) return { error: "You're the only admin — promote someone else first." };
  }

  await prisma.membership.update({ where: { id: membershipId }, data: { role: parsed.data as Role } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.updateRole", targetType: "User", targetId: membership.userId, metadata: { role: parsed.data } },
  });

  revalidatePath(`/dashboard/${orgSlug}/members`);
  return {};
}

export async function removeMember(orgSlug: string, membershipId: string): Promise<MemberActionState> {
  const ctx = await assertCanManage(orgSlug);
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.organizationId !== ctx.organization.id) return { error: "Membership not found." };

  if (membership.userId === ctx.userId) {
    const adminCount = await prisma.membership.count({ where: { organizationId: ctx.organization.id, role: "ADMIN" } });
    if (membership.role === "ADMIN" && adminCount <= 1) return { error: "You're the only admin — promote someone else before leaving." };
  }

  // Per-resource role overrides are consulted before org membership and don't require
  // it, so removing only the membership would leave whatever site, section, space or
  // page access this person had been granted. Remove them with it.
  const orgSites = { site: { organizationId: ctx.organization.id } };
  await prisma.$transaction([
    prisma.membership.delete({ where: { id: membershipId } }),
    prisma.sitePermission.deleteMany({ where: { userId: membership.userId, ...orgSites } }),
    prisma.sectionPermission.deleteMany({ where: { userId: membership.userId, section: orgSites } }),
    prisma.spacePermission.deleteMany({ where: { userId: membership.userId, space: { section: orgSites } } }),
    prisma.pagePermission.deleteMany({ where: { userId: membership.userId, page: orgSites } }),
  ]);
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.remove", targetType: "User", targetId: membership.userId },
  });

  revalidatePath(`/dashboard/${orgSlug}/members`);
  return {};
}

export async function revokeInvitation(orgSlug: string, invitationId: string): Promise<MemberActionState> {
  const ctx = await assertCanManage(orgSlug);
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation || invitation.organizationId !== ctx.organization.id) return { error: "Invitation not found." };

  await prisma.invitation.delete({ where: { id: invitationId } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.revokeInvitation", targetType: "Invitation", targetId: invitation.email },
  });

  revalidatePath(`/dashboard/${orgSlug}/members`);
  return {};
}
