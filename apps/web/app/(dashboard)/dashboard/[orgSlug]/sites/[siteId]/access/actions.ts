"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX, hashSitePassword } from "@gitcrook/auth";
import { requireSite } from "@/lib/dashboard/site";

export interface AccessActionState {
  error?: string;
}

async function assertCanManage(orgSlug: string, siteId: string) {
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.manageSettings", { type: "site", id: ctx.site.id });
  if (!allowed) throw new Error("You don't have permission to manage this site's access settings.");
  return ctx;
}

const AudienceModeSchema = z.enum(["PUBLIC", "PRIVATE", "PASSWORD"]);

export async function updateAudienceMode(orgSlug: string, siteId: string, _prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const parsed = AudienceModeSchema.safeParse(formData.get("audienceMode"));
  if (!parsed.success) return { error: "Invalid audience mode." };

  if (parsed.data === "PASSWORD") {
    const hasPassword = await prisma.sitePassword.findUnique({ where: { siteId: ctx.site.id } });
    if (!hasPassword) return { error: "Set a password above before switching to password-protected." };
  }

  await prisma.site.update({ where: { id: ctx.site.id }, data: { audienceMode: parsed.data } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.setAudienceMode", targetType: "Site", targetId: ctx.site.id, metadata: { mode: parsed.data } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/access`);
  return {};
}

const PasswordSchema = z.string().min(4, "Password must be at least 4 characters").max(200);

export async function setSitePassword(orgSlug: string, siteId: string, _prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const parsed = PasswordSchema.safeParse(formData.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password." };

  const passwordHash = await hashSitePassword(parsed.data);
  await prisma.sitePassword.upsert({
    where: { siteId: ctx.site.id },
    create: { siteId: ctx.site.id, passwordHash },
    update: { passwordHash },
  });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.setPassword", targetType: "Site", targetId: ctx.site.id },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/access`);
  return {};
}

export async function createShareLink(orgSlug: string, siteId: string, _prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const label = formData.get("label");
  const expiresInDays = Number(formData.get("expiresInDays") ?? 0);

  await prisma.shareLink.create({
    data: {
      siteId: ctx.site.id,
      token: randomBytes(16).toString("hex"),
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, 100) : null,
      createdById: ctx.userId,
      expiresAt: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    },
  });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.createShareLink", targetType: "Site", targetId: ctx.site.id },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/access`);
  return {};
}

export async function revokeShareLink(orgSlug: string, siteId: string, linkId: string): Promise<AccessActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  await prisma.shareLink.update({ where: { id: linkId, siteId: ctx.site.id }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.revokeShareLink", targetType: "Site", targetId: ctx.site.id, metadata: { linkId } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/access`);
  return {};
}
