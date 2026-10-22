import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@gitcrook/db";
import { checkRateLimit } from "@gitcrook/shared/server";
import { getVisitorAccess } from "@/lib/tenancy/visitorAccess";
import { readRequestMeta } from "@/lib/analytics/requestMeta";
import { blocksToMarkdown } from "@/lib/renderer/toMarkdown";

/**
 * A page as Markdown, fetched when a reader asks for it ("Copy as Markdown" / "View as Markdown").
 *
 * It used to be serialised into the HTML of every page for every visitor, whether or not they ever
 * opened the menu. Fetching on demand keeps the payload small and puts the access check where the
 * content is: the same visitor rules as the page itself, so a private or password-protected site
 * does not hand out its text through this URL.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { title: true, content: true, isDraft: true, isGroup: true, site: true },
  });
  // The same answer for "no such page" and "not yours": nothing to learn from the difference.
  if (!page || page.isDraft || page.isGroup) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const access = await getVisitorAccess(page.site);
  if (access.status !== "allow") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meta = await readRequestMeta();
  const limit = checkRateLimit(`page-markdown:${page.site.id}:${meta.ip}`, 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } });

  return new NextResponse(blocksToMarkdown(page.content), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Public content may be cached briefly; anything gated must never sit in a shared cache.
      "Cache-Control": page.site.audienceMode === "PUBLIC" ? "public, max-age=60" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
