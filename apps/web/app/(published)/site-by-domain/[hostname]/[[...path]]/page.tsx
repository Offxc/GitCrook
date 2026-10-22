import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";
import { renderPublishedPage, publishedSiteMetadata } from "@/lib/tenancy/renderPublishedSite";

interface PageProps {
  params: Promise<{ hostname: string; path?: string[] }>;
}

// Mirrors app/(published)/[siteSlug]/[[...path]]/page.tsx, resolving the Site
// by verified custom domain instead of by platform slug. All the actual rendering
// lives in renderPublishedSite so the two entry points can't drift apart.
export default async function PublishedDomainPage({ params }: PageProps) {
  const { hostname, path } = await params;
  const site = await resolveSiteByHostname(hostname);
  if (!site) notFound();
  return renderPublishedPage(site, path ?? [], "");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { hostname, path } = await params;
  const site = await resolveSiteByHostname(hostname);
  return publishedSiteMetadata(site, path ?? []);
}
