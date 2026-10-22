import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { webhookSecretFor } from "@gitcrook/git-sync";
import { makeSite } from "../support/factory";
import { BASE_URL, makeAdmin } from "./support";

const MASTER = process.env.GITHUB_WEBHOOK_SECRET;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let sourceId: string;
let otherSourceId: string;
const stamp = Date.now().toString(36);

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point at the database the app under test uses (see tests/e2e/README.md).");
  if (!MASTER) throw new Error("GITHUB_WEBHOOK_SECRET must be set, to the same value, for the app under test and for this process.");
  admin = await makeAdmin();
  const make = async (slug: string) => {
    const built = await makeSite({ organizationId: admin.org.id, slug });
    const source = await prisma.gitSource.create({ data: { organizationId: admin.org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main" } });
    return source.id;
  };
  sourceId = await make(`e2e-hook-a-${stamp}`);
  otherSourceId = await make(`e2e-hook-b-${stamp}`);
});

afterAll(async () => {
  if (admin) {
    await prisma.organization.delete({ where: { id: admin.org.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.user.id } }).catch(() => undefined);
  }
});

const push = JSON.stringify({ ref: "refs/heads/main", after: "a".repeat(40), repository: { name: "docs", owner: { login: "acme" } } });
const sign = (body: string, id: string) => `sha256=${createHmac("sha256", webhookSecretFor(MASTER!, id)).update(body).digest("hex")}`;
const post = (id: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${BASE_URL}/api/webhooks/github/${id}`, { method: "POST", body, headers: { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": `e2e-${stamp}-${Math.random()}`, ...headers } });

describe("the GitHub webhook, over HTTP", () => {
  it("queues a sync for a delivery signed with that source's secret", async () => {
    const res = await post(sourceId, push, { "x-hub-signature-256": sign(push, sourceId) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, queued: 1 });
    expect(await prisma.gitSyncRun.count({ where: { sourceId, status: "PENDING", trigger: "WEBHOOK" } })).toBe(1);
  });

  it("refuses an unsigned delivery, a wrong one, and one signed for a different source — and queues nothing", async () => {
    const before = await prisma.gitSyncRun.count({ where: { sourceId: otherSourceId } });
    for (const signature of [undefined, `sha256=${"0".repeat(64)}`, sign(push, sourceId)]) {
      const res = await post(otherSourceId, push, signature ? { "x-hub-signature-256": signature } : {});
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid signature." });
    }
    expect(await prisma.gitSyncRun.count({ where: { sourceId: otherSourceId } })).toBe(before);
  });

  it("answers an address that is not a source's the same way as a wrong signature", async () => {
    const res = await post("not-a-source-id", push, { "x-hub-signature-256": `sha256=${"0".repeat(64)}` });
    expect(res.status).toBe(401);
  });

  it("turns away a body over the limit, even when it does not say how long it is", async () => {
    const chunk = new Uint8Array(1_000_000).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 7) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const res = await fetch(`${BASE_URL}/api/webhooks/github/${sourceId}`, {
      method: "POST",
      body: stream,
      // @ts-expect-error Node's fetch needs this to send a stream; the DOM typings do not know it.
      duplex: "half",
      headers: { "x-github-event": "push", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
    });
    expect(res.status).toBe(413);
  });

  it("is not reachable at the old, shared address", async () => {
    const res = await fetch(`${BASE_URL}/api/webhooks/github`, { method: "POST", body: push, headers: { "x-github-event": "push", "x-hub-signature-256": sign(push, sourceId) } });
    expect(res.status).toBe(404);
  });
});
