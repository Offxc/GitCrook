import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { handleGitHubWebhook } from "./webhook";

beforeEach(resetDatabase);

const secret = "hook-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const pushBody = (over: Record<string, unknown> = {}) => JSON.stringify({ ref: "refs/heads/main", after: "b".repeat(40), repository: { name: "Docs", owner: { login: "Acme" } }, ...over });

async function source(over: Partial<{ owner: string; repo: string; branch: string; status: "IDLE" | "PAUSED" }> = {}) {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  return prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main", ...over } });
}
const send = (body: string, over: Partial<Parameters<typeof handleGitHubWebhook>[0]> = {}) =>
  handleGitHubWebhook({ secret, rawBody: new TextEncoder().encode(body), signature: sign(body), event: "push", delivery: "d-1", ...over });

describe("the webhook", () => {
  it("queues a sync for a source on the branch that was pushed, ignoring the case of owner and repository", async () => {
    const s = await source();
    const result = await send(pushBody());
    expect(result).toEqual({ status: 202, body: { ok: true, queued: 1 } });
    const run = await prisma.gitSyncRun.findFirstOrThrow();
    expect(run).toMatchObject({ sourceId: s.id, trigger: "WEBHOOK", status: "PENDING", toSha: "b".repeat(40), deliveryId: `d-1:${s.id}` });
  });

  it("answers a repeated delivery without queuing it twice", async () => {
    await source();
    await send(pushBody());
    await prisma.gitSyncRun.updateMany({ data: { status: "SUCCEEDED" } });
    expect(await send(pushBody())).toEqual({ status: 202, body: { ok: true, queued: 0 } });
    expect(await prisma.gitSyncRun.count()).toBe(1);
  });

  it("queues every source of the repository that is on that branch, and no others", async () => {
    const a = await source();
    const b = await source();
    await source({ branch: "other" });
    await source({ repo: "elsewhere" });
    await source({ status: "PAUSED" });
    const result = await send(pushBody());
    expect(result.body.queued).toBe(2);
    expect((await prisma.gitSyncRun.findMany()).map((r) => r.sourceId).sort()).toEqual([a.id, b.id].sort());
  });

  it("merges a burst of pushes into the run that is waiting", async () => {
    await source();
    for (let i = 0; i < 5; i++) await send(pushBody({ after: String(i).repeat(40) }), { delivery: `d-${i}` });
    const runs = await prisma.gitSyncRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.toSha).toBe("4".repeat(40));
  });

  it("refuses a body that was not signed with the secret, and queues nothing", async () => {
    await source();
    const body = pushBody();
    const wrong = await send(body, { signature: `sha256=${createHmac("sha256", "other").update(body).digest("hex")}` });
    const missing = await send(body, { signature: null });
    const tampered = await send(body, { rawBody: new TextEncoder().encode(body.replace("main", "evil")) });
    expect([wrong.status, missing.status, tampered.status]).toEqual([401, 401, 401]);
    expect(wrong.body).toEqual({ error: "Invalid signature." });
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("says nothing about which repositories are connected, to someone without the secret", async () => {
    await source();
    const known = await send(pushBody(), { signature: null });
    const unknown = await send(pushBody({ repository: { name: "nope", owner: { login: "nobody" } } }), { signature: null });
    expect(known).toEqual(unknown);
  });

  it("is switched off when no secret is configured", async () => {
    const result = await send(pushBody(), { secret: undefined });
    expect(result.status).toBe(503);
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("answers a ping", async () => {
    expect(await send("{}", { event: "ping" })).toEqual({ status: 200, body: { ok: true } });
  });

  it("ignores events it does not use, and pushes it cannot use", async () => {
    await source();
    expect((await send("{}", { event: "issues" })).body.ignored).toContain("issues");
    expect((await send(pushBody({ ref: "refs/tags/v1" }))).body.ignored).toContain("not a push");
    expect((await send(pushBody({ deleted: true }))).body.ignored).toContain("deleted");
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("rejects a signed body that is not JSON", async () => {
    expect((await send("not json")).status).toBe(400);
  });

  it("refuses an enormous body before doing any work on it", async () => {
    const result = await handleGitHubWebhook({ secret, rawBody: new Uint8Array(27 * 1024 * 1024), signature: "sha256=" + "0".repeat(64), event: "push", delivery: "x" });
    expect(result.status).toBe(413);
  });
});
