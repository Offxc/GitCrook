"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { requireSite } from "@/lib/dashboard/site";

export interface RedirectActionState {
  error?: string;
}

async function assertCanManage(orgSlug: string, siteId: string) {
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.manageSettings", { type: "site", id: ctx.site.id });
  if (!allowed) throw new Error("You don't have permission to manage this site's redirects.");
  return ctx;
}

const PathSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^\/+/, ""))
  .pipe(z.string().max(2048));

export async function createRedirect(orgSlug: string, siteId: string, _prev: RedirectActionState, formData: FormData): Promise<RedirectActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  const fromPath = PathSchema.safeParse(formData.get("fromPath"));
  const toPath = PathSchema.safeParse(formData.get("toPath"));
  if (!fromPath.success || !toPath.success) return { error: "Enter both paths (e.g. old-page, new-page)." };
  if (fromPath.data === toPath.data) return { error: "The two paths can't be the same." };

  const existing = await prisma.siteRedirect.findUnique({ where: { siteId_fromPath: { siteId: ctx.site.id, fromPath: fromPath.data } } });
  if (existing) return { error: `A redirect from "${fromPath.data}" already exists.` };

  await prisma.siteRedirect.create({ data: { siteId: ctx.site.id, fromPath: fromPath.data, toPath: toPath.data } });
  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.createRedirect", targetType: "Site", targetId: ctx.site.id, metadata: { fromPath: fromPath.data, toPath: toPath.data } },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/analytics`);
  return {};
}

export async function deleteRedirect(orgSlug: string, siteId: string, redirectId: string): Promise<RedirectActionState> {
  const ctx = await assertCanManage(orgSlug, siteId);
  await prisma.siteRedirect.delete({ where: { id: redirectId, siteId: ctx.site.id } });
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/analytics`);
  return {};
}
