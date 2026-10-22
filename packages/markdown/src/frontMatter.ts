import YAML from "yaml";
import { z } from "zod";
import { validateSlug } from "@gitcrook/shared";
import type { Diagnostics } from "./diagnostics";

/**
 * The keys a page's front matter may carry (see docs/git-sync/FORMAT.md). Each is checked on its own: a bad
 * `order` doesn't throw away a good `title`, it is reported (GS-103) and ignored.
 */
const KEYS = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500),
  icon: z.string().trim().min(1).max(64),
  slug: z.string().trim().refine((s) => validateSlug(s).ok, "must be lowercase letters, numbers and hyphens, and not reserved"),
  order: z.number().finite(),
  draft: z.boolean(),
  hidden: z.boolean(),
  redirect_from: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).max(50)]).transform((v) => (Array.isArray(v) ? v : [v])),
  id: z.string().trim().min(1).max(100),
  nav_title: z.string().trim().min(1).max(200),
} as const;

export interface FrontMatter {
  title?: string;
  description?: string;
  icon?: string;
  slug?: string;
  order?: number;
  draft: boolean;
  hidden: boolean;
  redirect_from: string[];
  id?: string;
  nav_title?: string;
  /** Keys this version doesn't know. Kept, never interpreted. */
  extra: Record<string, unknown>;
}

export function emptyFrontMatter(): FrontMatter {
  return { draft: false, hidden: false, redirect_from: [], extra: {} };
}

/**
 * `yamlText` is the text between the `---` fences. `firstLine` is the line of the opening fence, so that a
 * YAML error can be reported against the real file rather than against the fragment.
 */
/** A page's front matter is a few lines. Anything this long is not one, and parsing hostile YAML costs time in proportion to its size. */
export const MAX_FRONT_MATTER_CHARS = 32_000;

export function parseFrontMatter(yamlText: string | null, diags: Diagnostics, firstLine = 1): FrontMatter {
  const result = emptyFrontMatter();
  if (yamlText === null || yamlText.trim() === "") return result;
  if (yamlText.length > MAX_FRONT_MATTER_CHARS) {
    diags.add("GS-101", `Front matter is longer than ${MAX_FRONT_MATTER_CHARS} characters; it was ignored.`, { start: { line: firstLine } });
    return result;
  }

  const doc = YAML.parseDocument(yamlText, { prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const error of doc.errors) {
      const line = (error.linePos?.[0]?.line ?? 1) + firstLine; // +1 for the fence itself, -1 for 1-based lines
      diags.add("GS-101", `Front matter is not valid YAML: ${error.message.split("\n")[0]}`, { start: { line } });
    }
    return result;
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 10 });
  } catch (error) {
    // Too many aliases (a "YAML bomb") is refused by the library by throwing; here it is a problem with the file.
    diags.add("GS-101", `Front matter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`, { start: { line: firstLine } });
    return result;
  }
  if (data === null || data === undefined) return result;
  if (typeof data !== "object" || Array.isArray(data)) {
    diags.add("GS-101", "Front matter must be a set of `key: value` pairs.", { start: { line: firstLine } });
    return result;
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key in KEYS) {
      const schema = KEYS[key as keyof typeof KEYS];
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        diags.add("GS-103", `Front matter "${key}" ${parsed.error.issues[0]?.message?.toLowerCase() ?? "is invalid"}; it was ignored.`, { start: { line: firstLine } });
        continue;
      }
      (result as unknown as Record<string, unknown>)[key] = parsed.data;
    } else {
      result.extra[key] = value;
      diags.add("GS-102", `Front matter key "${key}" is not used by GitCrook; it was kept and ignored.`, { start: { line: firstLine } });
    }
  }
  return result;
}

/**
 * Splits a leading front-matter block off a document. It is front matter only if the first line is `---` and
 * a closing `---` (or `...`) follows; otherwise the file simply starts with a divider.
 *
 * The block is replaced by blank lines in `rest`, so every position in the rest of the document still points at
 * the right line of the original file.
 */
export function splitFrontMatter(source: string): { yaml: string | null; rest: string; closingLine: number } {
  const lines = source.split("\n");
  if (!/^---[ \t]*$/.test(lines[0] ?? "")) return { yaml: null, rest: source, closingLine: 0 };
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i]!)) {
      return { yaml: lines.slice(1, i).join("\n"), rest: [...Array(i + 1).fill(""), ...lines.slice(i + 1)].join("\n"), closingLine: i + 1 };
    }
  }
  return { yaml: null, rest: source, closingLine: 0 };
}
