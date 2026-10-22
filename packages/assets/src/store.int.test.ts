import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

// The storage directory is read once, the first time anything asks for it.
process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), "gitcrook-assets-"));

import { prisma } from "@gitcrook/db";
import { storagePathFor } from "@gitcrook/shared/server";
import { makeOrg, makeSite, resetDatabase } from "../../../tests/support/factory";
import { createAssetImporter } from "./importer";
import { processAsset } from "./process";
import { storeAsset } from "./store";

beforeEach(resetDatabase);

async function fixture() {
  const org = await makeOrg();
  const built = await makeSite({ organizationId: org.id });
  const source = await prisma.gitSource.create({ data: { organizationId: org.id, siteId: built.site.id, variantId: built.variant.id, owner: "a", repo: "b", branch: "main" } });
  return { org, site: built.site, source };
}
const png = (color: number) => sharp({ create: { width: 3, height: 3, channels: 3, background: { r: color, g: 0, b: 0 } } }).png().toBuffer();

describe("storeAsset", () => {
  it("writes the processed bytes under a content-addressed key and records the asset", async () => {
    const { org, site } = await fixture();
    const processed = await processAsset(await png(10), { filename: "a.png" });
    if (!processed.ok) throw new Error("setup");
    const stored = await storeAsset({ organizationId: org.id, siteId: site.id, processed });
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: stored.id } });
    expect(stored.url).toBe(`/api/files/${stored.id}`);
    expect(row).toMatchObject({ kind: "IMAGE", mimeType: "image/png", organizationId: org.id, siteId: site.id, width: 3, height: 3, sizeBytes: processed.bytes.byteLength });
    expect(row.storageKey).toBe(`${org.id}/${row.checksumSha256}.png`);
    expect(readFileSync(storagePathFor(row.storageKey)).equals(processed.bytes)).toBe(true);
  });

  it("stores identical files once", async () => {
    const { org } = await fixture();
    const processed = await processAsset(await png(20), { filename: "a.png" });
    if (!processed.ok) throw new Error("setup");
    const a = await storeAsset({ organizationId: org.id, processed });
    const b = await storeAsset({ organizationId: org.id, processed });
    const rows = await prisma.asset.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(new Set(rows.map((r) => r.storageKey)).size).toBe(1);
  });
});

describe("the importer", () => {
  it("imports a repository file against its source and path, and updates the same row next time", async () => {
    const { org, site, source } = await fixture();
    const importer = createAssetImporter();
    const first = await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "img/logo.png", sha: "sha1", bytes: await png(30) });
    expect("assetId" in first).toBe(true);
    const second = await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "img/logo.png", sha: "sha2", bytes: await png(40) });
    expect(second).toMatchObject({ assetId: (first as { assetId: string }).assetId });
    const rows = await prisma.asset.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceId: source.id, sourcePath: "img/logo.png", sourceBlobSha: "sha2" });
  });

  it("stores a sanitised SVG, never the original", async () => {
    const { org, site, source } = await fixture();
    const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>alert(1)</script><rect width="4" height="4" onclick="x()"/></svg>');
    const result = await createAssetImporter().import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "diagram.svg", sha: "s", bytes });
    expect("assetId" in result).toBe(true);
    const row = await prisma.asset.findFirstOrThrow({ where: { sourcePath: "diagram.svg" } });
    expect(row).toMatchObject({ kind: "IMAGE", mimeType: "image/svg+xml", width: 4, height: 4 });
    const stored = readFileSync(storagePathFor(row.storageKey), "utf8");
    expect(stored).toContain("<rect");
    expect(stored).not.toMatch(/script|onclick|alert/);
  });

  it("refuses what the upload route would refuse, with a reason", async () => {
    const { org, site, source } = await fixture();
    const result = await createAssetImporter().import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "tool.exe", sha: "s", bytes: new TextEncoder().encode("MZ") });
    expect(result).toEqual({ error: "Unsupported file type" });
    expect(await prisma.asset.count()).toBe(0);
  });
});

describe("replacing and limiting imported files", () => {
  it("deletes the stored file a path used to point at when its content changes, but not one still in use", async () => {
    const { org, site, source } = await fixture();
    const importer = createAssetImporter();
    await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "a.png", sha: "1", bytes: await png(50) });
    const before = (await prisma.asset.findMany()).map((r) => r.storageKey);
    expect(existsSync(storagePathFor(before[0]!))).toBe(true);

    await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "a.png", sha: "2", bytes: await png(60) });
    const after = (await prisma.asset.findMany()).map((r) => r.storageKey);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(existsSync(storagePathFor(before[0]!))).toBe(false);
    expect(existsSync(storagePathFor(after[0]!))).toBe(true);

    // Another path with the same content keeps the file alive when the first stops using it.
    await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "b.png", sha: "3", bytes: await png(60) });
    await importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path: "a.png", sha: "4", bytes: await png(70) });
    expect(existsSync(storagePathFor(after[0]!))).toBe(true);
  });

  it("refuses files past the organization's allowance, and lets a replacement through", async () => {
    const { org, site, source } = await fixture();
    const probe = await processAsset(await png(80), { filename: "x.png" });
    if (!probe.ok) throw new Error("setup");
    const size = probe.bytes.byteLength;
    const importer = createAssetImporter(undefined, { maxOrganizationBytes: size * 2 + 5 });
    const put = async (path: string, shade: number) => importer.import({ organizationId: org.id, siteId: site.id, sourceId: source.id, path, sha: path + shade, bytes: await png(shade) });

    expect("assetId" in (await put("one.png", 81))).toBe(true);
    expect("assetId" in (await put("two.png", 82))).toBe(true);
    const third = await put("three.png", 83);
    expect(third).toMatchObject({ error: expect.stringContaining("already hold") });
    // Replacing a file that is already counted does not count it twice.
    expect("assetId" in (await put("one.png", 84))).toBe(true);
  });

  it("refuses an image with more pixels than it may have", async () => {
    const result = await processAsset(await png(90), { filename: "big.png" }, { maxImageBytes: 1_000_000, maxFileBytes: 1_000_000, maxPixels: 4 });
    expect(result).toMatchObject({ ok: false, status: 422 });
    const fine = await processAsset(await png(91), { filename: "ok.png" }, { maxImageBytes: 1_000_000, maxFileBytes: 1_000_000, maxPixels: 9 });
    expect(fine.ok).toBe(true);
  });
});
