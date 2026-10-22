import { NextRequest, NextResponse } from "next/server";
import { handleGitHubWebhook, MAX_WEBHOOK_BYTES } from "@gitcrook/git-sync";
import { checkRateLimit } from "@gitcrook/shared/server";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

/**
 * GitHub's push webhook for one connected repository (`/api/webhooks/github/<source id>`; the Git Sync page shows each
 * source's address and secret). It does no work itself: it checks the signature over the raw body, and queues a sync
 * run for the source; the worker does the rest. Deliveries are answered fast (GitHub gives up after ten seconds) and
 * are safe to receive twice.
 *
 * Everything that decides what a delivery means is in `handleGitHubWebhook`, which has its own tests; this file
 * only turns an HTTP request into its arguments.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const meta = await readRequestMeta();
  const limit = checkRateLimit(`github-webhook:${meta.ip}`, 600, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } });

  const tooLarge = () => NextResponse.json({ error: "Payload too large." }, { status: 413 });
  // A request that says up front it is too large is turned away before it is read.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) return tooLarge();
  const rawBody = await readCapped(req, MAX_WEBHOOK_BYTES);
  if (!rawBody) return tooLarge();

  const result = await handleGitHubWebhook({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    sourceId,
    rawBody,
    signature: req.headers.get("x-hub-signature-256"),
    event: req.headers.get("x-github-event"),
    delivery: req.headers.get("x-github-delivery"),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

/** The request body, or null as soon as it turns out to be longer than `max` — whatever its Content-Length said, or if it said nothing. */
async function readCapped(req: NextRequest, max: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
