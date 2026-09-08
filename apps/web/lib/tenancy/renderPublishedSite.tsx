import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { prisma } from "@voiddocs/db";
import type { ResolvedSite } from "./resolveSite";
import { resolvePublishedPath } from "./resolvePublishedPath";
import { getPageTree, flattenPageTree, pathsForTree } from "./getPageTree";
import { BlockNoteRenderer } from "@/lib/renderer/blockRenderer";
import { SiteHeader } from "@/app/(published)/_components/SiteHeader";
import { Sidebar } from "@/app/(published)/_components/Sidebar";
import { PageNav } from "@/app/(published)/_components/PageNav";
import { AnnouncementBanner } from "@/app/(published)/_components/AnnouncementBanner";
import { Footer } from "@/app/(published)/_components/Footer";
import { PasswordGate } from "@/app/(published)/_components/PasswordGate";
import { PrivateSiteMessage } from "@/app/(published)/_components/PrivateSiteMessage";
import { PageFeedback } from "@/app/(published)/_components/PageFeedback";
import { ClickTracker } from "@/app/(published)/_components/ClickTracker";
import { ThemeConfigSchema, defaultTheme, themeToCssVars, cssVarsToDeclarationBlock, googleFontsStylesheetUrl, type ThemeConfig } from "@voiddocs/shared";
import { getSessionUserId, resolveVisitorAccess } from "@voiddocs/auth";
import { trackEvent } from "@/lib/analytics/track";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

/** Site.theme is only ever written by our own validated Server Action (see the theme settings action), so this should always parse — safeParse is a defensive fallback, not an expected path. */
function resolveTheme(rawTheme: unknown): ThemeConfig {
  const result = ThemeConfigSchema.safeParse(rawTheme);
  return result.success ? result.data : defaultTheme();
}

const CUSTOM_FONT_FAMILY = "VoidDocsCustomFont";

/**
 * Shared by both published-site entry points ([siteSlug] on the root domain,
 * and site-by-domain/[hostname] for verified custom domains) — they differ
 * only in how they resolve `site` and what `baseHref` visitors' links should
 * use, so that's the only thing each thin route file passes in.
 */
export async function renderPublishedSite(site: ResolvedSite, path: string[], baseHref: string, shareLinkToken?: string) {
  const [userId, jar] = await Promise.all([getSessionUserId(), cookies()]);
  const access = await resolveVisitorAccess({
    site,
    userId,
    passwordProofCookie: jar.get(`vd-pw-${site.id}`)?.value,
    shareLinkToken,
  });
  if (access.status === "denied") return <PrivateSiteMessage siteName={site.name} />;
  if (access.status === "passwordRequired") {
    return <PasswordGate siteId={site.id} siteName={site.name} redirectTo={`${baseHref}/${path.join("/")}`} />;
  }

  const meta = await readRequestMeta();
  const resolved = await resolvePublishedPath(site, path);
  if (!resolved) {
    const redirectRule = await prisma.siteRedirect.findUnique({ where: { siteId_fromPath: { siteId: site.id, fromPath: path.join("/") } } });
    if (redirectRule) permanentRedirect(`${baseHref}/${redirectRule.toPath}`);

    trackEvent({ siteId: site.id, type: "NOT_FOUND", path: path.join("/"), ...meta });
    notFound();
  }

  const { section, space, variant, page, variantOptions, pathPrefix } = resolved;
  trackEvent({ siteId: site.id, type: "PAGEVIEW", pageId: page.id, path: path.join("/"), ...meta });
  const tree = await getPageTree(variant.id);
  const pathMap = pathsForTree(tree);

  const flat = flattenPageTree(tree);
  const activeIndex = flat.findIndex((n) => n.id === page.id);
  const prevNode = activeIndex > 0 ? flat[activeIndex - 1] : null;
  const nextNode = activeIndex >= 0 && activeIndex < flat.length - 1 ? flat[activeIndex + 1] : null;

  const showBreadcrumb = section.title !== "Documentation" || space.title !== "Docs";

  const theme = resolveTheme(site.theme);
  const cssVars = themeToCssVars(theme);
  if (theme.fonts.customFontAssetId) {
    const customFontVar = `"${CUSTOM_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`;
    cssVars.light["--site-font-body"] = customFontVar;
    cssVars.dark["--site-font-body"] = customFontVar;
  }
  const fontFace = theme.fonts.customFontAssetId
    ? `@font-face{font-family:"${CUSTOM_FONT_FAMILY}";src:url(/api/files/${theme.fonts.customFontAssetId});font-display:swap;}`
    : "";
  const styleBlock = `${fontFace}[data-site-root]{${cssVarsToDeclarationBlock(cssVars.light)}}@media (prefers-color-scheme: dark){[data-site-root]:not([data-site-mode="light"]){${cssVarsToDeclarationBlock(cssVars.dark)}}}[data-site-root][data-site-mode="dark"]{${cssVarsToDeclarationBlock(cssVars.dark)}}`;

  const googleFontsHref = googleFontsStylesheetUrl([theme.fonts.body, theme.fonts.heading, theme.fonts.mono]);

  const rootClassNames = [
    "flex min-h-screen flex-col bg-site-canvas",
    theme.cornerStyle === "straight" ? "vd-corners-straight" : "",
    theme.depthStyle === "flat" ? "vd-depth-flat" : "",
    theme.linkStyle === "accent" ? "vd-links-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const hasTint = Boolean(theme.tintColor.light || theme.tintColor.dark);

  return (
    <div data-site-root data-tint={hasTint ? "true" : undefined} className={rootClassNames}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- per-site dynamic value, can't be a build-time next/font import */}
      {googleFontsHref ? <link rel="stylesheet" href={googleFontsHref} /> : null}
      <style dangerouslySetInnerHTML={{ __html: styleBlock }} />
      <ClickTracker siteId={site.id} />
      <AnnouncementBanner announcement={theme.announcement} />
      <SiteHeader
        siteName={site.name}
        baseHref={baseHref}
        siteId={site.id}
        variant={variant}
        variantOptions={variantOptions}
        variantPathPrefix={pathPrefix}
        header={theme.header}
        primaryLinkHref={theme.primaryLinkHref}
        externalLinksNewTab={theme.externalLinksNewTab}
        logoAssetId={theme.branding.logoAssetId}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <Sidebar tree={tree} paths={pathMap} baseHref={baseHref} activePageId={page.id} siteName={site.name} sidebarStyle={theme.sidebarStyle} />
        <main className="min-w-0 flex-1 px-8 py-10">
          <div className="mx-auto max-w-2xl">
            {showBreadcrumb ? (
              <p className="mb-2 text-xs text-site-ink-muted">
                {section.title} / {space.title}
              </p>
            ) : null}
            <h1 className="text-3xl font-semibold text-site-ink" style={{ fontFamily: "var(--site-font-heading)" }}>
              {page.title}
            </h1>
            <div className="mt-6">
              <BlockNoteRenderer content={page.content} codeTheme={{ light: theme.codeTheme.light, dark: theme.codeTheme.dark }} />
            </div>
            {theme.pageFeedback.enabled ? <PageFeedback pageId={page.id} /> : null}
            {theme.pagination.enabled ? (
              <PageNav
                baseHref={baseHref}
                prev={prevNode ? { title: prevNode.title, path: pathMap.get(prevNode.id) ?? [prevNode.slug] } : null}
                next={nextNode ? { title: nextNode.title, path: pathMap.get(nextNode.id) ?? [nextNode.slug] } : null}
              />
            ) : null}
          </div>
        </main>
      </div>
      <Footer siteName={site.name} footer={theme.footer} socials={theme.socials} showPoweredByBadge={theme.showPoweredByBadge} privacyPolicyHref={theme.privacyPolicyHref} />
    </div>
  );
}

export async function publishedSiteMetadata(site: ResolvedSite | null, path: string[]): Promise<Metadata> {
  if (!site) return {};
  const resolved = await resolvePublishedPath(site, path);
  if (!resolved) return {};
  const theme = resolveTheme(site.theme);
  return {
    title: `${resolved.page.title} — ${site.name}`,
    description: resolved.page.description ?? undefined,
    alternates: {
      types: { "application/rss+xml": `/api/sites/${site.id}/updates.rss` },
    },
    icons: theme.branding.faviconAssetId ? { icon: `/api/files/${theme.branding.faviconAssetId}` } : undefined,
  };
}
