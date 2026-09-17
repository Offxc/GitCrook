import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import type { ThemeConfig } from "@gitcrook/shared";
import { GitCrookMark } from "@/app/_components/GitCrookMark";
import { AddNewButton } from "./AddNewButton";
import { SidebarList } from "./SidebarList";
import { SidebarBody } from "./SidebarBody";

/**
 * The desktop sidebar is hidden below lg (288px of nav is too much of a
 * small screen), so this is the same tree as a native disclosure above the
 * content — without it, narrow viewports would have no navigation at all.
 * `<details>` rather than a JS sheet keeps it zero-client-JS like the rest
 * of the read-only nav.
 */
export function MobileNav({
  tree,
  paths,
  baseHref,
  activePageId,
  listStyle,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  listStyle: ThemeConfig["sidebarStyle"]["listStyle"];
}) {
  return (
    <details className="mb-6 rounded-xl border border-site-border lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-site-ink [&::-webkit-details-marker]:hidden">
        <MenuIcon />
        Menu
      </summary>
      <div className="border-t border-site-border px-2 py-3">
        <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={0} listStyle={listStyle} />
      </div>
    </details>
  );
}

function MenuIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function Sidebar({
  tree,
  paths,
  baseHref,
  activePageId,
  sidebarStyle,
  showPoweredByBadge,
  canManageContent,
  orgSlug,
  siteId,
  belowSectionTabs = false,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  sidebarStyle: ThemeConfig["sidebarStyle"];
  showPoweredByBadge: boolean;
  canManageContent: boolean;
  orgSlug: string | null;
  siteId: string;
  /** A multi-section site renders SectionTabs between the header and this, which sticks at top-16 too — so this has to start below both. */
  belowSectionTabs?: boolean;
}) {
  const editable = canManageContent && orgSlug !== null;
  // "filled" is GitBook's own sidebar-background option, and it's what makes
  // the column read as an inset card (the look in the reference screenshot)
  // rather than a plain column divided off by a rule.
  const filled = sidebarStyle.background === "filled";

  return (
    <nav
      data-placement="sidebar"
      // sticky + max-height rather than a fixed viewport height: fixed height
      // overflowed the screen by exactly the announcement banner's height at
      // scroll-top (the banner pushes this down before the sticky top-16
      // engages), which cut the "Powered by" badge off. Capping instead means
      // a long tree still fills the screen with the badge pinned at the
      // bottom, and a short one just ends where it ends.
      className={`sticky hidden w-72 shrink-0 flex-col lg:flex ${
        belowSectionTabs ? "top-[6.75rem] max-h-[calc(100vh-6.75rem)]" : "top-16 max-h-[calc(100vh-4rem)]"
      } ${filled ? "py-3 pl-3" : "border-r border-site-border"}`}
      aria-label="Table of contents"
    >
      <div className={`flex min-h-0 flex-1 flex-col ${filled ? "rounded-2xl border border-site-border bg-site-surface" : ""}`}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          {editable ? (
            <SidebarBody tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} listStyle={sidebarStyle.listStyle} orgSlug={orgSlug} siteId={siteId} />
          ) : (
            <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={0} listStyle={sidebarStyle.listStyle} />
          )}
          {editable ? (
            <div className="mt-3 border-t border-site-border pt-3">
              <AddNewButton orgSlug={orgSlug} siteId={siteId} baseHref={baseHref} />
            </div>
          ) : null}
        </div>
        {showPoweredByBadge ? (
          <div className="shrink-0 p-3">
            <span className="flex items-center gap-2 rounded-xl border border-site-border bg-site-canvas px-3 py-2 text-xs font-medium text-site-ink-muted">
              <GitCrookMark className="h-4 w-4 shrink-0" />
              Powered by GitCrook
            </span>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
