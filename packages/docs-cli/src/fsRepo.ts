import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { AnalyzeInput, TreeEntry } from "@gitcrook/git-sync/pure";

const run = promisify(execFile);

/** Directories that are never documentation and can be enormous. Used only when `git` can't say what is tracked. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** The paths Git would commit from `root`: tracked files plus untracked ones that are not ignored. Null if `root` is not a Git work tree. */
async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { maxBuffer: 256 * 1024 * 1024 });
    // `ls-files` is relative to the directory it is run in, which is what is wanted: the checker is pointed at the repository's root.
    return [...new Set(stdout.split("\0").filter(Boolean))];
  } catch {
    return null;
  }
}

async function walk(root: string, directory = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) out.push(...(await walk(root, path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * A folder as the repository it would be pushed as. What counts is what Git would commit: the files it tracks, plus
 * new ones it would not ignore. Outside a Git work tree every file is taken, except `.git` and `node_modules`.
 * Symbolic links and submodules are listed as such, so they are reported exactly as the server reports them.
 */
export async function readDirectory(root: string): Promise<AnalyzeInput> {
  const names = (await gitFiles(root)) ?? (await walk(root));
  const entries: TreeEntry[] = [];
  for (const name of names.sort()) {
    const path = sep === "/" ? name : name.split(sep).join("/");
    let info;
    try {
      info = await lstat(join(root, name));
    } catch {
      continue; // tracked but deleted from the work tree
    }
    if (info.isSymbolicLink()) entries.push({ path, mode: "120000", type: "blob", sha: "", size: info.size });
    else if (info.isDirectory()) entries.push({ path, mode: "160000", type: "commit", sha: "" }); // a submodule's work tree
    else if (info.isFile()) entries.push({ path, mode: info.mode & 0o111 ? "100755" : "100644", type: "blob", sha: "", size: info.size });
  }
  return {
    entries,
    read: async (path) => new Uint8Array(await readFile(join(root, ...path.split("/")))),
  };
}

/** `file` relative to `root`, for messages. */
export const shown = (root: string, file: string) => relative(root, file).split(sep).join("/") || ".";
