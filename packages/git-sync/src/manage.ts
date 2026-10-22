import { prisma, Prisma } from "@gitcrook/db";
import { SecretBox } from "@gitcrook/shared/server";
import { createTokenCredential, resolveCredential, updateCredential } from "./credentials";
import { GitHubClient, type FetchLike } from "./github/client";
import { GitHostError } from "./github/errors";
import type { HostConfig } from "./config";
import { GRACE_DAYS, POLL_INTERVAL, validBranch, validOwner, validRepo } from "./input";
import { enqueueRun } from "./queue";
import { findRootTree } from "./tree";

/**
 * What connecting, changing and disconnecting a source mean. The dashboard's server actions check who is asking and
 * record it in the audit log; the rules about the data live here, where they can be tested.
 */

export const MAX_SOURCES_PER_ORGANIZATION = 20;

export interface ManageDeps {
  secrets: SecretBox | null;
  host: HostConfig;
  /** Replaces the network, for tests. */
  fetch?: FetchLike;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; field?: string };
const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, ...(field ? { field } : {}) });

const clientFor = (deps: ManageDeps, token: string | null) => new GitHubClient({ getToken: () => token, fetch: deps.fetch, apiBase: deps.host.apiBase, allowedHosts: deps.host.allowedHosts, retries: 1, maxWaitMs: 5_000 });

/** What the form says went wrong, in words for the person filling it in. */
function explain(error: unknown, subject: string): string {
  if (error instanceof GitHostError) return error.message;
  return `${subject} could not be checked. Try again in a moment.`;
}

export interface ConnectInput {
  organizationId: string;
  siteId: string;
  variantId: string;
  owner: string;
  repo: string;
  /** Empty means the repository's default branch. */
  branch?: string;
  rootDir: string;
  /** A fine-grained token with read access to the repository; none for a public repository. */
  token?: string;
  /** The variant already has pages: replace them with the repository's. */
  replaceExistingPages: boolean;
  createdById: string | null;
  pollIntervalSec?: number;
  deleteGraceDays?: number;
}

export async function connectSource(deps: ManageDeps, input: ConnectInput): Promise<Result<{ sourceId: string; runId: string | null; replaced: number }>> {
  if (!validOwner(input.owner)) return fail("That is not a valid account name.", "repository");
  if (!validRepo(input.repo)) return fail("That is not a valid repository name.", "repository");
  if (input.branch && !validBranch(input.branch)) return fail("That is not a branch name Git Sync can use.", "branch");

  // The variant must belong to this site: a form field is not proof of it.
  const variant = await prisma.variant.findUnique({ where: { id: input.variantId }, select: { id: true, name: true, space: { select: { section: { select: { siteId: true } } } }, gitSource: { select: { id: true } } } });
  if (!variant || variant.space.section.siteId !== input.siteId) return fail("Choose one of this site's versions.", "variant");
  if (variant.gitSource) return fail(`"${variant.name}" is already connected to a repository.`, "variant");

  if ((await prisma.gitSource.count({ where: { organizationId: input.organizationId } })) >= MAX_SOURCES_PER_ORGANIZATION) {
    return fail(`An organization can connect up to ${MAX_SOURCES_PER_ORGANIZATION} repositories.`);
  }

  const existing = await prisma.page.findMany({ where: { variantId: variant.id, deletedAt: null }, select: { title: true }, take: 6 });
  const existingCount = await prisma.page.count({ where: { variantId: variant.id } });
  if (existingCount > 0 && !input.replaceExistingPages) {
    const names = existing.slice(0, 5).map((p) => `"${p.title}"`).join(", ");
    return fail(`"${variant.name}" already has ${existingCount} page${existingCount === 1 ? "" : "s"} (${names}${existingCount > 5 ? ", …" : ""}). A repository takes over a whole version, so those would have to be deleted. Tick the box to replace them, or choose another version.`, "replace");
  }

  const token = input.token?.trim() || null;
  if (token && !deps.secrets) return fail("Saving an access token needs GIT_SYNC_ENCRYPTION_KEY to be set on the server. Connect a public repository without a token, or ask whoever runs the server to set it.", "token");
  if (token && (token.length < 8 || token.length > 512 || /\s/.test(token))) return fail("That does not look like an access token.", "token");

  // Check it can be read before anything is changed.
  const client = clientFor(deps, token);
  let branch = input.branch?.trim() || "";
  try {
    if (!branch) branch = (await client.getRepo(input.owner, input.repo)).defaultBranch;
    const head = await client.getBranch(input.owner, input.repo, branch);
    if (head.notModified) return fail("GitHub's answer could not be read.");
    if (input.rootDir) await findRootTree(client, input.owner, input.repo, head.treeSha, input.rootDir, branch);
  } catch (error) {
    return fail(explain(error, `${input.owner}/${input.repo}`), error instanceof GitHostError && error.code === "GS-303" ? "token" : "repository");
  }

  const credential = token && deps.secrets ? await createTokenCredential(deps.secrets, { organizationId: input.organizationId, token, label: `${input.owner}/${input.repo}`, createdById: input.createdById }) : null;
  let sourceId: string;
  try {
    sourceId = await prisma.$transaction(async (tx) => {
      if (existingCount > 0) await tx.page.deleteMany({ where: { variantId: variant.id } });
      const source = await tx.gitSource.create({
        data: {
          organizationId: input.organizationId,
          siteId: input.siteId,
          variantId: variant.id,
          owner: input.owner,
          repo: input.repo,
          branch,
          rootDir: input.rootDir,
          credentialId: credential?.id ?? null,
          pollIntervalSec: clamp(input.pollIntervalSec ?? POLL_INTERVAL.default, POLL_INTERVAL.min, POLL_INTERVAL.max),
          deleteGraceDays: clamp(input.deleteGraceDays ?? GRACE_DAYS.default, GRACE_DAYS.min, GRACE_DAYS.max),
          createdById: input.createdById,
        },
        select: { id: true },
      });
      return source.id;
    });
  } catch (error) {
    if (credential) await prisma.gitCredential.deleteMany({ where: { id: credential.id } });
    throw error;
  }

  const queued = await enqueueRun(sourceId, { trigger: "MANUAL" });
  return { ok: true, sourceId, runId: queued.kind === "duplicate" ? null : queued.runId, replaced: existingCount };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

export interface UpdateInput {
  branch?: string;
  rootDir?: string;
  pollIntervalSec?: number;
  deleteGraceDays?: number;
  /** A new token, or `null` to remove the saved one. Leave out to keep it. */
  token?: string | null;
}

/** Changes a source's settings. A different branch or docs directory is a different tree of files, so it starts a full sync. */
export async function updateSource(deps: ManageDeps, sourceId: string, input: UpdateInput): Promise<Result<{ resync: boolean }>> {
  const source = await prisma.gitSource.findUnique({ where: { id: sourceId }, select: { id: true, owner: true, repo: true, branch: true, rootDir: true, organizationId: true, credentialId: true, createdById: true } });
  if (!source) return fail("That repository is no longer connected.");

  const data: Record<string, unknown> = {};
  let resync = false;

  if (input.branch !== undefined && input.branch !== source.branch) {
    if (!validBranch(input.branch)) return fail("That is not a branch name Git Sync can use.", "branch");
    data.branch = input.branch;
    resync = true;
  }
  if (input.rootDir !== undefined && input.rootDir !== source.rootDir) {
    data.rootDir = input.rootDir;
    resync = true;
  }
  if (input.pollIntervalSec !== undefined) data.pollIntervalSec = clamp(input.pollIntervalSec, POLL_INTERVAL.min, POLL_INTERVAL.max);
  if (input.deleteGraceDays !== undefined) data.deleteGraceDays = clamp(input.deleteGraceDays, GRACE_DAYS.min, GRACE_DAYS.max);

  const token: string | null | undefined = input.token === undefined ? undefined : input.token === null ? null : input.token.trim();
  if (token !== undefined && token !== null) {
    if (!deps.secrets) return fail("Saving an access token needs GIT_SYNC_ENCRYPTION_KEY to be set on the server.", "token");
    if (token.length < 8 || token.length > 512 || /\s/.test(token)) return fail("That does not look like an access token.", "token");
  }

  // Whatever changes, the new settings have to reach the repository, so check them with the token they will use.
  if (resync || token !== undefined) {
    const branch = (data.branch as string | undefined) ?? source.branch;
    const rootDir = (data.rootDir as string | undefined) ?? source.rootDir;
    let useToken: string | null = null;
    if (token) useToken = token;
    else if (token === undefined && source.credentialId && deps.secrets) {
      useToken = (await resolveCredential(source.credentialId, deps.secrets).catch(() => null))?.getToken() ?? null;
    }
    try {
      const head = await clientFor(deps, useToken).getBranch(source.owner, source.repo, branch);
      if (head.notModified) return fail("GitHub's answer could not be read.");
      if (rootDir) await findRootTree(clientFor(deps, useToken), source.owner, source.repo, head.treeSha, rootDir, branch);
    } catch (error) {
      return fail(explain(error, `${source.owner}/${source.repo}`), error instanceof GitHostError && error.code === "GS-303" ? "token" : "branch");
    }
  }

  if (token === null && source.credentialId) {
    data.credentialId = null;
    resync = true;
  } else if (token && deps.secrets) {
    if (source.credentialId) await updateCredential(deps.secrets, source.credentialId, token);
    else {
      const created = await createTokenCredential(deps.secrets, { organizationId: source.organizationId, token, label: `${source.owner}/${source.repo}`, createdById: source.createdById });
      data.credentialId = created.id;
    }
    resync = true;
  }

  if (resync) {
    data.lastSyncedSha = null; // the next run reads the whole tree
    data.etag = null;
    data.status = "IDLE";
    data.lastError = null;
  }
  await prisma.gitSource.update({ where: { id: sourceId }, data });
  if (token === null && source.credentialId) await removeCredentialIfUnused(source.credentialId);
  if (resync) await enqueueRun(sourceId, { trigger: "FULL" });
  return { ok: true, resync };
}

export type DisconnectMode =
  /** The pages stay, as ordinary pages the editor can change. */
  | "keep-pages"
  /** The pages go with the connection. */
  | "delete-pages";

export async function disconnectSource(sourceId: string, mode: DisconnectMode): Promise<Result<{ pages: number }>> {
  const source = await prisma.gitSource.findUnique({ where: { id: sourceId }, select: { id: true, variantId: true, credentialId: true } });
  if (!source) return fail("That repository is no longer connected.");

  const pages = await prisma.$transaction(async (tx) => {
    // The sync's own transaction takes this lock, so a run that is applying right now finishes first.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.id}))`;
    let count: number;
    if (mode === "delete-pages") {
      count = (await tx.page.deleteMany({ where: { sourceId: source.id } })).count;
    } else {
      // Pages that were waiting out their grace period were already gone from the site; they go now.
      await tx.page.deleteMany({ where: { sourceId: source.id, deletedAt: { not: null } } });
      count = (
        await tx.page.updateMany({
          where: { sourceId: source.id },
          data: { managedBy: "EDITOR", sourcePath: null, sourceBlobSha: null, frontMatterId: null, sourceMeta: Prisma.DbNull },
        })
      ).count;
      // Groups and generated pages were Git Sync's own bookkeeping; as ordinary pages they are fine, but they
      // have no file behind them any more.
    }
    await tx.gitSource.delete({ where: { id: source.id } });
    return count;
  });
  if (source.credentialId) await removeCredentialIfUnused(source.credentialId);
  return { ok: true, pages };
}

async function removeCredentialIfUnused(credentialId: string) {
  const inUse = await prisma.gitSource.count({ where: { credentialId } });
  if (inUse === 0) await prisma.gitCredential.deleteMany({ where: { id: credentialId } });
}

/** Asks for a sync now. Several requests in a row collapse into one run. */
export async function requestSync(sourceId: string, full: boolean): Promise<Result<{ runId: string; merged: boolean }>> {
  const source = await prisma.gitSource.findUnique({ where: { id: sourceId }, select: { id: true } });
  if (!source) return fail("That repository is no longer connected.");
  const queued = await enqueueRun(sourceId, { trigger: full ? "FULL" : "MANUAL" });
  if (queued.kind === "duplicate") return fail("That request was already handled.");
  return { ok: true, runId: queued.runId, merged: queued.kind === "merged" };
}

export async function setPaused(sourceId: string, paused: boolean): Promise<Result<object>> {
  const result = await prisma.gitSource.updateMany({ where: { id: sourceId, ...(paused ? { status: { not: "PAUSED" as const } } : { status: "PAUSED" as const }) }, data: { status: paused ? "PAUSED" : "IDLE", ...(paused ? {} : { lastCheckedAt: null }) } });
  return result.count === 0 ? fail(paused ? "It is already paused." : "It is not paused.") : { ok: true };
}
