import { createHash } from "node:crypto";
import type { SafeFetchOptions } from "@gitcrook/shared/server";

/**
 * An in-memory stand-in for the parts of GitHub's REST API that Git Sync reads, good enough to run the real client
 * and the real sync engine against: commits and branches, trees (recursive, and truncated past a limit), blobs with
 * real git object ids, ETags, private repositories, tokens, and faults on demand (rate limits, server errors,
 * dropped connections). It is a test tool, exported so other packages' tests can use it.
 */

export type FileContent = string | Uint8Array;
/** `null` removes the file; an object makes something other than an ordinary file. */
export type Change = FileContent | null | { symlink: string } | { submodule: string } | { executable: FileContent };

interface Blob {
  bytes: Uint8Array;
}
interface FileEntry {
  mode: string;
  /** For a submodule the commit it points at; otherwise the blob's id. */
  sha: string;
  type: "blob" | "commit";
  size?: number;
}
interface TreeObject {
  entries: { name: string; mode: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }[];
}
interface Commit {
  sha: string;
  parent: string | null;
  treeSha: string;
  files: Map<string, FileEntry>;
  message: string;
}

const sha1 = (...parts: (string | Uint8Array)[]) => {
  const h = createHash("sha1");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};
const bytesOf = (c: FileContent): Uint8Array => (typeof c === "string" ? new TextEncoder().encode(c) : c);

/** The object id git gives a file's content. */
export function gitBlobSha(content: FileContent): string {
  const bytes = bytesOf(content);
  return sha1(`blob ${bytes.length}\0`, bytes);
}

export class FakeRepo {
  private readonly commits = new Map<string, Commit>();
  private readonly branches = new Map<string, string>();
  private readonly blobs = new Map<string, Blob>();
  private readonly trees = new Map<string, TreeObject>();
  private counter = 0;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
  /** Tokens allowed to read a private repository. */
  readonly tokens = new Set<string>();

  constructor(options: { private?: boolean; defaultBranch?: string; tokens?: string[] } = {}) {
    this.isPrivate = options.private ?? false;
    this.defaultBranch = options.defaultBranch ?? "main";
    for (const t of options.tokens ?? []) this.tokens.add(t);
  }

  /** Applies `changes` on top of a branch's head (or an empty tree for a new branch) and moves the branch. */
  commit(changes: Record<string, Change>, options: { branch?: string; message?: string } = {}): string {
    const branch = options.branch ?? this.defaultBranch;
    const parent = this.branches.get(branch) ?? null;
    const files = new Map(parent ? this.commits.get(parent)!.files : []);
    for (const [path, change] of Object.entries(changes)) {
      if (change === null) files.delete(path);
      else files.set(path, this.store(change));
    }
    return this.record(branch, parent, files, options.message ?? `commit ${this.counter + 1}`);
  }

  /** Replaces a branch with a commit that has no relation to its history (a force-push). */
  forcePush(files: Record<string, Change>, options: { branch?: string; message?: string } = {}): string {
    const map = new Map<string, FileEntry>();
    for (const [path, change] of Object.entries(files)) if (change !== null) map.set(path, this.store(change));
    return this.record(options.branch ?? this.defaultBranch, null, map, options.message ?? "force push");
  }

  head(branch = this.defaultBranch): string {
    const sha = this.branches.get(branch);
    if (!sha) throw new Error(`no branch ${branch}`);
    return sha;
  }

  hasBranch(branch: string): boolean {
    return this.branches.has(branch);
  }

  getCommit(sha: string): Commit | undefined {
    return this.commits.get(sha);
  }
  getTree(sha: string): TreeObject | undefined {
    return this.trees.get(sha);
  }
  getBlob(sha: string): Blob | undefined {
    return this.blobs.get(sha);
  }

  private store(change: Exclude<Change, null>): FileEntry {
    if (typeof change === "object" && !(change instanceof Uint8Array)) {
      if ("symlink" in change) {
        const sha = this.putBlob(change.symlink);
        return { mode: "120000", sha, type: "blob", size: bytesOf(change.symlink).length };
      }
      if ("submodule" in change) return { mode: "160000", sha: change.submodule, type: "commit" };
      const sha = this.putBlob(change.executable);
      return { mode: "100755", sha, type: "blob", size: bytesOf(change.executable).length };
    }
    const sha = this.putBlob(change as FileContent);
    return { mode: "100644", sha, type: "blob", size: bytesOf(change as FileContent).length };
  }

  private putBlob(content: FileContent): string {
    const sha = gitBlobSha(content);
    this.blobs.set(sha, { bytes: bytesOf(content) });
    return sha;
  }

  private record(branch: string, parent: string | null, files: Map<string, FileEntry>, message: string): string {
    const treeSha = this.buildTrees(files);
    const sha = sha1(`commit ${++this.counter}\0${parent ?? ""}\0${treeSha}\0${message}`);
    this.commits.set(sha, { sha, parent, treeSha, files, message });
    this.branches.set(branch, sha);
    return sha;
  }

  /** Builds a tree object for every directory and returns the root's id. */
  private buildTrees(files: Map<string, FileEntry>): string {
    interface Dir {
      files: [string, FileEntry][];
      dirs: Map<string, Dir>;
    }
    const root: Dir = { files: [], dirs: new Map() };
    for (const [path, entry] of files) {
      const parts = path.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1)) {
        if (!dir.dirs.has(part)) dir.dirs.set(part, { files: [], dirs: new Map() });
        dir = dir.dirs.get(part)!;
      }
      dir.files.push([parts.at(-1)!, entry]);
    }
    const build = (dir: Dir): string => {
      const entries: TreeObject["entries"] = [];
      for (const [name, entry] of dir.files) entries.push({ name, mode: entry.mode, type: entry.type, sha: entry.sha, ...(entry.size !== undefined ? { size: entry.size } : {}) });
      for (const [name, sub] of dir.dirs) entries.push({ name, mode: "040000", type: "tree", sha: build(sub) });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const sha = sha1("tree\0", entries.map((e) => `${e.mode} ${e.name}\0${e.sha}`).join("\n"));
      this.trees.set(sha, { entries });
      return sha;
    };
    return build(root);
  }
}

export interface Fault {
  /** Matches against `METHOD url`. */
  match: RegExp;
  /** Either a response, or `"drop"` for a connection that dies. */
  respond: { status: number; headers?: Record<string, string>; body?: unknown } | "drop";
  /** How many requests it applies to before it expires. */
  times: number;
}

export class FakeGitHub {
  readonly requests: { method: string; url: string; headers: Record<string, string> }[] = [];
  private readonly repos = new Map<string, FakeRepo>();
  private readonly faults: Fault[] = [];
  /** Tokens GitHub accepts at all. A token not in here is rejected with 401 everywhere. */
  readonly validTokens = new Set<string>();
  /** A recursive tree longer than this is cut off and marked `truncated`. */
  maxTreeEntries = 100_000;
  /** Seconds since the epoch, for rate-limit headers. */
  now = () => Math.floor(Date.now() / 1000);

  repo(owner: string, name: string, options: ConstructorParameters<typeof FakeRepo>[0] = {}): FakeRepo {
    const repo = new FakeRepo(options);
    this.repos.set(`${owner}/${name}`.toLowerCase(), repo);
    for (const t of repo.tokens) this.validTokens.add(t);
    return repo;
  }

  fail(match: RegExp, respond: Fault["respond"], times = 1) {
    this.faults.push({ match, respond, times });
  }

  count(match: RegExp): number {
    return this.requests.filter((r) => match.test(`${r.method} ${r.url}`)).length;
  }

  /** Hand this to `GitHubClient` as its `fetch`. */
  fetch = async (url: string, options: SafeFetchOptions = {}): Promise<Response> => {
    const method = options.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.requests.push({ method, url, headers });

    const key = `${method} ${url}`;
    const fault = this.faults.find((f) => f.times > 0 && f.match.test(key));
    if (fault) {
      fault.times--;
      if (fault.respond === "drop") throw new Error("socket hang up");
      return json(fault.respond.body ?? { message: "fault" }, fault.respond.status, fault.respond.headers);
    }

    const parsed = new URL(url);
    if (options.allowedHosts && !options.allowedHosts.includes(parsed.hostname)) throw Object.assign(new Error(`host "${parsed.hostname}" is not in the allowlist`), { name: "SsrfBlockedError" });

    const token = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1];
    if (token && !this.validTokens.has(token)) return json({ message: "Bad credentials" }, 401);

    const route = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(parsed.pathname);
    if (!route) return json({ message: "Not Found" }, 404);
    const repo = this.repos.get(`${decodeURIComponent(route[1]!)}/${decodeURIComponent(route[2]!)}`.toLowerCase());
    if (!repo || (repo.isPrivate && !(token && repo.tokens.has(token)))) return json({ message: "Not Found" }, 404);

    const rest = route[3] ?? "";
    if (rest === "") return json({ default_branch: repo.defaultBranch, private: repo.isPrivate });

    const branch = /^\/branches\/(.+)$/.exec(rest);
    if (branch) {
      const name = decodeURIComponent(branch[1]!);
      if (!repo.hasBranch(name)) return json({ message: "Branch not found" }, 404);
      const sha = repo.head(name);
      const etag = `W/"${sha}"`;
      if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
      return json({ name, protected: false, commit: { sha, commit: { tree: { sha: repo.getCommit(sha)!.treeSha } } } }, 200, { etag });
    }

    const tree = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest);
    if (tree) {
      const object = repo.getTree(tree[1]!);
      if (!object) return json({ message: "Not Found" }, 404);
      if (parsed.searchParams.get("recursive") !== "1") {
        return json({ sha: tree[1], tree: object.entries.map(({ name, ...e }) => ({ path: name, ...e })), truncated: false });
      }
      const flat: Record<string, unknown>[] = [];
      const walk = (sha: string, prefix: string) => {
        for (const e of repo.getTree(sha)!.entries) {
          const { name, ...fields } = e;
          flat.push({ path: prefix + name, ...fields });
          if (e.type === "tree") walk(e.sha, `${prefix}${name}/`);
        }
      };
      walk(tree[1]!, "");
      const truncated = flat.length > this.maxTreeEntries;
      return json({ sha: tree[1], tree: truncated ? flat.slice(0, this.maxTreeEntries) : flat, truncated });
    }

    const blob = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest);
    if (blob) {
      const object = repo.getBlob(blob[1]!);
      if (!object) return json({ message: "Not Found" }, 404);
      if ((headers.accept ?? "").includes("raw")) {
        if (options.maxBytes !== undefined && object.bytes.length > options.maxBytes) throw Object.assign(new Error(`response exceeds ${options.maxBytes} byte cap`), { name: "SsrfBlockedError" });
        return new Response(Buffer.from(object.bytes), { status: 200, headers: { "content-type": "application/vnd.github.raw+json" } });
      }
      return json({ sha: blob[1], size: object.bytes.length, encoding: "base64", content: Buffer.from(object.bytes).toString("base64") });
    }

    return json({ message: "Not Found" }, 404);
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
