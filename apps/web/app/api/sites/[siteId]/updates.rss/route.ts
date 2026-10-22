import { NextRequest, NextResponse } from "next/server";
import { computePagePaths, prisma } from "@gitcrook/db";
import { joinUrl } from "@gitcrook/shared";
import { sitePublishedUrl } from "@gitcrook/shared/server";
import { getVisitorAccess } from "@/lib/tenancy/visitorAccess";
import { extractPlainText } from "@/lib/editor/extractText";

/**
 * Auto RSS feed for the "Updates" (changelog) block — GitBook ships one per
 * site with no separate setup step, so this walks every published page's
 * content for "updates" containers rather than requiring pages to register
 * themselves anywhere. Duck-typed against the stored JSON (same reasoning as
 * lib/editor/extractText.ts) so new block types never need to touch this file.
 */

interface FeedItem {
  date: string;
  tags: string[];
  title: string;
  pageId: string;
  blockId: string;
}

interface RawBlock {
  id?: unknown;
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { customDomain: true } });
  if (!site) return new NextResponse("Not found", { status: 404 });

  // Same rule as the page itself: a feed for a Private/Password site
  // shouldn't leak its changelog to anyone who has the URL.
  const access = await getVisitorAccess(site);
  if (access.status !== "allow") return new NextResponse("Not found", { status: 404 });

  const pages = await prisma.page.findMany({
    where: { siteId, isDraft: false, deletedAt: null },
    select: { id: true, content: true },
  });

  const items: FeedItem[] = [];
  for (const page of pages) findUpdateItems(page.content, page.id, items);

  items.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : NaN;
    const tb = b.date ? Date.parse(b.date) : NaN;
    return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
  });

  const baseUrl = sitePublishedUrl(site);

  const shown = items.slice(0, 50);
  const paths = await computePagePaths(shown.map((item) => item.pageId));
  const entries = await Promise.all(
    shown.map(async (item) => {
      const path = paths.get(item.pageId);
      const link = path ? joinUrl(baseUrl, path) : baseUrl;
      const pubDate = item.date && !Number.isNaN(Date.parse(item.date)) ? new Date(item.date).toUTCString() : null;
      const categories = item.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join("\n");
      return [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(`${item.pageId}/${item.blockId}`)}</guid>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : null,
        categories || null,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${site.name} — Updates`)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(`Product updates and release notes for ${site.name}`)}</description>
    <language>${escapeXml(site.defaultLocale)}</language>
${entries.join("\n")}
  </channel>
</rss>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // Only a public site's feed may sit in a shared cache; for anything gated the
      // response depends on who asked, so a CDN or proxy must not keep or reuse it.
      "Cache-Control": site.audienceMode === "PUBLIC" ? "public, max-age=300" : "private, no-store",
    },
  });
}

function findUpdateItems(blocks: unknown, pageId: string, out: FeedItem[]): void {
  if (!Array.isArray(blocks)) return;
  for (const raw of blocks as RawBlock[]) {
    if (typeof raw !== "object" || raw === null) continue;
    if (raw.type === "updates" && Array.isArray(raw.children)) {
      for (const rawChild of raw.children as RawBlock[]) {
        if (typeof rawChild !== "object" || rawChild === null || rawChild.type !== "update") continue;
        const date = typeof rawChild.props?.date === "string" ? rawChild.props.date : "";
        const tagsRaw = typeof rawChild.props?.tags === "string" ? rawChild.props.tags : "";
        const tags = tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const title = extractPlainText([rawChild]) || "Untitled update";
        const blockId = typeof rawChild.id === "string" ? rawChild.id : `${pageId}-${out.length}`;
        out.push({ date, tags, title, pageId, blockId });
      }
    }
    findUpdateItems(raw.children, pageId, out);
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
