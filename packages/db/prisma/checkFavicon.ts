/**
 * Diagnoses why a site's favicon might not load: reports the theme's
 * configured favicon asset id, the matching Asset row (kind/mimeType/site
 * scoping, which together decide whether /api/files serves it inline and to
 * whom), and whether its bytes are actually on disk. Content-free.
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/checkFavicon.ts <siteSlug>
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/client";

async function main() {
  const siteSlug = process.argv[2];
  if (!siteSlug) throw new Error("Usage: tsx prisma/checkFavicon.ts <siteSlug>");

  const site = await prisma.site.findUnique({ where: { slug: siteSlug } });
  if (!site) throw new Error(`No site with slug "${siteSlug}"`);

  console.log(`Site: ${site.name} (${site.id})`);
  console.log(`  slug=${site.slug}  audienceMode=${site.audienceMode}  organizationId=${site.organizationId}`);

  const theme = site.theme as { branding?: { faviconAssetId?: string | null } } | null;
  const faviconAssetId = theme?.branding?.faviconAssetId ?? null;
  console.log(`  theme.branding.faviconAssetId = ${JSON.stringify(faviconAssetId)}`);

  if (!faviconAssetId) {
    console.log("\n=> No favicon id stored on the theme. The upload may have succeeded without the theme being saved.");
    return;
  }

  const asset = await prisma.asset.findUnique({ where: { id: faviconAssetId } });
  if (!asset) {
    console.log(`\n=> No Asset row with id ${faviconAssetId} — the theme points at an asset that doesn't exist, so /api/files returns 404.`);
    return;
  }

  console.log(`\nAsset ${asset.id}`);
  console.log(`  kind=${asset.kind}  mimeType=${asset.mimeType}  sizeBytes=${asset.sizeBytes}`);
  console.log(`  organizationId=${asset.organizationId}  siteId=${asset.siteId ?? "null"}`);
  console.log(`  storageKey=${asset.storageKey}`);

  // Mirrors the route's own rule: only IMAGE/FONT/video/audio are sent inline;
  // anything else gets Content-Disposition: attachment, which a browser will
  // not render as a favicon.
  const inlineable = asset.kind === "IMAGE" || asset.kind === "FONT" || asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("audio/");
  console.log(`  -> served ${inlineable ? "inline (ok for a favicon)" : "as an attachment (a browser will NOT use this as a favicon)"}`);

  if (asset.siteId) {
    console.log(`  -> scoped to a site, so /api/files applies that site's visitor-access check.`);
    console.log(`     audienceMode=${site.audienceMode}: anyone who hasn't passed that gate gets a 404 for the favicon.`);
  } else {
    console.log(`  -> not site-scoped, so /api/files serves it to everyone (no access check).`);
  }

  const storageDir = process.env.STORAGE_DIR ?? "/data/uploads";
  const path = join(storageDir, asset.storageKey);
  if (existsSync(path)) {
    console.log(`\nBytes on disk: present (${statSync(path).size} bytes at ${path})`);
  } else {
    console.log(`\nBytes on disk: MISSING at ${path} — /api/files will fail even though the rows look right.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
