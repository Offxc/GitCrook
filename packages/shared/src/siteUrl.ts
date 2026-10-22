import { getEnv } from "./env";
import { publishedBaseUrl } from "./sitePaths";

/** A site's live base URL under this deployment's root domain (see `publishedBaseUrl` for the rule). */
export function sitePublishedUrl(site: { slug: string; customDomain?: { hostname: string; status: string } | null }): string {
  const env = getEnv();
  return publishedBaseUrl({ protocol: env.ROOT_PROTOCOL, rootDomain: env.ROOT_DOMAIN, siteSlug: site.slug, customDomain: site.customDomain });
}
