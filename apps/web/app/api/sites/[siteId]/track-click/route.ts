import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@gitcrook/shared/server";
import { trackEvent } from "@/lib/analytics/track";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

/**
 * Fed by ClickTracker.tsx via navigator.sendBeacon — fire-and-forget from the
 * browser's side too, so a slow/failed beacon never affects the visitor's
 * actual navigation. Purely additive analytics data, no state to protect,
 * so this accepts any well-formed body without auth — same trust boundary
 * as a pageview itself.
 */
const BodySchema = z.object({
  path: z.string().max(2048),
  linkTarget: z.string().max(2048),
  linkPlacement: z.enum(["header", "footer", "sidebar", "body"]),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = BodySchema.safeParse(json);
  if (parsed.success) {
    const meta = await readRequestMeta();
    const rl = checkRateLimit(`track-click:${siteId}:${meta.ip}`, 60, 60_000);
    if (rl.allowed) trackEvent({ siteId, type: "LINK_CLICK", path: parsed.data.path, linkTarget: parsed.data.linkTarget, linkPlacement: parsed.data.linkPlacement, ...meta });
  }

  // 204 regardless of validation outcome — this is a fire-and-forget beacon,
  // not a user-facing action that should surface an error state.
  return new NextResponse(null, { status: 204 });
}
