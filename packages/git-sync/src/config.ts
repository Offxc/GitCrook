/**
 * Which Git host the server talks to. The dashboard (checking a repository before connecting it) and the worker
 * (syncing it) must agree, so both read it here. The hosts are fixed by the person running the server, never by a
 * source: a repository's owner cannot point the server at an address of their choosing.
 */
export interface HostConfig {
  /** `https://api.github.com`, or a GitHub Enterprise Server's `https://host/api/v3`. */
  apiBase: string;
  /** The only hosts a request may go to. */
  allowedHosts: string[];
  /** Where a repository's pages live in a browser, for "Edit on GitHub" links. */
  webBase: string;
}

export function hostConfigFromEnv(env: Record<string, string | undefined> = process.env): HostConfig {
  const apiBase = (env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
  const apiHost = new URL(apiBase).hostname;
  const listed = (env.GIT_SYNC_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  // github.com's API lives at api.github.com, a Server's at <host>/api/v3; pages are at github.com or <host>.
  const webBase = apiHost === "api.github.com" ? "https://github.com" : `https://${apiHost}`;
  return { apiBase, allowedHosts: listed.length > 0 ? listed : [apiHost], webBase };
}

/** The address of a file in the repository's web interface, for the editing link on a page. Null if any part looks wrong. */
export function editUrl(web: string, source: { owner: string; repo: string; branch: string; rootDir: string }, sourcePath: string): string | null {
  const safe = /^[A-Za-z0-9._-]+$/;
  if (!safe.test(source.owner) || !safe.test(source.repo)) return null;
  const segments = [source.rootDir, sourcePath].join("/").split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) return null;
  const branch = source.branch.split("/").map(encodeURIComponent).join("/");
  return `${web}/${source.owner}/${source.repo}/edit/${branch}/${segments.map(encodeURIComponent).join("/")}`;
}
