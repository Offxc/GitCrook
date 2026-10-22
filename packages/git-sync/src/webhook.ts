import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@gitcrook/db";
import { enqueueRun, type Enqueued } from "./queue";

/** GitHub's webhook payloads can reach 25 MB; the signature covers all of it, so all of it has to be read before anything is trusted. */
export const MAX_WEBHOOK_BYTES = 26 * 1024 * 1024;

/**
 * Checks `X-Hub-Signature-256` against the raw body. The comparison takes the same time whatever the guess, and a
 * missing, malformed or wrong-length header is simply false: nothing about why is revealed.
 */
export function verifyGitHubSignature(secret: string, rawBody: Uint8Array, header: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface PushEvent {
  owner: string;
  repo: string;
  branch: string;
  /** The commit the branch points at after the push; empty when the branch was deleted. */
  after: string;
  deleted: boolean;
}

/** The parts of a `push` payload Git Sync uses, or null if it is not one it can use. Tolerates anything. */
export function parsePushEvent(body: unknown): PushEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { ref?: unknown; after?: unknown; deleted?: unknown; repository?: { name?: unknown; owner?: { login?: unknown; name?: unknown } } };
  if (typeof b.ref !== "string" || !b.ref.startsWith("refs/heads/")) return null; // tags and the like
  const repo = b.repository;
  const owner = typeof repo?.owner?.login === "string" ? repo.owner.login : typeof repo?.owner?.name === "string" ? repo.owner.name : null;
  if (!owner || typeof repo?.name !== "string") return null;
  return { owner, repo: repo.name, branch: b.ref.slice("refs/heads/".length), after: typeof b.after === "string" && /^[0-9a-f]{40}$/i.test(b.after) ? b.after.toLowerCase() : "", deleted: b.deleted === true };
}

export interface WebhookResult {
  status: 200 | 202 | 400 | 401 | 413 | 503;
  body: { ok?: true; queued?: number; ignored?: string; error?: string };
}

/**
 * Everything a webhook request means, given its raw body and headers. The route is a thin wrapper around this so the
 * rules can be tested without HTTP.
 */
export async function handleGitHubWebhook(input: { secret: string | undefined; rawBody: Uint8Array; signature: string | null; event: string | null; delivery: string | null }): Promise<WebhookResult> {
  if (!input.secret) return { status: 503, body: { error: "Webhooks are not configured on this server." } };
  if (input.rawBody.byteLength > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "Payload too large." } };
  if (!verifyGitHubSignature(input.secret, input.rawBody, input.signature)) return { status: 401, body: { error: "Invalid signature." } };

  if (input.event === "ping") return { status: 200, body: { ok: true } };
  if (input.event !== "push") return { status: 200, body: { ok: true, ignored: `${input.event ?? "unknown"} events are not used` } };

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
  } catch {
    return { status: 400, body: { error: "The payload is not JSON." } };
  }
  const push = parsePushEvent(json);
  if (!push) return { status: 200, body: { ok: true, ignored: "not a push to a branch" } };
  // A deleted branch has nothing to sync; the source keeps what it last read, and its next poll will say the branch is gone.
  if (push.deleted) return { status: 200, body: { ok: true, ignored: "the branch was deleted" } };

  const sources = await prisma.gitSource.findMany({
    where: { provider: "GITHUB", owner: { equals: push.owner, mode: "insensitive" }, repo: { equals: push.repo, mode: "insensitive" }, branch: push.branch, status: { not: "PAUSED" } },
    select: { id: true },
  });
  let queued = 0;
  for (const source of sources) {
    // One delivery can concern several sources (two directories of one repository), so the id is made per source.
    const result: Enqueued = await enqueueRun(source.id, { trigger: "WEBHOOK", deliveryId: input.delivery ? `${input.delivery}:${source.id}` : null, toSha: push.after || null });
    if (result.kind !== "duplicate") queued++;
  }
  return { status: 202, body: { ok: true, queued } };
}
