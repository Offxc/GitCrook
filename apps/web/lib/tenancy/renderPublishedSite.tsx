import { notFound, permanentRedirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { prisma } from "@gitcrook/db";
import {
  ThemeConfigSchema,
  defaultTheme,
  themeToCssVars,
  cssVarsToDeclarationBlock,
  googleFontsStylesheetUrl,
  flattenNavigablePages,
  pathsForTree,
  prefixPaths,
  ancestorsOf,
  variantSegments,
  type ThemeConfig,
} from "@gitcrook/shared";
import { canUserDoX } from "@gitcrook/auth";
import { editUrl, hostConfigFromEnv } from "@gitcrook/git-sync";
import type { ResolvedSite } from "./resolveSite";
import { resolvePublishedPath } from "./resolvePublishedPath";
import { getPageTree } from "./getPageTree";
import { loadShellStructure } from "./siteStructure";
import { getViewerId, getVisitorAccess } from "./visitorAccess";
import { BlockNoteRenderer } from "@/lib/renderer/blockRenderer";
import { SiteHeader } from "@/app/(published)/_components/SiteHeader";
import { Sidebar, MobileNav } from "@/app/(published)/_components/Sidebar";
import { SectionTabs } from "@/app/(published)/_components/SectionTabs";
import { SiteNavProvider } from "@/app/(published)/_components/SiteNavProvider";
import { PageNav } from "@/app/(published)/_components/PageNav";
import { AnnouncementBanner } from "@/app/(published)/_components/AnnouncementBanner";
import { Footer } from "@/app/(published)/_components/Footer";
import { PasswordGate } from "@/app/(published)/_components/PasswordGate";
import { DarkModeToggle } from "@/app/(published)/_components/DarkModeToggle";
import { SITE_MODE_COOKIE, isSiteMode, siteModeAttribute } from "@/app/(published)/_components/siteMode";
import { TableOfContents } from "@/app/(published)/_components/TableOfContents";
import { extractHeadings } from "@/lib/renderer/extractHeadings";
import { PrivateSiteMessage } from "@/app/(published)/_components/PrivateSiteMessage";
import { PageFeedback } from "@/app/(published)/_components/PageFeedback";
import { ClickTracker } from "@/app/(published)/_components/ClickTracker";
import { EditableArea } from "@/app/(published)/_components/EditableArea";
import { EditModeProvider } from "@/app/(published)/_components/EditModeContext";
import { editModeCookieName } from "@/app/(published)/_components/editModeCookie";
import { EditModeToggle } from "@/app/(published)/_components/EditModeToggle";
import { PageIcon } from "@/app/(published)/_components/PageIcon";
import { PageActions } from "@/app/(published)/_components/PageActions";
import { formatRelativeTime } from "@/lib/renderer/relativeTime";
import { trackEvent } from "@/lib/analytics/track";
import { readRequestMeta } from "@/lib/analytics/requestMeta";

/** Site.theme is only ever written by our own validated Server Action (see the theme settings action), so this should always parse — safeParse is a defensive fallback, not an expected path. */
function resolveTheme(rawTheme: unknown): ThemeConfig {
  const result = ThemeConfigSchema.safeParse(rawTheme);
  return result.success ? result.data : defaultTheme();
}

const CUSTOM_FONT_FAMILY = "GitCrookCustomFont";

/**
 * A published site is two layers, and the split is what keeps the sidebar where the reader left it:
 *
 *  - the SHELL (`renderPublishedShell`, rendered by the site's layout): theme, header, section tabs,
 *    sidebar, footer, the dark-mode and edit toggles. Next.js does not re-render a layout when you
 *    navigate between its pages, so none of this is rebuilt on a click. It loads the site's whole
 *    structure once, and the browser works out which page is active from the URL.
 *  - the PAGE (`renderPublishedPage`, rendered by the route's page): the content column and the
 *    outline. Only this is fetched when the reader moves to another page.
 *
 * Both entry points — `[siteSlug]` on the root domain and `site-by-domain/[hostname]` for verified
 * custom domains — differ only in how they find the site and what `baseHref` their links start with.
 */

// -------------------------------------------------------------------------------------------------
// Shell
// -------------------------------------------------------------------------------------------------

export async function renderPublishedShell(site: ResolvedSite, baseHref: string, children: React.ReactNode) {
  const [userId, jar, access] = await Promise.all([getViewerId(), cookies(), getVisitorAccess(site)]);

  const theme = resolveTheme(site.theme);
  // The reader's own choice wins, then the site's configured default. A site that
  // turned dark mode off is pinned to light (and shows no toggle).
  const storedMode = jar.get(SITE_MODE_COOKIE)?.value;
  const preferredMode = isSiteMode(storedMode) ? storedMode : theme.darkMode.default;
  const effectiveMode = theme.darkMode.enabled ? preferredMode : "light";

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

  const frame = (inner: React.ReactNode) => (
    <div data-site-root data-site-mode={siteModeAttribute(effectiveMode)} data-tint={hasTint ? "true" : undefined} className={rootClassNames}>
      {googleFontsHref ? <link rel="stylesheet" href={googleFontsHref} /> : null}
      <style dangerouslySetInnerHTML={{ __html: styleBlock }} />
      {inner}
    </div>
  );

  // A visitor who is not allowed in gets the gate (themed, like the rest of the site) and none of the
  // structure: no page titles, no tree, no search.
  if (access.status === "denied") return frame(<PrivateSiteMessage siteName={site.name} />);
  if (access.status === "passwordRequired") return frame(<PasswordGate siteId={site.id} siteName={site.name} />);

  // Same permission the create actions themselves check — this just decides
  // whether to show the "Add new" control at all, never trusted on its own.
  const canManageContent = theme.showToolbarForMembers && userId !== null && (await canUserDoX(userId, "content.edit", { type: "site", id: site.id }));
  const [sections, orgSlugForSidebar, managedVariantIds] = await Promise.all([
    loadShellStructure(site.id),
    canManageContent ? prisma.organization.findUnique({ where: { id: site.organizationId }, select: { slug: true } }).then((o) => o?.slug ?? null) : null,
    // A version a Git repository fills is changed in the repository, so its edit controls are not offered.
    canManageContent ? prisma.gitSource.findMany({ where: { siteId: site.id }, select: { variantId: true } }).then((rows) => rows.map((r) => r.variantId)) : [],
  ]);
  // Edit mode is a cookie so the very first render is already the right one (see editModeCookie.ts).
  const initialEditing = canManageContent && jar.get(editModeCookieName(site.id))?.value === "1";
  // proxy.ts mints a CSP nonce per request; the sidebar's pre-hydration script needs it to be allowed to run.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return frame(
    <SiteNavProvider siteId={site.id} baseHref={baseHref} sections={sections}>
      <ClickTracker siteId={site.id} />
      <AnnouncementBanner announcement={theme.announcement} />
      <SiteHeader
        siteName={site.name}
        baseHref={baseHref}
        siteId={site.id}
        header={theme.header}
        primaryLinkHref={theme.primaryLinkHref}
        externalLinksNewTab={theme.externalLinksNewTab}
        logoAssetId={theme.branding.logoAssetId}
      />
      <SectionTabs />
      <EditModeProvider siteId={site.id} initialEditing={initialEditing}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1">
          <Sidebar
            sidebarStyle={theme.sidebarStyle}
            showPoweredByBadge={theme.showPoweredByBadge}
            canManageContent={canManageContent}
            managedVariantIds={managedVariantIds}
            orgSlug={orgSlugForSidebar}
            nonce={nonce}
            belowSectionTabs={sections.length > 1}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav listStyle={theme.sidebarStyle.listStyle} />
            <div className="flex flex-1">{children}</div>
          </div>
        </div>
        {canManageContent ? <EditModeToggle orgSlug={orgSlugForSidebar} siteId={site.id} siteName={site.name} /> : null}
      </EditModeProvider>
      <Footer siteName={site.name} footer={theme.footer} socials={theme.socials} privacyPolicyHref={theme.privacyPolicyHref} />
      {theme.darkMode.enabled ? <DarkModeToggle initialChoice={preferredMode} /> : null}
    </SiteNavProvider>,
  );
}

// -------------------------------------------------------------------------------------------------
// Page
// -------------------------------------------------------------------------------------------------

export async function renderPublishedPage(site: ResolvedSite, path: string[], baseHref: string) {
  // The layout checked this too, but it does not run again on a client-side navigation, so a page
  // must never rely on it: access can change (a password rotated, a link revoked) while a reader is
  // still on the site.
  const access = await getVisitorAccess(site);
  if (access.status === "denied") return <PrivateSiteMessage siteName={site.name} />;
  if (access.status === "passwordRequired") return <PasswordGate siteId={site.id} siteName={site.name} />;

  const userId = await getViewerId();
  const meta = await readRequestMeta();
  const resolved = await resolvePublishedPath(site, path);
  if (!resolved) {
    const redirectRule = await prisma.siteRedirect.findUnique({ where: { siteId_fromPath: { siteId: site.id, fromPath: path.join("/") } } });
    if (redirectRule) permanentRedirect(`${baseHref}/${redirectRule.toPath}`);

    trackEvent({ siteId: site.id, type: "NOT_FOUND", path: path.join("/"), ...meta });
    notFound();
  }

  const { section, space, variant, page, pathPrefix } = resolved;
  trackEvent({ siteId: site.id, type: "PAGEVIEW", pageId: page.id, path: path.join("/"), ...meta });
  const tree = await getPageTree(variant.id);
  // The URL a link must carry to stay in this section/space/variant — the same
  // shape computePagePath builds (default variant omitted, `~v/<slug>` otherwise).
  const canonicalPrefix = [...pathPrefix, ...variantSegments(variant)];
  const pathMap = prefixPaths(pathsForTree(tree), canonicalPrefix);

  const flat = flattenNavigablePages(tree);
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
  // Gated by both a real permission check (never trust theme config for
  // access control) and the site owner's own toggle for whether they want
  // this affordance visible to members at all.
  const canEdit =
    theme.showToolbarForMembers && userId !== null && !page.isGroup && page.managedBy !== "GIT" && (await canUserDoX(userId, "content.edit", { type: "page", id: page.id }));

  // A page that comes from a repository links to its file. A repository that needs a token is private, and its
  // name is not for the public to read, so only signed-in editors are shown the link for those.
  let editOnGit: string | null = null;
  if (page.sourceId && page.sourcePath && !/^(dir|group):/.test(page.sourcePath)) {
    const source = await prisma.gitSource.findUnique({ where: { id: page.sourceId }, select: { owner: true, repo: true, branch: true, rootDir: true, credentialId: true } });
    const isEditor = userId !== null && (await canUserDoX(userId, "content.edit", { type: "page", id: page.id }));
    if (source && (source.credentialId === null || isEditor)) editOnGit = editUrl(hostConfigFromEnv().webBase, source, page.sourcePath);
  }

  return (
    <>
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10">
        {/* max-w-3xl (768px) is the measured content width on a real
            GitBook site; the old max-w-2xl ran ~100px narrower than the
            reference and made the type feel cramped. */}
        <div className="mx-auto w-full max-w-3xl">
          <header className="mb-6 space-y-3 after:clear-both after:block">
            {showPageActions ? (
              <div className="float-right -mt-1 ml-4">
                <PageActions pageId={page.id} allowCopy={theme.pageActions.copyAsMarkdown} allowView={theme.pageActions.viewAsMarkdown} />
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
            <h1 className="flex items-center gap-3 text-3xl font-bold leading-tight tracking-tight text-site-ink sm:text-4xl" style={{ fontFamily: "var(--site-font-heading)" }}>
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
            initialContent={canEdit ? page.content : null}
            initialVersion={page.contentVersion}
          >
            <BlockNoteRenderer content={page.content} codeTheme={{ light: theme.codeTheme.light, dark: theme.codeTheme.dark }} />
          </EditableArea>

          <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-site-border pt-4 text-sm text-site-ink-muted">
            <p className="mr-auto">
              Last updated <time dateTime={page.updatedAt.toISOString()}>{formatRelativeTime(page.updatedAt)}</time>
            </p>
            {editOnGit ? (
              <a href={editOnGit} target="_blank" rel="noreferrer" className="transition hover:text-site-ink">
                Edit on GitHub <span aria-hidden>↗</span>
              </a>
            ) : null}
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
    </>
  );
}

// -------------------------------------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------------------------------------

export async function publishedSiteMetadata(site: ResolvedSite | null, path: string[]): Promise<Metadata> {
  if (!site) return {};

  // Metadata is part of the response a visitor receives, so it follows the same
  // access rules as the page body: a visitor who would be shown the gate or the
  // "private" screen must not learn page titles, descriptions or the favicon from
  // the <head>. And nothing on a non-public site belongs in a search index.
  const access = await getVisitorAccess(site);
  const noIndex = { index: false, follow: false } as const;
  if (access.status !== "allow") return { title: site.name, robots: noIndex };

  const resolved = await resolvePublishedPath(site, path);
  if (!resolved) return {};
  const theme = resolveTheme(site.theme);
  return {
    title: `${resolved.page.title} — ${site.name}`,
    description: resolved.page.description ?? undefined,
    robots: site.audienceMode === "PUBLIC" ? undefined : noIndex,
    alternates: {
      types: { "application/rss+xml": `/api/sites/${site.id}/updates.rss` },
    },
    icons: theme.branding.faviconAssetId ? { icon: `/api/files/${theme.branding.faviconAssetId}` } : undefined,
  };
}
