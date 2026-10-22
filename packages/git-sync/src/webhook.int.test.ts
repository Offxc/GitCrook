import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { handleGitHubWebhook, webhookSecretFor } from "./webhook";

beforeEach(resetDatabase);

const secret = "a-long-enough-instance-wide-secret-0123456789";
/** What GitHub signs with for one source: the secret the Git Sync page shows for it. */
const sign = (body: string, sourceId: string, master = secret) => `sha256=${createHmac("sha256", webhookSecretFor(master, sourceId)).update(body).digest("hex")}`;
const pushBody = (over: Record<string, unknown> = {}) => JSON.stringify({ ref: "refs/heads/main", after: "b".repeat(40), repository: { name: "Docs", owner: { login: "Acme" } }, ...over });

async function source(over: Partial<{ owner: string; repo: string; branch: string; status: "IDLE" | "PAUSED" }> = {}) {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  return prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main", ...over } });
}
const send = (sourceId: string, body: string, over: Partial<Parameters<typeof handleGitHubWebhook>[0]> = {}) =>
  handleGitHubWebhook({ secret, sourceId, rawBody: new TextEncoder().encode(body), signature: sign(body, sourceId), event: "push", delivery: "d-1", ...over });

describe("the webhook", () => {
  it("queues a sync for the source it is addressed to, ignoring the case of owner and repository", async () => {
    const s = await source();
    const result = await send(s.id, pushBody());
    expect(result).toEqual({ status: 202, body: { ok: true, queued: 1 } });
    const run = await prisma.gitSyncRun.findFirstOrThrow();
    expect(run).toMatchObject({ sourceId: s.id, trigger: "WEBHOOK", status: "PENDING", toSha: "b".repeat(40), deliveryId: `d-1:${s.id}` });
  });

  it("answers a repeated delivery without queuing it twice", async () => {
    const s = await source();
    await send(s.id, pushBody());
    await prisma.gitSyncRun.updateMany({ data: { status: "SUCCEEDED" } });
    expect(await send(s.id, pushBody())).toEqual({ status: 202, body: { ok: true, queued: 0 } });
    expect(await prisma.gitSyncRun.count()).toBe(1);
  });

  it("queues only the source it is addressed to, even when others follow the same repository", async () => {
    const a = await source();
    const b = await source();
    expect((await send(a.id, pushBody())).body.queued).toBe(1);
    expect((await prisma.gitSyncRun.findMany()).map((r) => r.sourceId)).toEqual([a.id]);
    expect(b.id).not.toBe(a.id);
  });

  it("ignores a push for another repository or branch, and for a paused source", async () => {
    const a = await source();
    const paused = await source({ status: "PAUSED" });
    expect((await send(a.id, pushBody({ ref: "refs/heads/other" }))).body.ignored).toContain("not the repository or branch");
    expect((await send(a.id, pushBody({ repository: { name: "elsewhere", owner: { login: "acme" } } }))).body.ignored).toContain("not the repository or branch");
    expect((await send(paused.id, pushBody())).body.ignored).toContain("paused");
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("merges a burst of pushes into the run that is waiting", async () => {
    const s = await source();
    for (let i = 0; i < 5; i++) await send(s.id, pushBody({ after: String(i).repeat(40) }), { delivery: `d-${i}` });
    const runs = await prisma.gitSyncRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.toSha).toBe("4".repeat(40));
  });

  it("refuses a body that was not signed with the source's secret, and queues nothing", async () => {
    const s = await source();
    const body = pushBody();
    const wrong = await send(s.id, body, { signature: sign(body, s.id, "another-instance-secret-of-enough-length") });
    const missing = await send(s.id, body, { signature: null });
    const tampered = await send(s.id, body, { rawBody: new TextEncoder().encode(body.replace("main", "evil")) });
    expect([wrong.status, missing.status, tampered.status]).toEqual([401, 401, 401]);
    expect(wrong.body).toEqual({ error: "Invalid signature." });
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("does not let the secret of one source sign for another", async () => {
    const mine = await source();
    const victim = await source();
    const body = pushBody();
    // A tenant knows only their own source's secret. Signing with it, addressed to someone else's source, is refused —
    // and says exactly what a wrong signature says, so it reveals nothing about the other source.
    const forged = await send(victim.id, body, { signature: sign(body, mine.id) });
    expect(forged).toEqual({ status: 401, body: { error: "Invalid signature." } });
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("says the same thing to someone without the secret whether or not the source exists", async () => {
    const s = await source();
    const known = await send(s.id, pushBody(), { signature: null });
    const unknown = await send("c".repeat(25), pushBody(), { signature: null });
    const malformed = await send("../../etc", pushBody(), { signature: null });
    expect(known).toEqual(unknown);
    expect(known).toEqual(malformed);
  });

  it("reports a source that is gone only to someone who could sign for it", async () => {
    const id = "d".repeat(25);
    const body = pushBody();
    expect(await send(id, body)).toMatchObject({ status: 404 });
  });

  it("is switched off when no secret is configured, or the one configured is too short to derive from", async () => {
    const s = await source();
    expect((await send(s.id, pushBody(), { secret: undefined })).status).toBe(503);
    expect((await send(s.id, pushBody(), { secret: "short" })).status).toBe(503);
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("answers a ping", async () => {
    const s = await source();
    expect(await send(s.id, "{}", { event: "ping" })).toEqual({ status: 200, body: { ok: true } });
  });

  it("ignores events it does not use, and pushes it cannot use", async () => {
    const s = await source();
    expect((await send(s.id, "{}", { event: "issues" })).body.ignored).toContain("issues");
    expect((await send(s.id, pushBody({ ref: "refs/tags/v1" }))).body.ignored).toContain("not a push");
    expect((await send(s.id, pushBody({ deleted: true }))).body.ignored).toContain("deleted");
    expect(await prisma.gitSyncRun.count()).toBe(0);
  });

  it("rejects a signed body that is not JSON", async () => {
    const s = await source();
    expect((await send(s.id, "not json")).status).toBe(400);
  });

  it("refuses an enormous body before doing any work on it", async () => {
    const s = await source();
    const result = await handleGitHubWebhook({ secret, sourceId: s.id, rawBody: new Uint8Array(6_000_000), signature: "sha256=" + "0".repeat(64), event: "push", delivery: "x" });
    expect(result.status).toBe(413);
  });
});
