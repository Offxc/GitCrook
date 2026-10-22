import { diagnostic, type Diagnostic } from "@gitcrook/markdown";
import { GitHostError } from "./github/errors";
import type { GitHubClient, TreeEntry } from "./github/client";
import { DEFAULT_LIMITS, type SyncLimits } from "./limits";

/** What a file in the repository is to Git Sync. */
export type FileKind = "markdown" | "asset" | "config";

export interface RepoFile {
  /** Relative to the docs directory (the source's root directory). */
  path: string;
  sha: string;
  size: number;
  kind: FileKind;
}

export interface Listing {
  files: RepoFile[];
  /** Entries left out on purpose, as diagnostics: symlinks, submodules, and a summary of ignored file types. */
  diagnostics: Diagnostic[];
  /** The tree id of the docs directory. */
  treeSha: string;
  /** Whether GitHub's one-shot listing was too big and the directories were walked one at a time. */
  walked: boolean;
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;
/** Files a page can embed or link to. Others are ignored, not imported: this is documentation, not a file host. */
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|webm|mov|mp3|wav|ogg|m4a|pdf|zip|txt|csv|json)$/i;
const CONFIG_NAMES = new Set(["gitcrook.yaml", "gitcrook.yml", ".gitbook.yaml", ".gitbook.yml"]);

export function classify(path: string, summaryPath = "SUMMARY.md"): FileKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (CONFIG_NAMES.has(name.toLowerCase())) return "config";
  if (path.toLowerCase() === summaryPath.toLowerCase()) return "config";
  if (MARKDOWN.test(name)) return "markdown";
  if (ASSET.test(name)) return "asset";
  return null;
}

/** Walks `rootDir` down from the repository's root tree to the tree that holds it. */
async function rootTree(client: GitHubClient, owner: string, repo: string, repoTreeSha: string, rootDir: string, branch: string): Promise<string> {
  let sha = repoTreeSha;
  for (const segment of rootDir.split("/").filter(Boolean)) {
    const level = await client.getTree(owner, repo, sha);
    const next = level.entries.find((e) => e.path === segment && e.type === "tree");
    if (!next) throw new GitHostError(`The directory "${rootDir}" does not exist on branch ${branch}.`, "GS-302", false);
    sha = next.sha;
  }
  return sha;
}

/** Lists a tree directory by directory, for repositories too large for GitHub's one-call listing. */
async function walk(client: GitHubClient, owner: string, repo: string, treeSha: string, limits: SyncLimits): Promise<TreeEntry[]> {
  const out: TreeEntry[] = [];
  const queue: { sha: string; prefix: string }[] = [{ sha: treeSha, prefix: "" }];
  while (queue.length > 0) {
    const batch = queue.splice(0, limits.concurrency);
    const results = await Promise.all(batch.map((b) => client.getTree(owner, repo, b.sha)));
    results.forEach((tree, i) => {
      for (const entry of tree.entries) {
        const path = batch[i]!.prefix + entry.path;
        out.push({ ...entry, path });
        if (entry.type === "tree") queue.push({ sha: entry.sha, prefix: `${path}/` });
      }
    });
    if (out.length > limits.maxFiles * 20) throw new GitHostError("The repository has far too many entries to import.", "GS-302", false);
  }
  return out;
}

export interface ListOptions {
  owner: string;
  repo: string;
  branch: string;
  repoTreeSha: string;
  rootDir: string;
  summaryPath?: string;
  limits?: SyncLimits;
}

/** Every importable file under the docs directory, with the reasons for anything left out. */
export async function listFiles(client: GitHubClient, options: ListOptions): Promise<Listing> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const { owner, repo } = options;
  const treeSha = options.rootDir ? await rootTree(client, owner, repo, options.repoTreeSha, options.rootDir, options.branch) : options.repoTreeSha;

  let tree = await client.getTree(owner, repo, treeSha, { recursive: true });
  let entries = tree.entries;
  let walked = false;
  if (tree.truncated) {
    entries = await walk(client, owner, repo, treeSha, limits);
    walked = true;
  }

  const files: RepoFile[] = [];
  const diagnostics: Diagnostic[] = [];
  const ignored = new Map<string, number>();
  const where = (path: string) => (options.rootDir ? `${options.rootDir}/${path}` : path);

  for (const entry of entries) {
    if (entry.type === "tree") continue;
    if (entry.type === "commit") {
      diagnostics.push(diagnostic("GS-160", `"${where(entry.path)}" is a Git submodule; it was skipped.`, { path: entry.path }));
      continue;
    }
    if (entry.mode === "120000") {
      diagnostics.push(diagnostic("GS-160", `"${where(entry.path)}" is a symbolic link; it was skipped.`, { path: entry.path }));
      continue;
    }
    // A name with a control character or a backslash cannot be told apart from a different path once it is used.
    if (/[\u0000-\u001f\u007f\\]/.test(entry.path)) {
      diagnostics.push(diagnostic("GS-170", `A file name with control characters or a backslash was skipped.`, { path: entry.path.replace(/[\u0000-\u001f\u007f]/g, "?") }));
      continue;
    }
    const kind = classify(entry.path, options.summaryPath);
    if (!kind) {
      const ext = /\.[^./]+$/.exec(entry.path)?.[0]?.toLowerCase() ?? "(no extension)";
      ignored.set(ext, (ignored.get(ext) ?? 0) + 1);
      continue;
    }
    files.push({ path: entry.path, sha: entry.sha, size: entry.size ?? 0, kind });
  }

  if (ignored.size > 0) {
    const total = [...ignored.values()].reduce((a, b) => a + b, 0);
    const top = [...ignored].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([ext, n]) => `${ext} ×${n}`);
    diagnostics.push(diagnostic("GS-140", `${total} file${total === 1 ? "" : "s"} of other types ${total === 1 ? "was" : "were"} not imported (${top.join(", ")}${ignored.size > 6 ? ", …" : ""}).`));
  }

  const importable = files.filter((f) => f.kind !== "config");
  if (importable.length > limits.maxFiles) {
    throw new GitHostError(`The repository has ${importable.length} Markdown and asset files; the limit is ${limits.maxFiles}. Point the source at a smaller directory.`, "GS-151", false);
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, diagnostics, treeSha, walked };
}
