"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ancestorIds, type ThemeConfig } from "@gitcrook/shared";
import type { ShellNode } from "@/lib/tenancy/siteLocation";
import { GitCrookMark } from "@/app/_components/GitCrookMark";
import { useEditMode } from "./EditModeContext";
import { useSiteNav } from "./SiteNavProvider";
import { SidebarList } from "./SidebarList";
import { SidebarScrollArea } from "./SidebarScrollArea";

// Editing a site's structure (drag and drop, rename, icons) is for members only, so its code — and the
// icon picker's table of every icon — is fetched only when edit mode is actually switched on.
const SidebarTree = dynamic(() => import("./SidebarTree").then((m) => m.SidebarTree));
const AddNewButton = dynamic(() => import("./AddNewButton").then((m) => m.AddNewButton));

type ListStyle = ThemeConfig["sidebarStyle"]["listStyle"];

/**
 * The page tree of one variant. It is keyed by variant at the call sites, so switching variant starts a
 * fresh tree; within a variant it persists, which is what keeps groups the reader opened open.
 *
 * Which groups start open is decided once, from the page that is active when the tree first renders.
 * After that the browser owns each group's open state (see SidebarList). Navigation only ever adds to
 * it: opening the groups above a newly active page, never closing the ones the reader left open.
 */
function VariantTree({
  tree,
  paths,
  baseHref,
  activeId,
  listStyle,
  edit,
}: {
  tree: ShellNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activeId: string | null;
  listStyle: ListStyle;
  edit: { orgSlug: string; siteId: string } | null;
}) {
  const [initialOpen] = useState<ReadonlySet<string>>(() => new Set(activeId ? ancestorIds(tree, activeId) : []));
  const { editing } = useEditMode();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId || !root.current) return;
    for (const id of ancestorIds(tree, activeId)) {
      const group = root.current.querySelector<HTMLDetailsElement>(`details[data-node-id="${CSS.escape(id)}"]`);
      if (group) group.open = true;
    }
  }, [activeId, tree]);

  return (
    <div ref={root}>
      {edit && editing ? (
        <SidebarTree tree={tree} baseHref={baseHref} paths={paths} activePageId={activeId ?? ""} orgSlug={edit.orgSlug} siteId={edit.siteId} />
      ) : (
        <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activeId} initialOpen={initialOpen} depth={0} listStyle={listStyle} />
      )}
    </div>
  );
}

/**
 * The desktop sidebar is hidden below lg (288px of nav is too much of a small screen); MobileNav below
 * is the same tree as a disclosure above the content.
 */
export function MobileNav({ listStyle }: { listStyle: ListStyle }) {
  const nav = useSiteNav();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const lastPath = useRef(pathname);

  // The menu is part of the persistent shell, so it would otherwise stay open after choosing a page.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  if (!nav) return null;
  const { location, paths, baseHref } = nav;
  const activeId = location.activeNode?.id ?? null;

  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="mx-6 mt-6 rounded-xl border border-site-border lg:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-site-ink [&::-webkit-details-marker]:hidden">
        <MenuIcon />
        Menu
      </summary>
      <div className="max-h-[70vh] overflow-y-auto border-t border-site-border px-2 py-3">
        <VariantTree key={location.variant.id} tree={location.variant.tree} paths={paths} baseHref={baseHref} activeId={activeId} listStyle={listStyle} edit={null} />
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
  sidebarStyle,
  showPoweredByBadge,
  canManageContent,
  managedVariantIds = [],
  orgSlug,
  nonce,
  belowSectionTabs = false,
}: {
  sidebarStyle: ThemeConfig["sidebarStyle"];
  showPoweredByBadge: boolean;
  canManageContent: boolean;
  /** Versions a Git repository fills: their pages are changed there, so no editing controls are shown for them. */
  managedVariantIds?: string[];
  orgSlug: string | null;
  /** CSP nonce for the pre-hydration scroll-restore script. */
  nonce?: string;
  /** A multi-section site renders SectionTabs between the header and this, which sticks at top-16 too — so this has to start below both. */
  belowSectionTabs?: boolean;
}) {
  const nav = useSiteNav();
  if (!nav) return null;

  const { location, paths, baseHref, siteId } = nav;
  const activeId = location.activeNode?.id ?? null;
  const editable = canManageContent && orgSlug !== null && !managedVariantIds.includes(location.variant.id);
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
        <SidebarScrollArea
          storageKey={`gitcrook-sidebar:${siteId}:${location.variant.id}`}
          activeId={activeId}
          nonce={nonce}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-5"
        >
          <VariantTree
            key={location.variant.id}
            tree={location.variant.tree}
            paths={paths}
            baseHref={baseHref}
            activeId={activeId}
            listStyle={sidebarStyle.listStyle}
            edit={editable ? { orgSlug: orgSlug!, siteId } : null}
          />
          {editable ? (
            <div className="mt-3 border-t border-site-border pt-3">
              <AddNewButton orgSlug={orgSlug!} siteId={siteId} baseHref={baseHref} />
            </div>
          ) : null}
        </SidebarScrollArea>
        {showPoweredByBadge ? (
          <div className="shrink-0 p-3">
            <a
              href="https://github.com/Offxc/GitCrook"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-site-border bg-site-canvas px-3 py-2 text-xs font-medium text-site-ink-muted transition hover:text-site-ink"
            >
              <GitCrookMark className="h-4 w-4 shrink-0" />
              Powered by GitCrook
            </a>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
