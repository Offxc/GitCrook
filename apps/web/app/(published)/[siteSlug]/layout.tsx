import { notFound } from "next/navigation";
import { resolveSiteBySlug } from "@/lib/tenancy/resolveSite";
import { renderPublishedShell } from "@/lib/tenancy/renderPublishedSite";

/**
 * The reader shell for a site on the platform's domain. A layout is not re-rendered when the reader
 * moves between pages of the site, so the header, sidebar and everything else in the shell stay
 * mounted — the sidebar keeps its scroll position and open groups because nothing rebuilds it.
 * (See renderPublishedSite.tsx for how the work is split between this and the page.)
 */
export default async function PublishedSiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  const site = await resolveSiteBySlug(siteSlug);
  if (!site) notFound();
  return renderPublishedShell(site, `/${siteSlug}`, children);
}
