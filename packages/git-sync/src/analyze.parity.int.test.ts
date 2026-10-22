import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@gitcrook/db";
import { SecretBox } from "@gitcrook/shared/server";
import { randomBytes } from "node:crypto";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { analyzeRepository, type AnalyzeInput } from "./analyze";
import { runSync, type SyncDeps } from "./sync";
import { FakeGitHub, type Change } from "./testing/fakeGitHub";

beforeEach(resetDatabase);

/**
 * The local checker (`gitcrook-docs check`) is only worth running if its answer is the server's answer. Each case is
 * one repository, read both ways — analysed directly, and as a sync preview against the (fake) host with a real
 * database — and the findings must be identical. Findings only the server can make (the branch is not protected, a
 * rate limit, a failed upload) are left out of the comparison.
 */

const SERVER_ONLY = new Set(["GS-301", "GS-302", "GS-303", "GS-304", "GS-305", "GS-306"]);
const keyOf = (d: { code: string; severity: string; path?: string; line?: number; message: string }) => `${d.code}|${d.severity}|${d.path ?? ""}|${d.line ?? ""}|${d.message}`;

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const cases: Record<string, { files: Record<string, Change>; rootDir?: string }> = {
  "a tidy repository": {
    files: {
      "README.md": "# Welcome\n\nSee [install](./guides/install.md) and the [guide](./guides).\n\n![logo](./img/logo.png)\n",
      "guides/install.md": "# Install\n\nBack to [home](../README.md#top).\n",
      "guides/configure.md": "---\ntitle: Configure\norder: 2\n---\n\nSettings.\n",
      "img/logo.png": PNG,
    },
  },
  "broken links and images": {
    files: {
      "README.md": "# Home\n\n[gone](./nope.md) and [out](../../etc/passwd)\n\n![x](./missing.png)\n\n![ok](./there.png)\n",
      "there.png": PNG,
    },
  },
  "bad and unusual front matter": {
    files: {
      "a.md": "---\ntitle: [unclosed\n---\n\n# A\n",
      "b.md": "---\ntitle: B\norder: soon\nlayout: wide\nslug: Not A Slug\n---\n\nText\n",
      "c.md": "---\ntitle: C\nredirect_from: [/old/c]\nhidden: true\n---\n\nText\n",
    },
  },
  "duplicate addresses": {
    files: { "one/guide.md": "---\nslug: guide\n---\n# One\n", "two.md": "---\nslug: guide\n---\n# Two\n", "guide.md": "# Three\n" },
  },
  "the explicit navigation leaves a page out and lists one that is missing": {
    files: { "gitcrook.yaml": "nav:\n  - README.md\n  - missing.md\n", "README.md": "# Home\n", "extra.md": "# Extra\n" },
  },
  "a navigation that leaves a page out": {
    files: { "gitcrook.yaml": "nav:\n  - group: Guides\n    pages:\n      - guides/a.md\n  - README.md\n", "README.md": "# Home\n", "guides/a.md": "# A\n", "guides/b.md": "# B\n" },
  },
  "a GitBook repository": {
    files: {
      ".gitbook.yaml": "root: ./docs/\nstructure:\n  summary: SUMMARY.md\nredirects:\n  old: README.md\n",
      "docs/README.md": "# Hello\n\n{% hint style=\"info\" %}\nNote\n{% endhint %}\n\n{% unknowntag %}\nstuff\n{% endunknowntag %}\n",
      "docs/SUMMARY.md": "# Summary\n\n* [Hello](README.md)\n* [Start](start.md)\n  * [Deeper](deeper.md)\n",
      "docs/start.md": "# Start\n\n[hello](README.md)\n",
      "docs/deeper.md": "# Deeper\n",
    },
  },
  "a summary that lists a missing file": {
    files: {
      ".gitbook.yaml": "root: ./docs/\nstructure:\n  summary: SUMMARY.md\nredirects:\n  old: README.md\n",
      "docs/README.md": "# Hello\n\n{% hint style=\"info\" %}\nNote\n{% endhint %}\n\n{% unknowntag %}\nstuff\n{% endunknowntag %}\n",
      "docs/SUMMARY.md": "# Summary\n\n* [Hello](README.md)\n* [Start](start.md)\n  * [Deeper](deeper.md)\n* [Nowhere](nowhere.md)\n",
      "docs/start.md": "# Start\n\n[hello](README.md)\n",
      "docs/deeper.md": "# Deeper\n",
    },
  },
  "files that are skipped": {
    files: {
      "README.md": "# Home\n",
      "lfs.md": "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 5\n",
      "bin.md": new Uint8Array([104, 105, 0, 106]),
      "link.md": { symlink: "README.md" },
      "sub": { submodule: "0123456789abcdef0123456789abcdef01234567" },
      "notes.txt": "plain",
      "program.exe": new Uint8Array([77, 90]),
    },
  },
  "directives and html the importer does not accept": {
    files: {
      "README.md": "# Home\n\n:::columns\n:::column\nLeft\n:::\n:::\n\n:::mystery{a=1}\nbody\n:::\n\n<script>alert(1)</script>\n\n<iframe src=\"https://evil.test\"></iframe>\n\n[js](javascript:alert(1))\n",
    },
  },
  "an include": {
    files: { "README.md": "# Home\n\n{% include \"parts/note.md\" %}\n\n{% include \"parts/missing.md\" %}\n", "parts/note.md": "Shared.\n" },
  },
  "the docs directory": {
    files: { "README.md": "# Outside\n\n[x](./nope.md)\n", "docs/index.md": "# Inside\n\n[ok](./a.md) [bad](./b.md)\n", "docs/a.md": "# A\n" },
    rootDir: "docs",
  },
  "images in the middle of paragraphs and in links": {
    files: { "README.md": "# Home\n\nText ![a](./a.png) more text\n\n[![badge](./a.png)](https://ci.example.com)\n", "a.png": PNG },
  },
  "a folder without an index and a case difference": {
    files: { "Guides/Intro.md": "# Intro\n", "guides/other.md": "# Other\n", "Readme.md": "# Home\n" },
  },
};

describe.each(Object.entries(cases))("local analysis matches the server's preview: %s", (_name, scenario) => {
  it("finds the same things", async () => {
    const github = new FakeGitHub();
    const repo = github.repo("acme", "docs");
    const sha = repo.commit(scenario.files);
    const commit = repo.getCommit(sha)!;

    const input: AnalyzeInput = {
      entries: [...commit.files].map(([path, e]) => ({ path, mode: e.mode, type: e.type, sha: e.sha, size: e.size ?? repo.getBlob(e.sha)?.bytes.length })),
      read: async (path) => repo.getBlob(commit.files.get(path)!.sha)!.bytes,
    };
    const local = await analyzeRepository(input, { rootDir: scenario.rootDir });

    const org = await makeOrg();
    const built = await makeSite({ organizationId: org.id });
    const source = await prisma.gitSource.create({
      data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main", rootDir: scenario.rootDir ?? "" },
    });
    const deps: SyncDeps = { secrets: new SecretBox(randomBytes(32)), assets: null, fetch: github.fetch, sleep: async () => undefined };
    const server = await runSync(deps, source.id, { trigger: "MANUAL", dryRun: true });

    const theirs = server.diagnostics.filter((d) => !SERVER_ONLY.has(d.code)).map(keyOf).sort();
    const ours = local.diagnostics.filter((d) => !SERVER_ONLY.has(d.code)).map(keyOf).sort();
    expect(ours).toEqual(theirs);

    // And they agree on what the site would look like.
    const preview = (nodes: NonNullable<typeof server.preview>["tree"]): string[] => nodes.flatMap((n) => [`${n.key}|${n.title}|${n.slug}|${n.draft}|${n.hidden}`, ...preview(n.children).map((c) => `  ${c}`)]);
    const sketch = (pages: typeof local.pages) => pages.map((p) => `${p.key}|${p.title}|${p.slug}|${p.draft}|${p.hidden}`).sort();
    expect(sketch(local.pages)).toEqual(
      preview(server.preview?.tree ?? [])
        .map((l) => l.trim())
        .sort(),
    );
    if (server.status === "FAILED") expect(local.failure).not.toBeNull();
  });
});
