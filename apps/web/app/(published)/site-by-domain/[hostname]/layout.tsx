import { notFound } from "next/navigation";
import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";
import { renderPublishedShell } from "@/lib/tenancy/renderPublishedSite";

// Mirrors app/(published)/[siteSlug]/layout.tsx, resolving the Site by verified custom domain instead
// of by platform slug — proxy.ts rewrites any non-root-domain Host here. Links on a custom domain start
// at the root, so the base path is empty.
export default async function PublishedDomainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ hostname: string }> }) {
  const { hostname } = await params;
  const site = await resolveSiteByHostname(hostname);
  if (!site) notFound();
  return renderPublishedShell(site, "", children);
}
