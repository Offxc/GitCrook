import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import type { ThemeConfig } from "@voiddocs/shared";
import { GitCrookMark } from "./GitCrookMark";
import { AddNewButton } from "./AddNewButton";
import { SidebarList } from "./SidebarList";
import { SidebarBody } from "./SidebarBody";

export function Sidebar({
  tree,
  paths,
  baseHref,
  activePageId,
  siteName,
  sidebarStyle,
  showPoweredByBadge,
  canManageContent,
  orgSlug,
  siteId,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  siteName: string;
  sidebarStyle: ThemeConfig["sidebarStyle"];
  showPoweredByBadge: boolean;
  canManageContent: boolean;
  orgSlug: string | null;
  siteId: string;
}) {
  const editable = canManageContent && orgSlug !== null;

  return (
    <nav
      data-placement="sidebar"
      // sticky + a viewport-relative height (not just flex-stretching to match
      // the main column) — otherwise on any page taller than the viewport,
      // this whole column stretches to match it, and the "Powered by" badge
      // at the bottom ends up wherever the *content* column happens to end,
      // not pinned to the visible bottom of the screen the way it needs to be.
      className={`sticky top-14 flex h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col border-r border-site-border ${sidebarStyle.background === "filled" ? "bg-site-surface" : ""}`}
      aria-label="Table of contents"
    >
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <p className="mb-4 truncate px-2 text-sm font-semibold text-site-ink">{siteName}</p>
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
        <div className="shrink-0 border-t border-site-border p-3">
          <span className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-site-ink-muted">
            <GitCrookMark className="h-4 w-4" />
            Powered by VoidDocs
          </span>
        </div>
      ) : null}
    </nav>
  );
}
