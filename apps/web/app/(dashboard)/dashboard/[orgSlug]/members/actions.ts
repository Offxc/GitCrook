"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, Role } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { requireOrgMembership } from "@/lib/dashboard/org";

export interface MemberActionState {
  error?: string;
}

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
    return { error: `No account found for ${email.data} yet — they need to sign in with Discord once first, then you can add them.` };
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

  await prisma.membership.delete({ where: { id: membershipId } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "member.remove", targetType: "User", targetId: membership.userId },
  });

  revalidatePath(`/dashboard/${orgSlug}/members`);
  return {};
}
