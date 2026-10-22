import { describe, expect, it } from "vitest";
import { configJsonSchema, frontMatterJsonSchema } from "../schemas";
import { parseMarkdown } from "../index";
import { readRepoConfig } from "../nav/config";
import { Diagnostics } from "../diagnostics";

// The files under docs/git-sync/schemas are generated: `pnpm exec vitest run -u packages/markdown/src/__tests__/schemas.test.ts`
// rewrites them after a change to the keys.
describe("the committed JSON Schemas", () => {
  it("match the front matter the importer reads", async () => {
    await expect(`${JSON.stringify(frontMatterJsonSchema(), null, 2)}\n`).toMatchFileSnapshot("../../../../docs/git-sync/schemas/front-matter.schema.json");
  });

  it("match gitcrook.yaml as the importer reads it", async () => {
    await expect(`${JSON.stringify(configJsonSchema(), null, 2)}\n`).toMatchFileSnapshot("../../../../docs/git-sync/schemas/gitcrook.schema.json");
  });
});

describe("the front matter schema", () => {
  const schema = frontMatterJsonSchema() as { properties: Record<string, { type?: string; description?: string; pattern?: string }>; additionalProperties: boolean };

  it("describes every key the importer accepts, and nothing it ignores", () => {
    const accepted = Object.keys(parseMarkdown("---\ntitle: a\ndescription: b\nicon: c\nslug: d\norder: 1\ndraft: false\nhidden: false\nredirect_from: e\nid: f\nnav_title: g\n---\n").frontMatter).filter((k) => k !== "extra");
    expect(Object.keys(schema.properties).sort()).toEqual(accepted.sort());
    for (const property of Object.values(schema.properties)) expect(property.description).toBeTruthy();
  });

  it("allows keys it does not know, as the importer does", () => {
    expect(schema.additionalProperties).toBe(true);
  });

  it("agrees with the importer about what a slug may be", () => {
    const re = new RegExp(schema.properties.slug!.pattern!);
    for (const ok of ["install", "api-v2", "a1"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["Install", "has space", "-lead", "trail-", "a--b", "a_b"]) expect(re.test(bad)).toBe(false);
  });
});

describe("the gitcrook.yaml schema", () => {
  it("accepts what the importer accepts", () => {
    const text = "version: 1\nroot: docs\nnav:\n  - README.md\n  - group: Guides\n    pages: [a.md]\nredirects:\n  old: new\n";
    const diags = { gitcrook: new Diagnostics("gitcrook.yaml"), gitbook: new Diagnostics(".gitbook.yaml") };
    readRepoConfig({ gitcrook: text }, diags);
    expect(diags.gitcrook.items).toEqual([]);
    const schema = configJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).sort()).toEqual(["nav", "redirects", "root", "version"]);
  });
});
