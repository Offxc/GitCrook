"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@gitcrook/db";
import { canUserDoX, getSessionUserId } from "@gitcrook/auth";
import { extractPlainText } from "@/lib/editor/extractText";
import { toJsonSafe } from "@/lib/editor/jsonSafe";
import { commitPageContent } from "@/lib/pages/commitPageContent";
import { MANAGED_PAGE_ERROR } from "@/lib/pages/managed";

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

  const current = await prisma.page.findUnique({ where: { id: pageId }, select: { contentVersion: true, managedBy: true } });
  if (!current) notFound();
  if (current.managedBy === "GIT") return { ok: false, error: MANAGED_PAGE_ERROR };

  const conflict = (contentVersion: number): SaveResult => ({
    ok: false,
    conflict: true,
    contentVersion,
    error: "This page changed elsewhere — reload to see the latest version before saving again.",
  });
  if (current.contentVersion !== expectedVersion) return conflict(current.contentVersion);

  const safeContent = toJsonSafe(content);

  // Throttled snapshot, not one-per-autosave: at 800ms-debounced keystrokes
  // that would be hundreds of rows per editing session. A restore point
  // roughly every VERSION_SNAPSHOT_INTERVAL_MS of active editing is a
  // reasonable checkpoint cadence without needing a dedicated history job.
  const lastVersion = await prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const dueForSnapshot = !lastVersion || Date.now() - lastVersion.createdAt.getTime() > VERSION_SNAPSHOT_INTERVAL_MS;

  const updated = await commitPageContent({
    pageId,
    expectedVersion,
    content: safeContent as object,
    contentText: extractPlainText(content),
    userId,
    snapshot: dueForSnapshot,
  });

  if (updated === null) {
    const latest = await prisma.page.findUnique({ where: { id: pageId }, select: { contentVersion: true } });
    if (!latest) notFound();
    return conflict(latest.contentVersion);
  }

  return { ok: true, contentVersion: updated };
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

  const target = await prisma.page.findUnique({ where: { id: pageId }, select: { managedBy: true } });
  if (target?.managedBy === "GIT") return { ok: false, error: MANAGED_PAGE_ERROR };

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

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true, managedBy: true } });
  if (!page || page.siteId !== siteId) return { ok: false, error: "Page not found." };
  if (page.managedBy === "GIT") return { ok: false, error: MANAGED_PAGE_ERROR };

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

export interface PageChildCountResult {
  ok: boolean;
  childCount?: number;
  error?: string;
}

/** So a delete confirmation can warn about cascaded descendants before committing — used by both the dashboard's DeletePageButton and the live sidebar's, which each need it before their own confirm step. Same content.edit gate as deletePage itself: a child count is structural information about the page tree, not something to hand to any signed-in user regardless of their access to this site. */
export async function getPageChildCount(siteId: string, pageId: string): Promise<PageChildCountResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true } });
  if (!page || page.siteId !== siteId) return { ok: false, error: "Page not found." };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to view this page." };

  const childCount = await prisma.page.count({ where: { parentId: pageId } });
  return { ok: true, childCount };
}

export interface DeletePageResult {
  ok: boolean;
  error?: string;
  /** Only ever the dashboard's own page-list route — the live sidebar's delete button knows its own site URL to send the visitor back to instead of using this. */
  redirectTo?: string;
}

/** Page.parentId is onDelete: Cascade (packages/db/prisma/schema.prisma), so this also removes every descendant in the page tree — the caller is expected to have already warned about that via getPageChildCount before calling this. */
export async function deletePage(orgSlug: string, siteId: string, pageId: string): Promise<DeletePageResult> {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, error: "Unauthorized" };

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true, title: true, slug: true, isGroup: true, managedBy: true, site: { select: { organizationId: true } } } });
  if (!page || page.siteId !== siteId) return { ok: false, error: "Page not found." };
  if (page.managedBy === "GIT") return { ok: false, error: MANAGED_PAGE_ERROR };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { ok: false, error: "You don't have permission to delete this page." };

  // Logged first: the delete cascades to the page's subpages, history and comments, so
  // this is the only record of what was removed and by whom.
  await prisma.auditLog.create({
    data: {
      organizationId: page.site.organizationId,
      actorId: userId,
      action: page.isGroup ? "pageGroup.delete" : "page.delete",
      targetType: "Page",
      targetId: pageId,
      metadata: { title: page.title, slug: page.slug },
    },
  });
  await prisma.page.delete({ where: { id: pageId } });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { ok: true, redirectTo: `/dashboard/${orgSlug}/sites/${siteId}` };
}
