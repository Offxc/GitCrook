"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { connectSource, disconnectSource, parseRepositoryInput, parseRootDir, requestSync, setPaused, updateSource, GRACE_DAYS, POLL_INTERVAL, validBranch } from "@gitcrook/git-sync";
import { checkRateLimit } from "@gitcrook/shared/server";
import { requireSite } from "@/lib/dashboard/site";
import { gitSyncEnv } from "@/lib/gitSyncEnv";

export interface GitActionState {
  error?: string;
  /** Which form field the error is about. */
  field?: string;
  message?: string;
}

/** Everything here changes what a site publishes and stores a credential, so it is for people who manage the site. */
async function assertCanManage(orgSlug: string, siteId: string) {
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.manageSettings", { type: "site", id: ctx.site.id });
  if (!allowed) throw new Error("You don't have permission to manage this site's Git settings.");
  return ctx;
}

/** The source, if it is this site's: an id in a form is not proof that it belongs here. */
async function ownSource(siteId: string, sourceId: string) {
  const source = await prisma.gitSource.findUnique({ where: { id: sourceId }, select: { id: true, siteId: true, owner: true, repo: true, branch: true } });
  return source && source.siteId === siteId ? source : null;
}

const refresh = (orgSlug: string, siteId: string) => revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/git`);

const number = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().int().min(min).max(max).default(fallback));

const ConnectSchema = z.object({
  repository: z.string().max(500),
  variantId: z.string().min(1).max(40),
  branch: z.string().trim().max(200).optional(),
  rootDir: z.string().max(400).optional(),
  token: z.string().max(600).optional(),
  replace: z.string().optional(),
  pollIntervalSec: number(POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default),
});

export async function connectRepository(orgSlug: string, siteId: string, _prev: GitActionState, formData: FormData): Promise<GitActionState> {
  const { site, organization, userId } = await assertCanManage(orgSlug, siteId);
  // Each attempt makes requests to GitHub on the server's behalf.
  if (!checkRateLimit(`git-connect:${userId}`, 10, 60_000).allowed) return { error: "Too many attempts. Wait a minute and try again." };

  const parsed = ConnectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the form and try again." };
  const env = gitSyncEnv();

  const repository = parseRepositoryInput(parsed.data.repository, new URL(env.host.webBase).hostname);
  if (!repository.ok) return { error: repository.error, field: "repository" };
  const branch = parsed.data.branch || repository.value.branch || "";
  if (branch && !validBranch(branch)) return { error: "That is not a branch name Git Sync can use.", field: "branch" };
  const rootDir = parseRootDir(parsed.data.rootDir || repository.value.rootDir || "");
  if (!rootDir.ok) return { error: rootDir.error, field: "rootDir" };

  const result = await connectSource(
    { secrets: env.secrets, host: env.host },
    {
      organizationId: organization.id,
      siteId: site.id,
      variantId: parsed.data.variantId,
      owner: repository.value.owner,
      repo: repository.value.repo,
      branch,
      rootDir: rootDir.value,
      token: parsed.data.token,
      replaceExistingPages: parsed.data.replace === "on",
      createdById: userId,
      pollIntervalSec: parsed.data.pollIntervalSec,
    },
  );
  if (!result.ok) return { error: result.error, field: result.field };

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: userId,
      action: "gitSource.connect",
      targetType: "GitSource",
      targetId: result.sourceId,
      metadata: { repository: `${repository.value.owner}/${repository.value.repo}`, branch: branch || null, rootDir: rootDir.value, replacedPages: result.replaced, withToken: Boolean(parsed.data.token?.trim()) },
    },
  });
  refresh(orgSlug, siteId);
  return { message: "Connected. The first sync is queued; this page shows how it goes." };
}

export async function syncNow(orgSlug: string, siteId: string, sourceId: string, full: boolean): Promise<GitActionState> {
  const { organization, userId, site } = await assertCanManage(orgSlug, siteId);
  const source = await ownSource(site.id, sourceId);
  if (!source) return { error: "That repository is no longer connected." };
  if (!checkRateLimit(`git-sync-now:${sourceId}`, 6, 60_000).allowed) return { error: "That was just asked for. Give it a minute." };

  const result = await requestSync(sourceId, full);
  if (!result.ok) return { error: result.error };
  await prisma.auditLog.create({ data: { organizationId: organization.id, actorId: userId, action: full ? "gitSource.fullSync" : "gitSource.sync", targetType: "GitSource", targetId: sourceId, metadata: { repository: `${source.owner}/${source.repo}` } } });
  refresh(orgSlug, siteId);
  return { message: result.merged ? "A sync was already waiting; it will pick up the latest commit." : full ? "A full re-sync is queued." : "A sync is queued." };
}

export async function pauseSource(orgSlug: string, siteId: string, sourceId: string, paused: boolean): Promise<GitActionState> {
  const { organization, userId, site } = await assertCanManage(orgSlug, siteId);
  if (!(await ownSource(site.id, sourceId))) return { error: "That repository is no longer connected." };
  const result = await setPaused(sourceId, paused);
  if (!result.ok) return { error: result.error };
  await prisma.auditLog.create({ data: { organizationId: organization.id, actorId: userId, action: paused ? "gitSource.pause" : "gitSource.resume", targetType: "GitSource", targetId: sourceId } });
  refresh(orgSlug, siteId);
  return { message: paused ? "Paused. The site keeps what it has; nothing is synced until you resume." : "Resumed." };
}

const UpdateSchema = z.object({
  branch: z.string().trim().max(200),
  rootDir: z.string().max(400),
  token: z.string().max(600).optional(),
  removeToken: z.string().optional(),
  pollIntervalSec: number(POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default),
  deleteGraceDays: number(GRACE_DAYS.min, GRACE_DAYS.max, GRACE_DAYS.default),
});

export async function updateRepository(orgSlug: string, siteId: string, sourceId: string, _prev: GitActionState, formData: FormData): Promise<GitActionState> {
  const { organization, userId, site } = await assertCanManage(orgSlug, siteId);
  if (!(await ownSource(site.id, sourceId))) return { error: "That repository is no longer connected." };
  if (!checkRateLimit(`git-connect:${userId}`, 10, 60_000).allowed) return { error: "Too many attempts. Wait a minute and try again." };

  const parsed = UpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the form and try again." };
  const rootDir = parseRootDir(parsed.data.rootDir);
  if (!rootDir.ok) return { error: rootDir.error, field: "rootDir" };
  const env = gitSyncEnv();

  const newToken = parsed.data.token?.trim();
  const result = await updateSource({ secrets: env.secrets, host: env.host }, sourceId, {
    branch: parsed.data.branch,
    rootDir: rootDir.value,
    pollIntervalSec: parsed.data.pollIntervalSec,
    deleteGraceDays: parsed.data.deleteGraceDays,
    ...(parsed.data.removeToken === "on" ? { token: null } : newToken ? { token: newToken } : {}),
  });
  if (!result.ok) return { error: result.error, field: result.field };

  await prisma.auditLog.create({
    data: { organizationId: organization.id, actorId: userId, action: "gitSource.update", targetType: "GitSource", targetId: sourceId, metadata: { branch: parsed.data.branch, rootDir: rootDir.value, tokenChanged: Boolean(newToken) || parsed.data.removeToken === "on" } },
  });
  refresh(orgSlug, siteId);
  return { message: result.resync ? "Saved. A full re-sync is queued." : "Saved." };
}

export async function disconnectRepository(orgSlug: string, siteId: string, sourceId: string, keepPages: boolean): Promise<GitActionState> {
  const { organization, userId, site } = await assertCanManage(orgSlug, siteId);
  const source = await ownSource(site.id, sourceId);
  if (!source) return { error: "That repository is no longer connected." };

  // Logged first: removing the pages is the part that cannot be undone.
  await prisma.auditLog.create({
    data: { organizationId: organization.id, actorId: userId, action: "gitSource.disconnect", targetType: "GitSource", targetId: sourceId, metadata: { repository: `${source.owner}/${source.repo}`, keptPages: keepPages } },
  });
  const result = await disconnectSource(sourceId, keepPages ? "keep-pages" : "delete-pages");
  if (!result.ok) return { error: result.error };
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  refresh(orgSlug, siteId);
  return { message: keepPages ? `Disconnected. ${result.pages} page${result.pages === 1 ? "" : "s"} stay on the site as ordinary pages you can edit.` : `Disconnected, and ${result.pages} page${result.pages === 1 ? "" : "s"} removed.` };
}
