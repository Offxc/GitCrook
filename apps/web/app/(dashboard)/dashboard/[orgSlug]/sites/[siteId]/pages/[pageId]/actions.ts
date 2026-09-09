"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@voiddocs/db";
import { canUserDoX, getSessionUserId } from "@voiddocs/auth";
import { extractPlainText } from "@/lib/editor/extractText";

export interface SaveResult {
  ok: boolean;
  conflict?: boolean;
  contentVersion?: number;
  error?: string;
}

export async function savePageContent(pageId: string, expectedVersion: number, content: unknown): Promise<SaveResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to edit this page." };

  const current = await prisma.page.findUnique({ where: { id: pageId }, select: { contentVersion: true } });
  if (!current) notFound();

  if (current.contentVersion !== expectedVersion) {
    return { ok: false, conflict: true, contentVersion: current.contentVersion, error: "This page changed elsewhere — reload to see the latest version before saving again." };
  }

  // Throttled snapshot, not one-per-autosave: at 800ms-debounced keystrokes
  // that would be hundreds of rows per editing session. A restore point
  // roughly every VERSION_SNAPSHOT_INTERVAL_MS of active editing is a
  // reasonable checkpoint cadence without needing a dedicated history job.
  const lastVersion = await prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const dueForSnapshot = !lastVersion || Date.now() - lastVersion.createdAt.getTime() > VERSION_SNAPSHOT_INTERVAL_MS;

  const updated = await prisma.$transaction(async (tx) => {
    if (dueForSnapshot) {
      const before = await tx.page.findUnique({ where: { id: pageId }, select: { content: true, contentVersion: true } });
      if (before) await tx.pageVersion.create({ data: { pageId, content: before.content as object, version: before.contentVersion, createdById: userId } });
    }
    return tx.page.update({
      where: { id: pageId },
      data: {
        content: content as object,
        contentText: extractPlainText(content),
        contentVersion: { increment: 1 },
      },
      select: { contentVersion: true },
    });
  });

  return { ok: true, contentVersion: updated.contentVersion };
}

const VERSION_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

/** Restoring is itself snapshotted first (unconditionally, bypassing the throttle above) — so undoing a bad restore is just restoring the snapshot that was just taken, never a dead end. */
export async function restorePageVersion(pageId: string, versionId: string): Promise<RestoreResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to edit this page." };

  const version = await prisma.pageVersion.findUnique({ where: { id: versionId } });
  if (!version || version.pageId !== pageId) return { ok: false, error: "Version not found." };

  await prisma.$transaction(async (tx) => {
    const current = await tx.page.findUnique({ where: { id: pageId }, select: { content: true, contentVersion: true } });
    if (!current) return;
    await tx.pageVersion.create({ data: { pageId, content: current.content as object, version: current.contentVersion, createdById: userId } });
    await tx.page.update({
      where: { id: pageId },
      data: { content: version.content as object, contentText: extractPlainText(version.content), contentVersion: { increment: 1 } },
    });
  });

  return { ok: true };
}

export interface UpdatePageIconResult {
  ok: boolean;
  error?: string;
}

export async function updatePageIcon(orgSlug: string, siteId: string, pageId: string, icon: string | null): Promise<UpdatePageIconResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true } });
  if (!page || page.siteId !== siteId) return { ok: false, error: "Page not found." };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to edit this page." };

  // Stores a slug into the flat icon set now (see lib/editor/pageIcons.ts),
  // e.g. "clock-counter-clockwise" — longer than an emoji character, but
  // still bounded; 40 is generous headroom over the longest slug that set
  // actually has, without accepting arbitrary-length input here.
  if (icon !== null && icon.length > 40) return { ok: false, error: "Invalid icon." };

  await prisma.page.update({ where: { id: pageId }, data: { icon } });
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/pages/${pageId}`);
  return { ok: true };
}

export interface DeletePageResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

/** Page.parentId is onDelete: Cascade (packages/db/prisma/schema.prisma), so this also removes every descendant in the page tree — the caller is expected to have already warned about that (see the child count this returns nothing about; DeletePageButton fetches it separately before showing the confirm step). */
export async function deletePage(orgSlug: string, siteId: string, pageId: string): Promise<DeletePageResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true } });
  if (!page || page.siteId !== siteId) return { ok: false, error: "Page not found." };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to delete this page." };

  await prisma.page.delete({ where: { id: pageId } });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { ok: true, redirectTo: `/dashboard/${orgSlug}/sites/${siteId}` };
}
