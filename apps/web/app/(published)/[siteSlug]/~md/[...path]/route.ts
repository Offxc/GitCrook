import { resolveSiteBySlug } from "@/lib/tenancy/resolveSite";
import { serveSiteText } from "@/lib/tenancy/serveSiteText";

// `/{site}/{page}.md` — the proxy rewrites it here (a `.md` suffix cannot be a route of its own). `~` is not a
// character a page slug can contain, so no page can be shadowed by this folder.
export async function GET(_req: Request, { params }: { params: Promise<{ siteSlug: string; path: string[] }> }) {
  const { siteSlug, path } = await params;
  return serveSiteText(await resolveSiteBySlug(siteSlug), "page", path);
}
