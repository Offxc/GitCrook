import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveSiteBySlug } from "@/lib/tenancy/resolveSite";
import { renderPublishedPage, publishedSiteMetadata } from "@/lib/tenancy/renderPublishedSite";

interface PageProps {
  params: Promise<{ siteSlug: string; path?: string[] }>;
}

export default async function PublishedPage({ params }: PageProps) {
  const { siteSlug, path } = await params;
  const site = await resolveSiteBySlug(siteSlug);
  if (!site) notFound();
  return renderPublishedPage(site, path ?? [], `/${siteSlug}`);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { siteSlug, path } = await params;
  const site = await resolveSiteBySlug(siteSlug);
  return publishedSiteMetadata(site, path ?? []);
}
