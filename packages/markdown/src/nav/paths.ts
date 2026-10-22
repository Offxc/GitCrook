/**
 * Paths inside a repository. They come from a stranger's repository, so every one is checked before it is
 * used for anything: no way out of the repository, no odd separators, no control characters.
 */

const CONTROL = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** A repository path in its one canonical form (forward slashes, no `.`/`..`/empty segments), or null if it is not safe. */
export function cleanRepoPath(raw: string): string | null {
  if (raw === "" || raw.includes("\\") || CONTROL.test(raw) || raw.startsWith("/")) return null;
  const out: string[] = [];
  for (const segment of raw.normalize("NFC").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    out.push(segment);
  }
  return out.length > 0 ? out.join("/") : null;
}

export function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** `install.guide.md` → `install.guide`. */
export function stemOf(path: string): string {
  return basenameOf(path).replace(/\.(md|markdown|mdx)$/i, "");
}

export const isMarkdownPath = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path);

/**
 * Where a link written in `fromFile` points, as a repository path. Null for anything that is not a file in this
 * repository: another site, a different scheme, an anchor on the same page, or a path that climbs out of the root.
 * A leading `/` is the repository (or docs) root, as in GitBook.
 */
export function resolveRepoLink(fromFile: string, target: string): { path: string } | { escapes: true } | null {
  let value = target.trim();
  if (value === "" || value.startsWith("#") || value.startsWith("//") || SCHEME.test(value)) return null;
  value = value.replace(/[?#].*$/, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep it as written: a stray `%` is part of the name
  }
  if (value === "" || value.includes("\\") || CONTROL.test(value)) return null;

  const base = value.startsWith("/") ? [] : dirnameOf(fromFile).split("/").filter(Boolean);
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return { escapes: true };
      base.pop();
    } else base.push(segment);
  }
  const path = cleanRepoPath(base.join("/"));
  return path ? { path } : null;
}

/** `getting-started` → `Getting started`. */
export function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}
