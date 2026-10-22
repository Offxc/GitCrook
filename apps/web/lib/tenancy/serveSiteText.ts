import { NextResponse } from "next/server";
import { checkRateLimit } from "@gitcrook/shared/server";
import { readRequestMeta } from "@/lib/analytics/requestMeta";
import { getVisitorAccess } from "./visitorAccess";
import { loadLlmsFull, loadLlmsIndex, loadPageMarkdown } from "./siteTextData";
import type { ResolvedSite } from "./resolveSite";

export type SiteTextKind = "page" | "llms" | "llms-full";

/** Requests per minute per visitor and site. The full text is the expensive one. */
const LIMITS: Record<SiteTextKind, number> = { page: 120, llms: 60, "llms-full": 10 };

const notFound = () => new NextResponse("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/**
 * The text forms of a published site (`siteText.ts`), with the page's own rules: the same visitor access as
 * the HTML page — a private or password-protected site hands out nothing here either, and answers exactly as if
 * the address did not exist — and a limit on how often one visitor may ask.
 */
export async function serveSiteText(site: ResolvedSite | null, kind: SiteTextKind, segments: string[] = []): Promise<NextResponse> {
  if (!site) return notFound();

  const access = await getVisitorAccess(site);
  if (access.status !== "allow") return notFound();

  const meta = await readRequestMeta();
  const limit = checkRateLimit(`site-text:${kind}:${site.id}:${meta.ip}`, LIMITS[kind], 60_000);
  if (!limit.allowed) {
    return new NextResponse("Too many requests\n", { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)), "Content-Type": "text/plain; charset=utf-8" } });
  }

  const body = kind === "llms" ? await loadLlmsIndex(site) : kind === "llms-full" ? await loadLlmsFull(site) : await loadPageMarkdown(site, segments);
  if (body === null) return notFound();

  const isPublic = site.audienceMode === "PUBLIC";
  return new NextResponse(body, {
    headers: {
      "Content-Type": `${kind === "page" ? "text/markdown" : "text/plain"}; charset=utf-8`,
      // Public text may be cached briefly; anything gated must never sit in a shared cache, and is not for search engines.
      "Cache-Control": isPublic ? `public, max-age=${kind === "llms-full" ? 300 : 60}` : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(isPublic ? {} : { "X-Robots-Tag": "noindex, nofollow" }),
    },
  });
}
