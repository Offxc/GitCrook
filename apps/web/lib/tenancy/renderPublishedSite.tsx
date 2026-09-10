import { notFound, permanentRedirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { prisma } from "@voiddocs/db";
import type { ResolvedSite } from "./resolveSite";
import { resolvePublishedPath } from "./resolvePublishedPath";
import { getPageTree, flattenPageTree, pathsForTree, ancestorsOf } from "./getPageTree";
import { BlockNoteRenderer } from "@/lib/renderer/blockRenderer";
import { SiteHeader } from "@/app/(published)/_components/SiteHeader";
import { Sidebar, MobileNav } from "@/app/(published)/_components/Sidebar";
import { SectionTabs } from "@/app/(published)/_components/SectionTabs";
import { PageNav } from "@/app/(published)/_components/PageNav";
import { AnnouncementBanner } from "@/app/(published)/_components/AnnouncementBanner";
import { Footer } from "@/app/(published)/_components/Footer";
import { PasswordGate } from "@/app/(published)/_components/PasswordGate";
import { DarkModeToggle } from "@/app/(published)/_components/DarkModeToggle";
import { TableOfContents } from "@/app/(published)/_components/TableOfContents";
import { extractHeadings } from "@/lib/renderer/extractHeadings";
import { PrivateSiteMessage } from "@/app/(published)/_components/PrivateSiteMessage";
import { PageFeedback } from "@/app/(published)/_components/PageFeedback";
import { ClickTracker } from "@/app/(published)/_components/ClickTracker";
import { ThemeConfigSchema, defaultTheme, themeToCssVars, cssVarsToDeclarationBlock, googleFontsStylesheetUrl, type ThemeConfig } from "@voiddocs/shared";
import { getSessionUserId, resolveVisitorAccess, canUserDoX } from "@voiddocs/auth";
import { EditableArea } from "@/app/(published)/_components/EditableArea";
import { EditModeProvider } from "@/app/(published)/_components/EditModeContext";
import { EditModeToggle } from "@/app/(published)/_components/EditModeToggle";
import { PageIcon } from "@/app/(published)/_components/PageIcon";
import { PageActions } from "@/app/(published)/_components/PageActions";
import { blocksToMarkdown } from "@/lib/renderer/toMarkdown";
import { formatRelativeTime } from "@/lib/renderer/relativeTime";
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

  const { section, space, variant, page, variantOptions, pathPrefix, sections } = resolved;
  trackEvent({ siteId: site.id, type: "PAGEVIEW", pageId: page.id, path: path.join("/"), ...meta });
  const tree = await getPageTree(variant.id);
  const pathMap = pathsForTree(tree);

  const flat = flattenPageTree(tree);
  const activeIndex = flat.findIndex((n) => n.id === page.id);
  const prevNode = activeIndex > 0 ? flat[activeIndex - 1] : null;
  const nextNode = activeIndex >= 0 && activeIndex < flat.length - 1 ? flat[activeIndex + 1] : null;

  // GitBook's breadcrumb is the page's own ancestor chain, prefixed by the
  // section/space only when those are actually meaningful (a single-section
  // site leaves them at their seeded defaults, where showing them is noise).
  const breadcrumbs = [
    ...(section.title !== "Documentation" || space.title !== "Docs" ? [section.title, space.title] : []),
    ...ancestorsOf(tree, page.id).map((node) => node.title),
  ];

  const theme = resolveTheme(site.theme);
  const showPageActions = theme.pageActions.copyAsMarkdown || theme.pageActions.viewAsMarkdown;
  const pageMarkdown = showPageActions ? blocksToMarkdown(page.content) : "";
  // Gated by both a real permission check (never trust theme config for
  // access control) and the site owner's own toggle for whether they want
  // this affordance visible to members at all.
  const canEdit = theme.showToolbarForMembers && userId !== null && !page.isGroup && (await canUserDoX(userId, "content.edit", { type: "page", id: page.id }));
  // Same permission the create actions themselves check — this just decides
  // whether to show the "Add new" control at all, never trusted on its own.
  const canManageContent = theme.showToolbarForMembers && userId !== null && (await canUserDoX(userId, "content.edit", { type: "site", id: site.id }));
  const orgSlugForSidebar = canManageContent ? (await prisma.organization.findUnique({ where: { id: site.organizationId }, select: { slug: true } }))?.slug ?? null : null;
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
      <SectionTabs sections={sections} activeSectionId={section.id} baseHref={baseHref} />
      <EditModeProvider siteId={site.id}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1">
          <Sidebar
            tree={tree}
            paths={pathMap}
            baseHref={baseHref}
            activePageId={page.id}
            sidebarStyle={theme.sidebarStyle}
            showPoweredByBadge={theme.showPoweredByBadge}
            canManageContent={canManageContent}
            orgSlug={orgSlugForSidebar}
            siteId={site.id}
            belowSectionTabs={sections.length > 1}
          />
          <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
            {/* max-w-3xl (768px) is the measured content width on a real
                GitBook site; the old max-w-2xl ran ~100px narrower than the
                reference and made the type feel cramped. */}
            <div className="mx-auto w-full max-w-3xl">
              <MobileNav tree={tree} paths={pathMap} baseHref={baseHref} activePageId={page.id} listStyle={theme.sidebarStyle.listStyle} />
              <header className="mb-6 space-y-3 after:clear-both after:block">
                {showPageActions ? (
                  <div className="float-right -mt-1 ml-4">
                    <PageActions markdown={pageMarkdown} allowCopy={theme.pageActions.copyAsMarkdown} allowView={theme.pageActions.viewAsMarkdown} />
                  </div>
                ) : null}
                {breadcrumbs.length > 0 ? (
                  <nav aria-label="Breadcrumb" className="flow-root text-xs leading-relaxed text-site-ink-muted">
                    {breadcrumbs.map((crumb, i) => (
                      <span key={i}>
                        {i > 0 ? <span className="px-1.5 opacity-60">/</span> : null}
                        {crumb}
                      </span>
                    ))}
                  </nav>
                ) : null}
                <h1
                  className="flex items-center gap-3 text-3xl font-bold leading-tight tracking-tight text-site-ink sm:text-4xl"
                  style={{ fontFamily: "var(--site-font-heading)" }}
                >
                  <PageIcon icon={page.icon} className="h-8 w-8 shrink-0" />
                  {page.title}
                </h1>
                {page.description ? <p className="text-lg leading-7 text-site-ink-muted">{page.description}</p> : null}
              </header>

              <EditableArea
                canEdit={canEdit}
                pageId={page.id}
                organizationId={site.organizationId}
                siteId={site.id}
                initialContent={page.content}
                initialVersion={page.contentVersion}
              >
                <BlockNoteRenderer content={page.content} codeTheme={{ light: theme.codeTheme.light, dark: theme.codeTheme.dark }} />
              </EditableArea>

              <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-site-border pt-4 text-sm text-site-ink-muted">
                <p className="mr-auto">
                  Last updated <time dateTime={page.updatedAt.toISOString()}>{formatRelativeTime(page.updatedAt)}</time>
                </p>
              </div>

              {theme.pagination.enabled ? (
                <PageNav
                  baseHref={baseHref}
                  prev={prevNode ? { title: prevNode.title, path: pathMap.get(prevNode.id) ?? [prevNode.slug] } : null}
                  next={nextNode ? { title: nextNode.title, path: pathMap.get(nextNode.id) ?? [nextNode.slug] } : null}
                />
              ) : null}
            </div>
          </main>
          {/* Outline and page rating both live in the right rail, which is
              where GitBook puts them — the rating used to sit under the
              content, competing with the pagination for the same spot. */}
          <aside className="hidden w-64 shrink-0 py-8 pl-6 pr-6 xl:block">
            <div className="sticky top-24 space-y-6">
              <TableOfContents headings={extractHeadings(page.content)} />
              {theme.pageFeedback.enabled ? <PageFeedback pageId={page.id} /> : null}
            </div>
          </aside>
        </div>
        {canManageContent ? <EditModeToggle settingsHref={orgSlugForSidebar ? `/dashboard/${orgSlugForSidebar}/sites/${site.id}/theme` : undefined} /> : null}
      </EditModeProvider>
      <Footer siteName={site.name} footer={theme.footer} socials={theme.socials} privacyPolicyHref={theme.privacyPolicyHref} />
      <DarkModeToggle />
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
