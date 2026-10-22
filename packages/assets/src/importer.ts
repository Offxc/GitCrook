import { DEFAULT_PROCESS_LIMITS, processAsset, type ProcessLimits } from "./process";
import { prisma } from "@gitcrook/db";
import { storeAsset } from "./store";

/** The shape `@gitcrook/git-sync` asks for; kept structural so the two packages do not depend on each other. */
export interface ImportInput {
  organizationId: string;
  siteId: string;
  sourceId: string;
  path: string;
  sha: string;
  bytes: Uint8Array;
}

/** What the images and files imported from an organization's repositories may add up to. */
export const DEFAULT_ORGANIZATION_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Imports a file from a repository: the same checks as an upload, then stored against `(source, path)`. A file that
 * fails them is refused with a reason the sync run shows next to the file.
 */
export function createAssetImporter(limits: ProcessLimits = DEFAULT_PROCESS_LIMITS, quota: { maxOrganizationBytes: number } = { maxOrganizationBytes: DEFAULT_ORGANIZATION_QUOTA_BYTES }) {
  return {
    async import(input: ImportInput): Promise<{ assetId: string; url: string } | { error: string }> {
      const processed = await processAsset(input.bytes, { filename: input.path }, limits);
      if (!processed.ok) return { error: processed.error };

      // What an organization's repositories may add up to. The file being replaced (same path) does not count against it.
      const [row] = await prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM("sizeBytes"), 0)::float8 AS total FROM "Asset"
        WHERE "organizationId" = ${input.organizationId} AND "sourceId" IS NOT NULL AND NOT ("sourceId" = ${input.sourceId} AND "sourcePath" = ${input.path})`;
      if ((row?.total ?? 0) + processed.bytes.byteLength > quota.maxOrganizationBytes) {
        return { error: `This organization's repositories already hold ${Math.round(quota.maxOrganizationBytes / 1024 / 1024)} MB of images and files, which is the most it may.` };
      }
      const stored = await storeAsset({
        organizationId: input.organizationId,
        siteId: input.siteId,
        processed,
        source: { sourceId: input.sourceId, sourcePath: input.path, sourceBlobSha: input.sha },
      });
      return { assetId: stored.id, url: stored.url };
    },
  };
}
