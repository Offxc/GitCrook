import { NextRequest, NextResponse } from "next/server";
import { processAsset, storeAsset } from "@gitcrook/assets";
import { prisma } from "@gitcrook/db";
import { getSessionUserId, canUserDoX } from "@gitcrook/auth";
import { checkRateLimit } from "@gitcrook/shared/server";

/**
 * Uploads. This route checks who is asking and how much they are sending; what the file is, and what is safe to
 * keep of it, is decided by `processAsset` in @gitcrook/assets (type from the file's own bytes, raster images
 * re-encoded, SVG rebuilt from an allow-list), so a file gets the same treatment whether an editor uploads it or
 * a repository brings it in.
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** Multipart framing around the file itself (boundaries, field headers, the other fields). */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A request with no Content-Length (chunked) used to read as 0 and sail past the size
  // check, and the whole body is then buffered in memory. Require a declared length and
  // enforce it; the reverse proxy caps the body independently.
  const declaredLength = req.headers.get("content-length");
  if (!declaredLength) return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
  const contentLength = Number(declaredLength);
  if (!Number.isFinite(contentLength) || contentLength <= 0) return NextResponse.json({ error: "Invalid Content-Length" }, { status: 400 });
  if (contentLength > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  // Each upload is parsed, sniffed and (for images) re-encoded in this process, so it is
  // the costliest thing an editor can ask for. A generous per-user ceiling stops a script
  // or a stuck client from monopolising it.
  const rl = checkRateLimit(`upload:${userId}`, 60, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many uploads — try again in a minute" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const form = await req.formData();
  const file = form.get("file");
  const organizationId = form.get("organizationId");
  const siteIdRaw = form.get("siteId");
  const siteId = typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;
  if (!(file instanceof File) || typeof organizationId !== "string") {
    return NextResponse.json({ error: "Missing file or organizationId" }, { status: 400 });
  }

  // A site is validated against the organization first, so the client can't tag an asset
  // with a site outside it (an IDOR that would point /api/files' access check at a site
  // the uploader has no tie to). Then authorise on the narrowest thing being written to:
  // the site, so an editor granted access to just this site can upload, and the org
  // otherwise.
  if (siteId) {
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { organizationId: true } });
    if (!site || site.organizationId !== organizationId) {
      return NextResponse.json({ error: "siteId does not belong to this organization" }, { status: 400 });
    }
  }
  const allowed = await canUserDoX(userId, "content.edit", siteId ? { type: "site", id: siteId } : { type: "org", id: organizationId });
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // What a file is, and what is safe to keep of it, is decided in @gitcrook/assets: the same checks run for a
  // file a repository brings in.
  const processed = await processAsset(new Uint8Array(await file.arrayBuffer()), { filename: file.name });
  if (!processed.ok) return NextResponse.json({ error: processed.error }, { status: processed.status });

  const stored = await storeAsset({ organizationId, siteId, uploaderId: userId, processed });
  return NextResponse.json({ assetId: stored.id, url: stored.url });
}
