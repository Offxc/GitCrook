import { cache } from "react";
import { prisma } from "@gitcrook/db";

/**
 * Per-request memoized (React's `cache()` — not cross-request; Redis-backed
 * cross-request caching is a Phase 5+ perf addition, not needed for
 * correctness). A layout and its page can both call this without doubling the
 * query.
 */
export const resolveSiteBySlug = cache(async (slug: string) => {
  return prisma.site.findUnique({ where: { slug } });
});

export const resolveSiteByHostname = cache(async (hostname: string) => {
  const domain = await prisma.customDomain.findUnique({
    where: { hostname, status: "ACTIVE" },
    include: { site: true },
  });
  return domain?.site ?? null;
});

export type ResolvedSite = NonNullable<Awaited<ReturnType<typeof resolveSiteBySlug>>>;
