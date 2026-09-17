import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@gitcrook/db";
import { getSessionUserId, resolveVisitorAccess } from "@gitcrook/auth";
import { readStoredFile } from "@/lib/storage/localFs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, include: { site: true } });
  if (!asset) return new NextResponse(null, { status: 404 });

  // A null siteId means either the asset predates this field or is genuinely
  // org-wide (not tied to one site's content) — unrestricted, matching this
  // route's original behavior. A real site gets that site's own visitor
  // access check (public/private/password/share-link), same rule a page
  // itself gets in renderPublishedSite.tsx — an image embedded in a Private
  // site's content shouldn't be fetchable by anyone who has the URL.
  if (asset.site) {
    const [userId, jar] = await Promise.all([getSessionUserId(), cookies()]);
    const access = await resolveVisitorAccess({
      site: asset.site,
      userId,
      passwordProofCookie: jar.get(`vd-pw-${asset.site.id}`)?.value,
      shareLinkToken: req.nextUrl.searchParams.get("token") ?? undefined,
    });
    if (access.status !== "allow") return new NextResponse(null, { status: 404 });
  }

  const data = await readStoredFile(asset.storageKey);
  // FONT included: an `attachment` disposition is a download hint for direct
  // navigation, but it's a real risk of breaking @font-face's `url()` load in
  // at least some browsers — no reason to court that for a resource that's
  // never meant to be downloaded standalone (Phase 4 theming's custom font upload).
  const isInlineable = asset.kind === "IMAGE" || asset.kind === "FONT" || asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("audio/");

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Disposition": isInlineable ? "inline" : "attachment",
      // A restricted asset's bytes never change, but WHO may fetch them can
      // (private -> public, a password rotated) — caching that as if it
      // can't change would let a revoked visitor's browser/CDN keep serving
      // it long after access was pulled. Only the truly unrestricted case
      // gets the immutable, cache-forever treatment.
      "Cache-Control": asset.site ? "private, no-store" : "public, max-age=31536000, immutable",
    },
  });
}
