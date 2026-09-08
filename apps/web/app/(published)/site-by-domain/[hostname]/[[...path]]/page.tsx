import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveSiteByHostname } from "@/lib/tenancy/resolveSite";
import { renderPublishedSite, publishedSiteMetadata } from "@/lib/tenancy/renderPublishedSite";

interface PageProps {
  params: Promise<{ hostname: string; path?: string[] }>;
  searchParams: Promise<{ token?: string }>;
}

// Mirrors app/(published)/[siteSlug]/[[...path]]/page.tsx, resolving the Site
// by verified custom domain instead of by platform slug — proxy.ts rewrites
// any non-root-domain Host here. All the actual rendering logic lives in
// renderPublishedSite so the two entry points can't drift apart.
export default async function PublishedDomainPage({ params, searchParams }: PageProps) {
  const { hostname, path } = await params;
  const { token } = await searchParams;
  const site = await resolveSiteByHostname(hostname);
  if (!site) notFound();
  return renderPublishedSite(site, path ?? [], "", token);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { hostname, path } = await params;
  const site = await resolveSiteByHostname(hostname);
  return publishedSiteMetadata(site, path ?? []);
}
