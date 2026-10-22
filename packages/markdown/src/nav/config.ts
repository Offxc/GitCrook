import YAML from "yaml";
import { z } from "zod";
import type { Diagnostics } from "../diagnostics";
import { cleanRepoPath } from "./paths";

/**
 * A repository can say how it is laid out. `gitcrook.yaml` is ours; `.gitbook.yaml` is read so that a
 * repository set up for GitBook works unchanged.
 */

/** One entry of an explicit navigation. */
export type NavEntry =
  | string
  | { page: string; title?: string; icon?: string; pages?: NavEntry[] }
  | { group: string; icon?: string; pages: NavEntry[] };

const entry: z.ZodType<NavEntry> = z.lazy(() =>
  z.union([
    z.string().min(1),
    z.object({ page: z.string().min(1), title: z.string().min(1).max(200).optional(), icon: z.string().min(1).max(64).optional(), pages: z.array(entry).max(2000).optional() }).strict(),
    z.object({ group: z.string().min(1).max(200), icon: z.string().min(1).max(64).optional(), pages: z.array(entry).max(2000) }).strict(),
  ]),
);

const redirects = z.record(z.string().min(1), z.string().min(1));

export const gitcrookSchema = z.object({
  version: z.literal(1).optional(),
  root: z.string().optional(),
  nav: z.array(entry).max(2000).optional(),
  redirects: redirects.optional(),
});

export const gitbookSchema = z.object({
  root: z.string().optional(),
  structure: z.object({ readme: z.string().optional(), summary: z.string().optional() }).partial().optional(),
  redirects: redirects.optional(),
});

export interface RepoConfig {
  /** The directory the docs live in, relative to the repository ("" = the repository root). */
  root: string;
  /** An explicit navigation from `gitcrook.yaml`. */
  nav: NavEntry[] | null;
  /** Path of the summary file, relative to `root`. */
  summaryPath: string;
  /** Path of the home page, relative to `root`. */
  readmePath: string;
  /** Old URL path → new URL path or file, as the repository wrote them. */
  redirects: Record<string, string>;
  /** Which files the settings came from. */
  sources: ("gitcrook.yaml" | ".gitbook.yaml")[];
}

export function defaultConfig(): RepoConfig {
  return { root: "", nav: null, summaryPath: "SUMMARY.md", readmePath: "README.md", redirects: {}, sources: [] };
}

function parseYaml(text: string, diags: Diagnostics): unknown | undefined {
  const doc = YAML.parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const error of doc.errors) diags.add("GS-101", `Not valid YAML: ${error.message.split("\n")[0]}`, { start: { line: error.linePos?.[0]?.line ?? 1 } });
    return undefined;
  }
  try {
    return doc.toJS({ maxAliasCount: 10 }) ?? {};
  } catch (error) {
    diags.add("GS-101", `Not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** A root directory as the settings wrote it (`./docs/`, `docs`), or null if it leaves the repository. */
function cleanRoot(value: string, diags: Diagnostics): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "./" || trimmed === "/") return "";
  const cleaned = cleanRepoPath(trimmed.replace(/^\.\//, "").replace(/\/+$/, ""));
  if (cleaned === null) {
    diags.add("GS-170", `The root "${value}" leaves the repository; it was ignored.`);
    return null;
  }
  return cleaned;
}

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "(top level)"}: ${issue.message}` : "invalid";
}

/**
 * Combines `.gitbook.yaml` and `gitcrook.yaml` (either may be absent). Where both set the same thing,
 * `gitcrook.yaml` wins. A file that cannot be read is reported and ignored, so the run goes on with the
 * folder layout rather than guessing.
 */
export function readRepoConfig(files: { gitcrook?: string | null; gitbook?: string | null }, onDiagnostics: { gitcrook: Diagnostics; gitbook: Diagnostics }): RepoConfig {
  const config = defaultConfig();

  if (files.gitbook) {
    const data = parseYaml(files.gitbook, onDiagnostics.gitbook);
    if (data !== undefined) {
      const parsed = gitbookSchema.safeParse(data);
      if (!parsed.success) onDiagnostics.gitbook.add("GS-103", `.gitbook.yaml ${describe(parsed.error)}; it was ignored.`);
      else {
        config.sources.push(".gitbook.yaml");
        if (parsed.data.root !== undefined) config.root = cleanRoot(parsed.data.root, onDiagnostics.gitbook) ?? config.root;
        if (parsed.data.structure?.readme) config.readmePath = cleanRepoPath(parsed.data.structure.readme) ?? config.readmePath;
        if (parsed.data.structure?.summary) config.summaryPath = cleanRepoPath(parsed.data.structure.summary) ?? config.summaryPath;
        Object.assign(config.redirects, parsed.data.redirects);
      }
    }
  }

  if (files.gitcrook) {
    const data = parseYaml(files.gitcrook, onDiagnostics.gitcrook);
    if (data !== undefined) {
      const parsed = gitcrookSchema.safeParse(data);
      if (!parsed.success) onDiagnostics.gitcrook.add("GS-103", `gitcrook.yaml ${describe(parsed.error)}; it was ignored.`);
      else {
        config.sources.push("gitcrook.yaml");
        if (parsed.data.root !== undefined) config.root = cleanRoot(parsed.data.root, onDiagnostics.gitcrook) ?? config.root;
        if (parsed.data.nav) config.nav = parsed.data.nav;
        Object.assign(config.redirects, parsed.data.redirects);
        for (const key of Object.keys(data as Record<string, unknown>)) {
          if (!(key in gitcrookSchema.shape)) onDiagnostics.gitcrook.add("GS-102", `gitcrook.yaml key "${key}" is not used by GitCrook; it was ignored.`);
        }
      }
    }
  }
  return config;
}
