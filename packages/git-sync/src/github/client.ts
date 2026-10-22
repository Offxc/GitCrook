import { safeFetch, type SafeFetchOptions } from "@gitcrook/shared/server";
import { AuthError, GitHostError, NotFoundError, ProtocolError, RateLimitError, UnavailableError } from "./errors";

/**
 * A small client for the parts of GitHub's REST API that Git Sync reads: a branch, a tree, a file. Every request
 * goes through `safeFetch` (https only, no private addresses, pinned connection, capped body), and only to the
 * hosts it is configured with.
 */

export type FetchLike = (url: string, options?: SafeFetchOptions) => Promise<Response>;

export interface GitHubClientOptions {
  /** `https://api.github.com`, or a GitHub Enterprise Server's `https://host/api/v3`. */
  apiBase?: string;
  /** Called for each request, so a short-lived installation token can be refreshed. Null = unauthenticated. */
  getToken?: () => Promise<string | null> | string | null;
  /** Replaceable for tests. */
  fetch?: FetchLike;
  /** The only hosts requests may go to. Defaults to the API base's host. */
  allowedHosts?: readonly string[];
  /** Longest a rate-limit wait may be before the call gives up and reports it. Default 60 s. */
  maxWaitMs?: number;
  /** Attempts for a request that fails with a server error or a network fault. Default 3. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Told about waits and retries, so a run can record them (GS-301). */
  onNotice?: (notice: { kind: "rate-limit-wait" | "retry"; message: string }) => void;
}

export interface BranchInfo {
  /** The commit the branch points at. */
  sha: string;
  /** That commit's root tree. */
  treeSha: string;
  /** Whether branch protection is on: an unprotected branch can be rewritten by anyone with push access. */
  protected: boolean;
  etag: string | null;
}

export type BranchResult = ({ notModified: false } & BranchInfo) | { notModified: true };

export interface TreeEntry {
  path: string;
  /** Git file mode: `100644` file, `100755` executable, `120000` symlink, `040000` directory, `160000` submodule. */
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface TreeResult {
  sha: string;
  entries: TreeEntry[];
  /** GitHub stopped listing a recursive tree (over 100,000 entries or 7 MB); walk it directory by directory instead. */
  truncated: boolean;
}

export interface RepoInfo {
  defaultBranch: string;
  private: boolean;
}

const DEFAULT_API = "https://api.github.com";

export class GitHubClient {
  private readonly apiBase: string;
  private readonly allowedHosts: readonly string[];
  private readonly fetchImpl: FetchLike;
  private readonly maxWaitMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: GitHubClientOptions = {}) {
    this.apiBase = (options.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    this.allowedHosts = options.allowedHosts ?? [new URL(this.apiBase).hostname];
    this.fetchImpl = options.fetch ?? safeFetch;
    this.maxWaitMs = options.maxWaitMs ?? 60_000;
    this.retries = options.retries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const body = await this.json<{ default_branch?: unknown; private?: unknown }>(`/repos/${seg(owner)}/${seg(repo)}`, {}, `Repository ${owner}/${repo}`);
    if (typeof body.default_branch !== "string") throw new ProtocolError("GitHub's answer for the repository had no default branch.");
    return { defaultBranch: body.default_branch, private: body.private === true };
  }

  /** A branch's head. With `etag`, GitHub answers "not modified" for free when nothing has been pushed. */
  async getBranch(owner: string, repo: string, branch: string, options: { etag?: string | null } = {}): Promise<BranchResult> {
    const path = `/repos/${seg(owner)}/${seg(repo)}/branches/${branch.split("/").map(seg).join("/")}`;
    const headers: Record<string, string> = {};
    if (options.etag) headers["If-None-Match"] = options.etag;
    const res = await this.request(path, { headers }, `Branch ${branch} of ${owner}/${repo}`, { allow304: true });
    if (res.status === 304) return { notModified: true };
    const body = (await readJson(res)) as { commit?: { sha?: unknown; commit?: { tree?: { sha?: unknown } } }; protected?: unknown };
    const sha = body.commit?.sha;
    const treeSha = body.commit?.commit?.tree?.sha;
    if (typeof sha !== "string" || typeof treeSha !== "string") throw new ProtocolError("GitHub's answer for the branch had no commit.");
    return { notModified: false, sha, treeSha, protected: body.protected === true, etag: res.headers.get("etag") };
  }

  async getTree(owner: string, repo: string, treeSha: string, options: { recursive?: boolean } = {}): Promise<TreeResult> {
    const query = options.recursive ? "?recursive=1" : "";
    const body = await this.json<{ sha?: unknown; tree?: unknown; truncated?: unknown }>(
      `/repos/${seg(owner)}/${seg(repo)}/git/trees/${seg(treeSha)}${query}`,
      { maxBytes: 64_000_000 },
      `A directory listing of ${owner}/${repo}`,
    );
    if (!Array.isArray(body.tree)) throw new ProtocolError("GitHub's answer for the tree had no entries.");
    const entries: TreeEntry[] = [];
    for (const raw of body.tree as Record<string, unknown>[]) {
      if (typeof raw.path !== "string" || typeof raw.mode !== "string" || typeof raw.sha !== "string" || (raw.type !== "blob" && raw.type !== "tree" && raw.type !== "commit")) {
        throw new ProtocolError("GitHub's answer for the tree had an entry that could not be read.");
      }
      entries.push({ path: raw.path, mode: raw.mode, type: raw.type, sha: raw.sha, ...(typeof raw.size === "number" ? { size: raw.size } : {}) });
    }
    return { sha: typeof body.sha === "string" ? body.sha : treeSha, entries, truncated: body.truncated === true };
  }

  /** A file's bytes. `maxBytes` bounds what is read, whatever size GitHub claims. */
  async getBlob(owner: string, repo: string, sha: string, options: { maxBytes: number }): Promise<Uint8Array> {
    const res = await this.request(
      `/repos/${seg(owner)}/${seg(repo)}/git/blobs/${seg(sha)}`,
      { headers: { Accept: "application/vnd.github.raw+json" }, maxBytes: options.maxBytes },
      `A file of ${owner}/${repo}`,
    );
    try {
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      throw new ProtocolError(`A file was larger than the ${options.maxBytes} byte limit or could not be read in full.`);
    }
  }

  // -----------------------------------------------------------------------------------------------

  private async json<T>(path: string, options: { headers?: Record<string, string>; maxBytes?: number }, what: string): Promise<T> {
    return (await readJson(await this.request(path, options, what))) as T;
  }

  /** One API call, with the retry and rate-limit behaviour every call shares. */
  private async request(path: string, options: { headers?: Record<string, string>; maxBytes?: number }, what: string, extra: { allow304?: boolean } = {}): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    let lastFault = "";

    for (let attempt = 0; ; attempt++) {
      const token = await this.options.getToken?.();
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "GitCrook-GitSync",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      };

      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers, allowedHosts: this.allowedHosts, maxBytes: options.maxBytes ?? 8_000_000, timeoutMs: 30_000, maxRedirects: 3 });
      } catch (error) {
        // A blocked address or a size cap is a decision, not a fault: do not try again.
        if (error instanceof Error && error.name === "SsrfBlockedError") throw new ProtocolError(error.message);
        lastFault = error instanceof Error ? error.message : String(error);
        if (attempt < this.retries) {
          await this.backoff(attempt, `${what}: ${lastFault}`);
          continue;
        }
        throw new UnavailableError(`${what} could not be reached: ${lastFault}`);
      }

      if (res.ok || (extra.allow304 && res.status === 304)) return res;
      await res.body?.cancel().catch(() => undefined);

      if (res.status === 401) throw new AuthError();
      if (res.status === 404) throw new NotFoundError(what);

      if (res.status === 403 || res.status === 429) {
        const wait = this.rateLimitWait(res);
        if (wait === null) throw new AuthError(`GitHub refused access to ${what} (the credential may lack read permission, or the repository's organisation may restrict it).`);
        if (wait.ms > this.maxWaitMs) throw new RateLimitError(new Date(this.now() + wait.ms));
        if (attempt >= this.retries + 2) throw new RateLimitError(new Date(this.now() + wait.ms));
        this.options.onNotice?.({ kind: "rate-limit-wait", message: `GitHub's rate limit was reached; waiting ${Math.ceil(wait.ms / 1000)} s.` });
        await this.sleep(wait.ms);
        continue;
      }

      if (res.status >= 500) {
        lastFault = `HTTP ${res.status}`;
        if (attempt < this.retries) {
          await this.backoff(attempt, `${what}: HTTP ${res.status}`);
          continue;
        }
        throw new UnavailableError(`${what}: GitHub answered ${res.status} after ${attempt + 1} attempts.`);
      }

      throw new ProtocolError(`${what}: GitHub answered ${res.status}.`);
    }
  }

  /** How long GitHub asks us to wait, or null when a 403 is not about rate limits at all. */
  private rateLimitWait(res: Response): { ms: number } | null {
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return { ms: Math.ceil(seconds * 1000) + 250 };
    }
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      if (Number.isFinite(reset) && reset > 0) return { ms: Math.max(0, reset * 1000 - this.now()) + 1000 };
      return { ms: 60_000 };
    }
    return res.status === 429 ? { ms: 60_000 } : null;
  }

  private async backoff(attempt: number, message: string) {
    const ms = Math.min(8000, 500 * 2 ** attempt);
    this.options.onNotice?.({ kind: "retry", message: `${message}; trying again in ${ms} ms.` });
    await this.sleep(ms);
  }
}

/** Percent-encodes one path segment. Owner, repo and branch come from a form, so nothing in them may change the route. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

async function readJson(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    if (error instanceof GitHostError) throw error;
    throw new ProtocolError("GitHub's answer was larger than the limit or was cut off.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProtocolError("GitHub's answer was not JSON.");
  }
}
