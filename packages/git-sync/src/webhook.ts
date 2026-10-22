import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@gitcrook/db";
import { enqueueRun, type Enqueued } from "./queue";

/**
 * Largest payload read. A push event is a few kilobytes, up to a few megabytes for an enormous push; the proxy in front
 * refuses more than this too. A push that is refused is not lost: the source is checked on a timer as well.
 */
export const MAX_WEBHOOK_BYTES = 5_000_000;

/** The shortest instance-wide webhook secret accepted. */
export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/**
 * The secret a repository's webhook is signed with: derived from the server's secret and the source's id, so every
 * source has its own. A site administrator sees only their own sources' secrets — and cannot work out another's, or
 * the server's, from them — which means the webhook of one tenant cannot be used to send events for another's
 * repository. Nothing is stored: it is computed when it is shown and when a delivery is checked.
 */
export function webhookSecretFor(masterSecret: string, sourceId: string): string {
  return createHmac("sha256", masterSecret).update(`gitcrook:github-webhook:${sourceId}`).digest("hex");
}

/** Whether an instance-wide secret is long enough to derive from. */
export const webhookSecretIsUsable = (secret: string | undefined | null): secret is string => typeof secret === "string" && secret.length >= MIN_WEBHOOK_SECRET_LENGTH;

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
  status: 200 | 202 | 400 | 401 | 404 | 413 | 503;
  body: { ok?: true; queued?: number; ignored?: string; error?: string };
}

/** A source id as the database makes them. Anything else is not worth a lookup. */
const SOURCE_ID = /^[a-z0-9]{20,40}$/;

/**
 * Everything a webhook request means, given the source it was addressed to, its raw body and headers. The route is a
 * thin wrapper around this so the rules can be tested without HTTP.
 *
 * The signature is checked first, with a secret worked out from the id in the address alone, so a request that is not
 * signed for that source learns nothing: not whether the source exists, not which repository it follows.
 */
export async function handleGitHubWebhook(input: {
  /** The instance-wide secret (`GITHUB_WEBHOOK_SECRET`). */
  secret: string | undefined;
  sourceId: string;
  rawBody: Uint8Array;
  signature: string | null;
  event: string | null;
  delivery: string | null;
}): Promise<WebhookResult> {
  if (!webhookSecretIsUsable(input.secret)) return { status: 503, body: { error: "Webhooks are not configured on this server." } };
  if (input.rawBody.byteLength > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "Payload too large." } };
  if (!SOURCE_ID.test(input.sourceId) || !verifyGitHubSignature(webhookSecretFor(input.secret, input.sourceId), input.rawBody, input.signature)) {
    return { status: 401, body: { error: "Invalid signature." } };
  }

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

  // The signature proves the sender holds this source's secret, which is shown only to people who manage its site. The
  // push must still be for the repository and branch the source follows.
  const source = await prisma.gitSource.findUnique({ where: { id: input.sourceId }, select: { id: true, provider: true, owner: true, repo: true, branch: true, status: true } });
  if (!source) return { status: 404, body: { error: "No repository is connected here." } };
  if (source.status === "PAUSED") return { status: 200, body: { ok: true, ignored: "syncing is paused" } };
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (source.provider !== "GITHUB" || !same(source.owner, push.owner) || !same(source.repo, push.repo) || source.branch !== push.branch) {
    return { status: 200, body: { ok: true, ignored: "not the repository or branch this source follows" } };
  }

  const result: Enqueued = await enqueueRun(source.id, { trigger: "WEBHOOK", deliveryId: input.delivery ? `${input.delivery}:${source.id}` : null, toSha: push.after || null });
  return { status: 202, body: { ok: true, queued: result.kind === "duplicate" ? 0 : 1 } };
}
