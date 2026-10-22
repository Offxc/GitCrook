import { z } from "zod";
import { KEYS } from "./frontMatter";
import { gitcrookSchema } from "./nav/config";

/**
 * JSON Schemas for the two things a repository writes by hand, generated from the same Zod schemas the importer
 * checks them with — so an editor that validates against them (VS Code with the YAML extension, for one) agrees with
 * the importer. Committed under docs/git-sync/schemas; a test fails if they drift from the code.
 */

const ID_BASE = "https://raw.githubusercontent.com/Offxc/GitCrook/main/docs/git-sync/schemas";

/** Front matter: every key optional, and keys GitCrook does not know are allowed (they are kept and ignored). */
export function frontMatterJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(KEYS).partial(), { io: "input", unrepresentable: "any", target: "draft-07" }) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  // A refinement cannot be written as JSON Schema; this is the format part of it (reserved words are checked on import).
  properties.slug = { ...properties.slug, pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 96 };
  return { $schema: "http://json-schema.org/draft-07/schema#", $id: `${ID_BASE}/front-matter.schema.json`, title: "GitCrook page front matter", ...schema, additionalProperties: true };
}

/** `gitcrook.yaml`. */
export function configJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(gitcrookSchema, { io: "input", unrepresentable: "any", target: "draft-07" }) as Record<string, unknown>;
  return { $schema: "http://json-schema.org/draft-07/schema#", $id: `${ID_BASE}/gitcrook.schema.json`, title: "gitcrook.yaml", ...schema };
}
