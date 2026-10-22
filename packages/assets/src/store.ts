import { createHash } from "node:crypto";
import { prisma } from "@gitcrook/db";
import { deleteStoredFile, writeStoredFile } from "@gitcrook/shared/server";
import type { Processed } from "./process";

export interface StoredAsset {
  id: string;
  /** The address to put in a page. */
  url: string;
}

/**
 * Writes a processed file to storage and records it. The storage key is the content's checksum, so the same file
 * uploaded twice is stored once. A file that came from a repository is identified by `(sourceId, sourcePath)`: syncing
 * the same path again updates that row rather than adding another.
 */
export async function storeAsset(input: {
  organizationId: string;
  siteId?: string | null;
  uploaderId?: string | null;
  processed: Extract<Processed, { ok: true }>;
  source?: { sourceId: string; sourcePath: string; sourceBlobSha: string };
}): Promise<StoredAsset> {
  const { processed } = input;
  const checksumSha256 = createHash("sha256").update(processed.bytes).digest("hex");
  const storageKey = `${input.organizationId}/${checksumSha256}.${processed.extension}`;
  await writeStoredFile(storageKey, processed.bytes);

  const data = {
    organizationId: input.organizationId,
    uploaderId: input.uploaderId ?? null,
    siteId: input.siteId ?? null,
    kind: processed.kind,
    storageKey,
    mimeType: processed.mime,
    sizeBytes: processed.bytes.byteLength,
    width: processed.width,
    height: processed.height,
    checksumSha256,
  };

  // The file this path pointed at before, if the new content is different: nothing may be left behind when it is replaced.
  const previous = input.source
    ? await prisma.asset.findUnique({ where: { sourceId_sourcePath: { sourceId: input.source.sourceId, sourcePath: input.source.sourcePath } }, select: { storageKey: true } })
    : null;

  const asset = input.source
    ? await prisma.asset.upsert({
        where: { sourceId_sourcePath: { sourceId: input.source.sourceId, sourcePath: input.source.sourcePath } },
        create: { ...data, sourceId: input.source.sourceId, sourcePath: input.source.sourcePath, sourceBlobSha: input.source.sourceBlobSha },
        update: { ...data, sourceBlobSha: input.source.sourceBlobSha },
        select: { id: true },
      })
    : await prisma.asset.create({ data, select: { id: true } });
  if (previous && previous.storageKey !== storageKey && (await prisma.asset.count({ where: { storageKey: previous.storageKey } })) === 0) {
    await deleteStoredFile(previous.storageKey).catch(() => undefined);
  }
  return { id: asset.id, url: `/api/files/${asset.id}` };
}
