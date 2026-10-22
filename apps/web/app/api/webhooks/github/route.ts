import { NextRequest, NextResponse } from "next/server";
import { handleGitHubWebhook, MAX_WEBHOOK_BYTES } from "@gitcrook/git-sync";
import { checkRateLimit } from "@gitcrook/shared/server";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

/**
 * GitHub's push webhook. It does no work itself: it checks the signature over the raw body, finds the sources
 * that follow the branch that moved, and queues a sync run for each; the worker does the rest. Deliveries are
 * answered fast (GitHub gives up after ten seconds) and are safe to receive twice.
 *
 * Everything that decides what a delivery means is in `handleGitHubWebhook`, which has its own tests; this file
 * only turns an HTTP request into its arguments.
 */
export async function POST(req: NextRequest) {
  const meta = await readRequestMeta();
  const limit = checkRateLimit(`github-webhook:${meta.ip}`, 600, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } });

  // A request that says up front it is too large is turned away before it is read.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });

  const rawBody = new Uint8Array(await req.arrayBuffer());
  const result = await handleGitHubWebhook({
    secret: process.env.GITHUB_WEBHOOK_SECRET?.trim() || undefined,
    rawBody,
    signature: req.headers.get("x-hub-signature-256"),
    event: req.headers.get("x-github-event"),
    delivery: req.headers.get("x-github-delivery"),
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
