import { DEFAULT_PROCESS_LIMITS, processAsset, type ProcessLimits } from "./process";
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

/**
 * Imports a file from a repository: the same checks as an upload, then stored against `(source, path)`. A file that
 * fails them is refused with a reason the sync run shows next to the file.
 */
export function createAssetImporter(limits: ProcessLimits = DEFAULT_PROCESS_LIMITS) {
  return {
    async import(input: ImportInput): Promise<{ assetId: string; url: string } | { error: string }> {
      const processed = await processAsset(input.bytes, { filename: input.path }, limits);
      if (!processed.ok) return { error: processed.error };
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
