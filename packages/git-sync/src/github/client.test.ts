import { describe, expect, it, vi } from "vitest";
import { FakeGitHub, gitBlobSha } from "../testing/fakeGitHub";
import { GitHubClient } from "./client";
import { AuthError, NotFoundError, ProtocolError, RateLimitError, UnavailableError } from "./errors";

function setup(options: { private?: boolean; token?: string; clientToken?: string | null } = {}) {
  const github = new FakeGitHub();
  const repo = github.repo("acme", "docs", { private: options.private, tokens: options.token ? [options.token] : [] });
  repo.commit({ "README.md": "# Hi\n", "docs/a.md": "A", "docs/img/x.png": new Uint8Array([1, 2, 3]) });
  const sleeps: number[] = [];
  const notices: string[] = [];
  const client = new GitHubClient({
    fetch: github.fetch,
    getToken: () => (options.clientToken === undefined ? (options.token ?? null) : options.clientToken),
    sleep: async (ms) => void sleeps.push(ms),
    now: () => github.now() * 1000,
    onNotice: (n) => notices.push(n.message),
  });
  return { github, repo, client, sleeps, notices };
}

describe("branches", () => {
  it("reads the head commit and its tree", async () => {
    const { client, repo } = setup();
    const result = await client.getBranch("acme", "docs", "main");
    expect(result).toMatchObject({ notModified: false, sha: repo.head(), treeSha: repo.getCommit(repo.head())!.treeSha, protected: false });
  });

  it("answers 'not modified' for an ETag that is still current, and a new commit invalidates it", async () => {
    const { client, repo } = setup();
    const first = await client.getBranch("acme", "docs", "main");
    if (first.notModified) throw new Error("unexpected");
    expect(await client.getBranch("acme", "docs", "main", { etag: first.etag })).toEqual({ notModified: true });
    repo.commit({ "new.md": "x" });
    const after = await client.getBranch("acme", "docs", "main", { etag: first.etag });
    expect(after.notModified).toBe(false);
  });

  it("handles branch names with slashes", async () => {
    const { client, repo } = setup();
    repo.commit({ "x.md": "x" }, { branch: "release/1.0" });
    const result = await client.getBranch("acme", "docs", "release/1.0");
    expect(result.notModified).toBe(false);
  });

  it("reports a missing branch as not found", async () => {
    const { client } = setup();
    await expect(client.getBranch("acme", "docs", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reads repository facts", async () => {
    const { client } = setup({ private: false });
    expect(await client.getRepo("acme", "docs")).toEqual({ defaultBranch: "main", private: false });
  });
});

describe("trees and files", () => {
  it("lists every path with its mode, type and object id", async () => {
    const { client } = setup();
    const branch = await client.getBranch("acme", "docs", "main");
    if (branch.notModified) throw new Error("unexpected");
    const tree = await client.getTree("acme", "docs", branch.treeSha, { recursive: true });
    expect(tree.truncated).toBe(false);
    const byPath = Object.fromEntries(tree.entries.map((e) => [e.path, e]));
    expect(Object.keys(byPath).sort()).toEqual(["README.md", "docs", "docs/a.md", "docs/img", "docs/img/x.png"]);
    expect(byPath["README.md"]).toMatchObject({ mode: "100644", type: "blob", sha: gitBlobSha("# Hi\n"), size: 5 });
    expect(byPath["docs"]).toMatchObject({ mode: "040000", type: "tree" });
  });

  it("lists one directory at a time", async () => {
    const { client } = setup();
    const branch = await client.getBranch("acme", "docs", "main");
    if (branch.notModified) throw new Error("unexpected");
    const root = await client.getTree("acme", "docs", branch.treeSha);
    expect(root.entries.map((e) => e.path).sort()).toEqual(["README.md", "docs"]);
  });

  it("says when GitHub cut the listing short", async () => {
    const { client, github } = setup();
    github.maxTreeEntries = 2;
    const branch = await client.getBranch("acme", "docs", "main");
    if (branch.notModified) throw new Error("unexpected");
    const tree = await client.getTree("acme", "docs", branch.treeSha, { recursive: true });
    expect(tree.truncated).toBe(true);
    expect(tree.entries).toHaveLength(2);
  });

  it("reads a file's bytes exactly", async () => {
    const { client } = setup();
    const bytes = await client.getBlob("acme", "docs", gitBlobSha(new Uint8Array([1, 2, 3])), { maxBytes: 100 });
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("refuses a file larger than the cap", async () => {
    const { client } = setup();
    await expect(client.getBlob("acme", "docs", gitBlobSha("# Hi\n"), { maxBytes: 2 })).rejects.toBeInstanceOf(ProtocolError);
  });

  it("reports a missing object as not found", async () => {
    const { client } = setup();
    await expect(client.getBlob("acme", "docs", "0".repeat(40), { maxBytes: 100 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("credentials", () => {
  it("sends the token, and nothing else identifying", async () => {
    const { client, github } = setup({ private: true, token: "ghp_secret123" });
    await client.getRepo("acme", "docs");
    expect(github.requests[0]!.headers).toMatchObject({ authorization: "Bearer ghp_secret123", "user-agent": "GitCrook-GitSync", "x-github-api-version": "2022-11-28" });
  });

  it("works without a token on a public repository, and sends no Authorization header", async () => {
    const { client, github } = setup({ clientToken: null });
    await client.getRepo("acme", "docs");
    expect(github.requests[0]!.headers.authorization).toBeUndefined();
  });

  it("reports a private repository the credential cannot see as not found, as GitHub does", async () => {
    const { client } = setup({ private: true, token: "ghp_good", clientToken: null });
    await expect(client.getRepo("acme", "docs")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reports a rejected token as an authentication failure, without the token in the message", async () => {
    const { client } = setup({ private: true, token: "ghp_good", clientToken: "ghp_wrongtoken123" });
    const error = await client.getRepo("acme", "docs").catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe("GS-303");
    expect(String(error.message)).not.toContain("wrongtoken");
  });

  it("asks for a fresh token on every request", async () => {
    const github = new FakeGitHub();
    github.repo("acme", "docs").commit({ "a.md": "a" });
    const getToken = vi.fn(async () => null);
    const client = new GitHubClient({ fetch: github.fetch, getToken });
    await client.getRepo("acme", "docs");
    await client.getBranch("acme", "docs", "main");
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});

describe("rate limits", () => {
  it("waits out a short primary limit and carries on", async () => {
    const { client, github, sleeps, notices } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(github.now() + 5) } });
    expect(await client.getRepo("acme", "docs")).toMatchObject({ defaultBranch: "main" });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(5000);
    expect(sleeps[0]).toBeLessThan(8000);
    expect(notices[0]).toContain("rate limit");
  });

  it("honours Retry-After for a secondary limit", async () => {
    const { client, github, sleeps } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 429, headers: { "retry-after": "2" } });
    await client.getRepo("acme", "docs");
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  it("gives up, saying when to try again, if the wait is longer than it will sit through", async () => {
    const { client, github, sleeps } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(github.now() + 3600) } });
    const error = await client.getRepo("acme", "docs").catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryable).toBe(true);
    expect(error.code).toBe("GS-301");
    expect(error.resetAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
    expect(sleeps).toEqual([]);
  });

  it("treats a 403 that is not about limits as a permission problem", async () => {
    const { client, github } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 403, body: { message: "Resource not accessible" } });
    expect(await client.getRepo("acme", "docs").catch((e) => e)).toBeInstanceOf(AuthError);
  });
});

describe("faults", () => {
  it("retries a server error with growing pauses", async () => {
    const { client, github, sleeps } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 502 }, 2);
    expect(await client.getRepo("acme", "docs")).toMatchObject({ defaultBranch: "main" });
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries a dropped connection", async () => {
    const { client, github } = setup();
    github.fail(/repos\/acme\/docs$/, "drop", 1);
    expect(await client.getRepo("acme", "docs")).toMatchObject({ defaultBranch: "main" });
  });

  it("reports a host that stays down as unavailable, and retryable", async () => {
    const { client, github } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 503 }, 10);
    const error = await client.getRepo("acme", "docs").catch((e) => e);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(error.retryable).toBe(true);
    expect(github.count(/repos\/acme\/docs$/)).toBe(4);
  });

  it("does not retry a client error", async () => {
    const { client, github } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 422 }, 10);
    await expect(client.getRepo("acme", "docs")).rejects.toBeInstanceOf(ProtocolError);
    expect(github.count(/repos\/acme\/docs$/)).toBe(1);
  });

  it("rejects an answer that is not what GitHub sends", async () => {
    const { client, github } = setup();
    github.fail(/repos\/acme\/docs$/, { status: 200, body: { unexpected: true } });
    await expect(client.getRepo("acme", "docs")).rejects.toBeInstanceOf(ProtocolError);
    github.fail(/branches\/main$/, { status: 200, body: { commit: {} } });
    await expect(client.getBranch("acme", "docs", "main")).rejects.toBeInstanceOf(ProtocolError);
    github.fail(/git\/trees/, { status: 200, body: { tree: [{ path: 5 }] } });
    await expect(client.getTree("acme", "docs", "a".repeat(40))).rejects.toBeInstanceOf(ProtocolError);
  });
});

describe("what a user can type into the form", () => {
  it("cannot change the route through owner, repo or branch", async () => {
    const { client, github } = setup();
    await client.getRepo("acme/../../orgs/x", "docs?x=1#").catch(() => undefined);
    await client.getBranch("acme", "docs", "main/../../../user").catch(() => undefined);
    for (const r of github.requests) {
      const path = new URL(r.url).pathname;
      expect(path.startsWith("/repos/")).toBe(true);
      // The dots survive, but the slashes around them are encoded, so no path segment is ever "..".
      expect(path.split("/")).not.toContain("..");
    }
    expect(github.requests[0]!.url).toContain("acme%2F..%2F..%2Forgs%2Fx");
  });

  it("only talks to the configured host", async () => {
    const github = new FakeGitHub();
    const client = new GitHubClient({ fetch: github.fetch, apiBase: "https://api.github.com", allowedHosts: ["ghe.example.com"] });
    await expect(client.getRepo("acme", "docs")).rejects.toBeInstanceOf(ProtocolError);
    expect(github.requests).toHaveLength(1);
  });

  it("uses a GitHub Enterprise API base", async () => {
    const github = new FakeGitHub();
    github.repo("acme", "docs").commit({ "a.md": "a" });
    const client = new GitHubClient({ fetch: github.fetch, apiBase: "https://ghe.example.com/api/v3/" });
    // The fake routes by path; the base's prefix is simply part of it, so it is only checked here.
    await client.getRepo("acme", "docs").catch(() => undefined);
    expect(github.requests[0]!.url).toBe("https://ghe.example.com/api/v3/repos/acme/docs");
  });
});
