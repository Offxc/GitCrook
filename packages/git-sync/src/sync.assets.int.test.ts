import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), "gitcrook-sync-assets-"));

import { createAssetImporter } from "@gitcrook/assets";
import { prisma } from "@gitcrook/db";
import { storagePathFor } from "@gitcrook/shared/server";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { runSync } from "./sync";
import { FakeGitHub } from "./testing/fakeGitHub";

beforeEach(resetDatabase);

describe("syncing a repository with images and diagrams, with the real importer", () => {
  it("imports a PNG and a sanitised SVG, and the page points at both", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>alert(1)</script><circle cx="4" cy="4" r="3" onclick="x()"/></svg>';

    const github = new FakeGitHub();
    github.repo("acme", "docs").commit({
      "README.md": "# Home\n\n![Diagram](./images/diagram.svg)\n\n![Photo](./images/photo.png)\n",
      "images/diagram.svg": svg,
      "images/photo.png": new Uint8Array(png),
    });
    const org = await makeOrg();
    const built = await makeSite({ organizationId: org.id });
    const source = await prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "acme", repo: "docs", branch: "main" } });

    const outcome = await runSync({ secrets: null, assets: createAssetImporter(), fetch: github.fetch, sleep: async () => undefined }, source.id, { trigger: "MANUAL" });
    expect(outcome).toMatchObject({ status: "SUCCEEDED" });
    expect(outcome.stats.assetsImported).toBe(2);

    const assets = Object.fromEntries((await prisma.asset.findMany()).map((a) => [a.sourcePath, a]));
    expect(assets["images/diagram.svg"]).toMatchObject({ mimeType: "image/svg+xml", kind: "IMAGE", siteId: built.site.id, sourceId: source.id });
    expect(assets["images/photo.png"]).toMatchObject({ mimeType: "image/png" });
    expect(readFileSync(storagePathFor(assets["images/diagram.svg"]!.storageKey), "utf8")).not.toMatch(/script|onclick/);

    const page = await prisma.page.findFirstOrThrow({ where: { sourcePath: "README.md" } });
    const urls = JSON.stringify(page.content);
    expect(urls).toContain(`/api/files/${assets["images/diagram.svg"]!.id}`);
    expect(urls).toContain(`/api/files/${assets["images/photo.png"]!.id}`);
    expect(urls).not.toContain("./images/");
  });
});
