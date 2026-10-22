import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { sanitizeSvg } from "./sanitizeSvg";

/**
 * What a file is, and what is safe to keep of it. The same pipeline serves the editor's upload route and the Git
 * Sync worker, so a file gets the same treatment however it arrives.
 *
 *  - the type comes from the file's own bytes, never from a name or a Content-Type the sender chose;
 *  - raster images are decoded and re-encoded, so what is stored is freshly generated pixels (metadata gone, any
 *    image/HTML polyglot neutralised), never the sender's bytes;
 *  - SVG is rebuilt from an allow-list (see sanitizeSvg), never copied;
 *  - text-like files with no magic bytes (txt, csv, json) are accepted by name but only if they really are text.
 */

export interface ProcessLimits {
  maxImageBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_PROCESS_LIMITS: ProcessLimits = { maxImageBytes: 20 * 1024 * 1024, maxFileBytes: 100 * 1024 * 1024 };

const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MEDIA = new Set(["video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/wav"]);
const BINARY_FILES = new Set(["application/pdf", "application/zip"]);
const TEXT_BY_EXTENSION: Record<string, string> = { txt: "text/plain", csv: "text/csv", json: "application/json" };
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
  "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav",
  "application/pdf": "pdf", "application/zip": "zip", "text/plain": "txt", "text/csv": "csv", "application/json": "json",
};

export type Processed =
  | { ok: true; kind: "IMAGE" | "FILE"; mime: string; extension: string; bytes: Buffer; width: number | null; height: number | null }
  | { ok: false; status: 413 | 415 | 422; error: string };

const extensionOf = (name: string | undefined) => /\.([A-Za-z0-9]+)$/.exec(name ?? "")?.[1]?.toLowerCase();

export async function processAsset(input: Uint8Array, hints: { filename?: string } = {}, limits: ProcessLimits = DEFAULT_PROCESS_LIMITS): Promise<Processed> {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const sniffed = await fileTypeFromBuffer(buffer);
  const mime = sniffed?.mime;
  const ext = extensionOf(hints.filename);

  if (mime && RASTER.has(mime)) {
    if (buffer.byteLength > limits.maxImageBytes) return { ok: false, status: 413, error: `Image exceeds ${Math.round(limits.maxImageBytes / 1024 / 1024)}MB` };
    try {
      // Re-encoding is what strips EXIF and neutralises polyglots; sharp carries no metadata forward unless asked to.
      const bytes = await sharp(buffer, { animated: mime === "image/gif" }).toFormat(mime.split("/")[1] as "jpeg" | "png" | "webp" | "gif").toBuffer();
      const meta = await sharp(bytes).metadata();
      return { ok: true, kind: "IMAGE", mime, extension: EXTENSION[mime]!, bytes, width: meta.width ?? null, height: meta.height ?? null };
    } catch {
      return { ok: false, status: 422, error: "The image could not be read." };
    }
  }

  if (mime && (MEDIA.has(mime) || BINARY_FILES.has(mime))) {
    if (buffer.byteLength > limits.maxFileBytes) return { ok: false, status: 413, error: `File exceeds ${Math.round(limits.maxFileBytes / 1024 / 1024)}MB` };
    return { ok: true, kind: "FILE", mime, extension: EXTENSION[mime]!, bytes: buffer, width: null, height: null };
  }

  // Text formats have no magic bytes (an SVG is detected as XML at best), so the name picks the path and the content
  // has to earn it.
  if ((!mime || mime === "application/xml") && ext === "svg") {
    if (buffer.byteLength > limits.maxImageBytes) return { ok: false, status: 413, error: "Image is too large" };
    const result = sanitizeSvg(buffer);
    if (!result.ok) return { ok: false, status: 422, error: result.error };
    return { ok: true, kind: "IMAGE", mime: "image/svg+xml", extension: "svg", bytes: Buffer.from(result.svg, "utf8"), width: result.width, height: result.height };
  }

  if (!mime && ext && ext in TEXT_BY_EXTENSION) {
    if (buffer.byteLength > limits.maxFileBytes) return { ok: false, status: 413, error: `File exceeds ${Math.round(limits.maxFileBytes / 1024 / 1024)}MB` };
    if (buffer.includes(0) || !isUtf8(buffer)) return { ok: false, status: 415, error: "That does not look like a text file." };
    const m = TEXT_BY_EXTENSION[ext]!;
    return { ok: true, kind: "FILE", mime: m, extension: EXTENSION[m]!, bytes: buffer, width: null, height: null };
  }

  return { ok: false, status: 415, error: "Unsupported file type" };
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
