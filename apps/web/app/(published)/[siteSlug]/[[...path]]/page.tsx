import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveSiteBySlug } from "@/lib/tenancy/resolveSite";
import { renderPublishedSite, publishedSiteMetadata } from "@/lib/tenancy/renderPublishedSite";

interface PageProps {
  params: Promise<{ siteSlug: string; path?: string[] }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function PublishedPage({ params, searchParams }: PageProps) {
  const { siteSlug, path } = await params;
  const { token } = await searchParams;
  const site = await resolveSiteBySlug(siteSlug);
  if (!site) notFound();
  return renderPublishedSite(site, path ?? [], `/${siteSlug}`, token);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { siteSlug, path } = await params;
  const site = await resolveSiteBySlug(siteSlug);
  return publishedSiteMetadata(site, path ?? []);
}
