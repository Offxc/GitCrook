import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { SecretBox } from "@gitcrook/shared/server";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { enqueueRun } from "./queue";
import { createGitSyncRunner } from "./runner";
import { FakeGitHub } from "./testing/fakeGitHub";

beforeEach(resetDatabase);

async function world(sources = 1) {
  const github = new FakeGitHub();
  const created = [];
  for (let i = 0; i < sources; i++) {
    github.repo("acme", `docs${i}`).commit({ "README.md": `# Home ${i}\n`, "a.md": "# A\n" });
    const org = await makeOrg();
    const built = await makeSite({ organizationId: org.id });
    created.push(await prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: `docs${i}`, branch: "main" } }));
  }
  const logs: string[] = [];
  const runner = createGitSyncRunner({ secrets: new SecretBox(randomBytes(32)), assets: null, fetch: github.fetch, sleep: async () => undefined }, { log: (m) => logs.push(m), maintenanceEveryMs: 0 });
  return { github, sources: created, runner, logs };
}

describe("the runner", () => {
  it("polls a new source, syncs it, and goes quiet until the branch moves", async () => {
    const w = await world();
    await w.runner.tick(); // finds the source is due, queues a poll, claims it
    await w.runner.idle();
    expect(await prisma.page.count()).toBe(2);
    expect((await prisma.gitSource.findUniqueOrThrow({ where: { id: w.sources[0]!.id } })).status).toBe("IDLE");
    const runs = await prisma.gitSyncRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "POLL", status: "SUCCEEDED" });

    // Not due again: the interval has not passed.
    await w.runner.tick();
    await w.runner.idle();
    expect(await prisma.gitSyncRun.count()).toBe(1);
  });

  it("runs a queued manual sync straight away", async () => {
    const w = await world();
    await prisma.gitSource.update({ where: { id: w.sources[0]!.id }, data: { lastCheckedAt: new Date() } });
    await enqueueRun(w.sources[0]!.id, { trigger: "MANUAL" });
    await w.runner.tick();
    await w.runner.idle();
    expect((await prisma.gitSyncRun.findFirstOrThrow()).trigger).toBe("MANUAL");
    expect(await prisma.page.count()).toBe(2);
  });

  it("does not run more than its limit at once, and gets to the rest on the next tick", async () => {
    const w = await world(5);
    for (const s of w.sources) await enqueueRun(s.id, { trigger: "MANUAL" });
    const runner = createGitSyncRunner({ secrets: null, assets: null, fetch: w.github.fetch, sleep: async () => undefined }, { concurrency: 2, maintenanceEveryMs: 1e12 });
    await runner.tick();
    expect(runner.running).toBeLessThanOrEqual(2);
    for (let i = 0; i < 10 && (await prisma.gitSyncRun.count({ where: { status: { in: ["PENDING", "RUNNING"] } } })) > 0; i++) {
      await runner.idle();
      await runner.tick();
    }
    await runner.idle();
    expect(await prisma.gitSyncRun.count({ where: { status: "SUCCEEDED" } })).toBe(5);
  });

  it("ends a run left behind by a worker that died, and syncs the source again", async () => {
    const w = await world();
    const long = new Date(Date.now() - 10 * 60_000);
    await prisma.gitSource.update({ where: { id: w.sources[0]!.id }, data: { status: "SYNCING", lastCheckedAt: long } });
    await prisma.gitSyncRun.create({ data: { sourceId: w.sources[0]!.id, trigger: "POLL", toSha: "", status: "RUNNING", startedAt: long, heartbeatAt: long } });
    await w.runner.tick();
    await w.runner.idle();
    const runs = await prisma.gitSyncRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs.map((r) => r.status)).toEqual(["FAILED", "SUCCEEDED"]);
    expect(w.logs.join("\n")).toContain("whose worker had stopped");
  });

  it("keeps working after one source fails", async () => {
    const w = await world(2);
    await prisma.gitSource.update({ where: { id: w.sources[0]!.id }, data: { repo: "does-not-exist" } });
    await w.runner.tick();
    await w.runner.idle();
    const statuses = (await prisma.gitSyncRun.findMany({ orderBy: { createdAt: "asc" } })).map((r) => r.status).sort();
    expect(statuses).toEqual(["FAILED", "SUCCEEDED"]);
    expect(await prisma.page.count()).toBe(2);
  });
});
