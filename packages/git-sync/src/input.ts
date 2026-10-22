import { cleanRepoPath } from "@gitcrook/markdown";

/**
 * What a person types into the "connect a repository" form, turned into values the rest of Git Sync can trust.
 * Owner, repository and branch end up in request paths and in log lines, so they are held to what GitHub itself
 * allows, and nothing else gets through.
 */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function validOwner(owner: string): boolean {
  return OWNER.test(owner) && !owner.endsWith("-") && !owner.includes("--");
}

export function validRepo(repo: string): boolean {
  return REPO.test(repo) && repo !== "." && repo !== ".." && !repo.endsWith(".git");
}

/** A branch name as Git allows it, narrowed to the characters real branches use. */
export function validBranch(branch: string): boolean {
  if (branch.length === 0 || branch.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) return false;
  if (branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.endsWith(".lock")) return false;
  if (branch.includes("..") || branch.includes("//") || branch.includes("/.") || branch.includes("@{")) return false;
  return true;
}

export interface ParsedRepository {
  owner: string;
  repo: string;
  /** From a `/tree/<branch>/…` address, if that is what was pasted. */
  branch?: string;
  rootDir?: string;
}

export type ParseRepositoryResult = { ok: true; value: ParsedRepository } | { ok: false; error: string };

/**
 * Accepts `owner/repo`, a web address (`https://github.com/owner/repo`, with `.git` or a `/tree/branch/dir` tail),
 * or an SSH-style address. `webHost` is the host repositories are expected on (github.com, or a Server's host).
 */
export function parseRepositoryInput(input: string, webHost = "github.com"): ParseRepositoryResult {
  const text = input.trim();
  if (text.length === 0 || text.length > 500) return { ok: false, error: "Enter a repository, like owner/name or its GitHub address." };

  let path: string;
  const web = /^https?:\/\/([^/\s]+)\/(.+)$/i.exec(text);
  const ssh = /^(?:ssh:\/\/)?git@([^:/\s]+)[:/](.+)$/i.exec(text);
  if (web || ssh) {
    const match = (web ?? ssh)!;
    if (match[1]!.toLowerCase() !== webHost.toLowerCase()) return { ok: false, error: `Only repositories on ${webHost} can be connected.` };
    path = match[2]!;
  } else if (/^[^\s:]+\/[^\s:]+/.test(text) && !text.includes("://")) {
    path = text;
  } else {
    return { ok: false, error: "That doesn't look like a repository. Use owner/name or the repository's address." };
  }

  const parts = path.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, "");
  if (!owner || !repo) return { ok: false, error: "A repository is written owner/name." };
  if (!validOwner(owner)) return { ok: false, error: `"${owner}" is not a valid account name.` };
  if (!validRepo(repo)) return { ok: false, error: `"${repo}" is not a valid repository name.` };

  const value: ParsedRepository = { owner, repo };
  if (parts[2] === "tree" && parts[3]) {
    let branch: string;
    try {
      branch = decodeURIComponent(parts[3]);
    } catch {
      return { ok: false, error: "The branch in that address could not be read." };
    }
    if (!validBranch(branch)) return { ok: false, error: `"${branch}" is not a branch name Git Sync can use.` };
    value.branch = branch;
    const dir = parts.slice(4).map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join("/");
    if (dir) {
      const clean = cleanRepoPath(dir);
      if (!clean) return { ok: false, error: "The folder in that address is not a path inside the repository." };
      value.rootDir = clean;
    }
  } else if (parts.length > 2) {
    return { ok: false, error: "Use the repository's address, not a link to a page inside it (a /tree/branch/folder address is fine)." };
  }
  return { ok: true, value };
}

/** A docs directory as typed: empty for the whole repository, otherwise a clean path inside it. */
export function parseRootDir(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const text = input.trim().replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (text === "" || text === ".") return { ok: true, value: "" };
  const clean = cleanRepoPath(text);
  if (!clean || clean.length > 300) return { ok: false, error: "The docs folder must be a path inside the repository, like docs or site/content." };
  return { ok: true, value: clean };
}

export const POLL_INTERVAL = { min: 60, max: 86_400, default: 300 } as const;
export const GRACE_DAYS = { min: 1, max: 90, default: 14 } as const;
