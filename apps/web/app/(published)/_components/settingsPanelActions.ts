"use server";

import type { ShareLink, CustomDomain, Variant } from "@gitcrook/db";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { getEnv } from "@gitcrook/shared/server";
import { ThemeConfigSchema, defaultTheme, type ThemeConfig } from "@gitcrook/shared";
import { requireSite } from "@/lib/dashboard/site";
import type { SectionRow } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/sections/SectionsManager";

/**
 * Feeds the settings modal on the published site (SiteSettingsModal).
 *
 * Loaded per panel on demand rather than all at once with the page: a
 * manager viewing their own docs shouldn't pay for a theme + domain +
 * share-link + variant query on every page view just so the settings button
 * is available. Each payload is exactly the props the existing dashboard
 * form for that panel already takes, so the modal reuses those components
 * rather than growing a second implementation of each one.
 */

export type SettingsPanelKey = "theme" | "sections" | "access" | "domain" | "variants";

export type SettingsPanelData =
  | { panel: "theme"; organizationId: string; theme: ThemeConfig }
  | { panel: "sections"; sections: SectionRow[] }
  | { panel: "access"; audienceMode: string; hasPassword: boolean; shareLinks: ShareLink[]; publishedBase: string }
  | { panel: "domain"; domain: CustomDomain | null }
  | { panel: "variants"; variants: Variant[]; publishedBase: string };

export interface SettingsPanelResult {
  data?: SettingsPanelData;
  error?: string;
}

export async function loadSettingsPanel(orgSlug: string, siteId: string, panel: SettingsPanelKey): Promise<SettingsPanelResult> {
  const { site, organization, userId } = await requireSite(orgSlug, siteId);

  // Same gate the settings routes themselves sit behind — the modal is a
  // different door onto the same thing, not a looser one.
  const allowed = await canUserDoX(userId, "site.manageSettings", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to manage this site's settings." };

  const env = getEnv();
  const publishedBase =
    site.customDomain?.status === "ACTIVE" ? `https://${site.customDomain.hostname}` : `${env.ROOT_PROTOCOL}://${env.ROOT_DOMAIN}/${site.slug}`;

  switch (panel) {
    case "theme": {
      const parsed = ThemeConfigSchema.safeParse(site.theme);
      return { data: { panel: "theme", organizationId: organization.id, theme: parsed.success ? parsed.data : defaultTheme() } };
    }
    case "sections": {
      const sections = await prisma.section.findMany({
        where: { siteId: site.id },
        orderBy: { order: "asc" },
        select: { id: true, title: true, slug: true, spaces: { select: { variants: { select: { _count: { select: { pages: true } } } } } } },
      });
      return {
        data: {
          panel: "sections",
          sections: sections.map((section) => ({
            id: section.id,
            title: section.title,
            slug: section.slug,
            pageCount: section.spaces.reduce((total, space) => total + space.variants.reduce((n, variant) => n + variant._count.pages, 0), 0),
          })),
        },
      };
    }
    case "access": {
      const [password, shareLinks] = await Promise.all([
        prisma.sitePassword.findUnique({ where: { siteId: site.id }, select: { siteId: true } }),
        prisma.shareLink.findMany({ where: { siteId: site.id }, orderBy: { createdAt: "desc" } }),
      ]);
      return { data: { panel: "access", audienceMode: site.audienceMode, hasPassword: password !== null, shareLinks, publishedBase } };
    }
    case "domain":
      return { data: { panel: "domain", domain: site.customDomain ?? null } };
    case "variants": {
      const variants = await prisma.variant.findMany({
        where: { space: { section: { siteId: site.id } } },
        orderBy: [{ isDefault: "desc" }, { order: "asc" }],
      });
      return { data: { panel: "variants", variants, publishedBase } };
    }
  }
}
