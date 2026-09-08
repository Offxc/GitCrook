/**
 * Slugs that can never be assigned to a Site, Section, Space, or Page, because they'd
 * collide with real routes/files. This is a UX safety net, not the routing security
 * boundary itself — real app routes (app/(dashboard), app/api, etc.) are static folders
 * that Next.js always matches before a dynamic [siteSlug] segment regardless of this list.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "login",
  "logout",
  "auth",
  "dashboard",
  "_next",
  "_sites",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "assets",
  "site-by-domain",
  "~v",
  ".well-known",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_RE.test(slug) && slug.length >= 1 && slug.length <= 96;
}

export function validateSlug(slug: string): { ok: true } | { ok: false; reason: string } {
  if (!isValidSlugFormat(slug)) {
    return { ok: false, reason: "Slugs may only contain lowercase letters, numbers, and hyphens." };
  }
  if (isReservedSlug(slug)) {
    return { ok: false, reason: `"${slug}" is reserved and can't be used as a slug.` };
  }
  return { ok: true };
}
