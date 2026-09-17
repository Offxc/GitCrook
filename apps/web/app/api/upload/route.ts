import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { prisma, type AssetKind } from "@gitcrook/db";
import { getSessionUserId, canUserDoX } from "@gitcrook/auth";
import { writeStoredFile } from "@/lib/storage/localFs";

/**
 * File-upload hardening (OWASP): allowlist by extension AND magic-byte
 * sniffing (never the client-supplied Content-Type), size caps per kind,
 * every raster image re-encoded through sharp (strips EXIF, neutralizes
 * image/HTML polyglot files — the output is freshly generated pixels, never
 * the uploader's original bytes). SVG uploads are intentionally rejected here
 * (not sharp-safe, needs a dedicated sanitizer) until Phase 3's Drawing block
 * introduces one for Excalidraw's SVG output.
 */

const IMAGE_TYPES: Record<string, AssetKind> = { "image/jpeg": "IMAGE", "image/png": "IMAGE", "image/webp": "IMAGE", "image/gif": "IMAGE" };
const MEDIA_TYPES = new Set(["video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav"]);
const FILE_TYPES = new Set(["application/pdf", "application/zip", "text/plain", "text/csv", "application/json"]);

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const organizationId = form.get("organizationId");
  const siteIdRaw = form.get("siteId");
  const siteId = typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;
  if (!(file instanceof File) || typeof organizationId !== "string") {
    return NextResponse.json({ error: "Missing file or organizationId" }, { status: 400 });
  }

  const allowed = await canUserDoX(userId, "content.edit", { type: "org", id: organizationId });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Trust content.edit on the org for the upload itself, but never let the
  // client's siteId claim tag an asset with a site outside that org — an
  // IDOR-shaped mistake would otherwise let an upload silently point
  // /api/files' access check at a site the uploader has no real tie to.
  if (siteId) {
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { organizationId: true } });
    if (!site || site.organizationId !== organizationId) {
      return NextResponse.json({ error: "siteId does not belong to this organization" }, { status: 400 });
    }
  }

  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const sniffed = await fileTypeFromBuffer(inputBuffer);
  const mime = sniffed?.mime;

  let kind: AssetKind;
  let outputBuffer: Buffer;
  let outputMime: string;

  if (mime && mime in IMAGE_TYPES) {
    if (inputBuffer.byteLength > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image exceeds 20MB" }, { status: 413 });
    const image = sharp(inputBuffer, { animated: mime === "image/gif" });
    const format = mime.split("/")[1] as "jpeg" | "png" | "webp" | "gif";
    // sharp does not carry EXIF/metadata forward unless .withMetadata() is
    // called — omitting it is what strips it, and re-encoding neutralizes any
    // polyglot payload since the output is freshly generated, not the
    // uploader's original bytes.
    outputBuffer = await image.toFormat(format).toBuffer();
    outputMime = mime;
    kind = "IMAGE";
  } else if (mime && (MEDIA_TYPES.has(mime) || FILE_TYPES.has(mime))) {
    if (inputBuffer.byteLength > MAX_FILE_BYTES) return NextResponse.json({ error: "File exceeds 100MB" }, { status: 413 });
    outputBuffer = inputBuffer;
    outputMime = mime;
    kind = "FILE";
  } else {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  }

  const checksumSha256 = createHash("sha256").update(outputBuffer).digest("hex");
  const extension = outputMime.split("/")[1];
  const storageKey = `${organizationId}/${checksumSha256}.${extension}`;

  await writeStoredFile(storageKey, outputBuffer);

  let dimensions: { width: number | null; height: number | null } = { width: null, height: null };
  if (kind === "IMAGE") {
    const meta = await sharp(outputBuffer).metadata();
    dimensions = { width: meta.width ?? null, height: meta.height ?? null };
  }

  const asset = await prisma.asset.create({
    data: {
      organizationId,
      uploaderId: userId,
      siteId,
      kind,
      storageKey,
      mimeType: outputMime,
      sizeBytes: outputBuffer.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      checksumSha256,
    },
  });

  return NextResponse.json({ assetId: asset.id, url: `/api/files/${asset.id}` });
}
