"use client";

import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import type { ThemeConfig } from "@voiddocs/shared";
import { useEditMode } from "./EditModeContext";
import { SidebarList } from "./SidebarList";
import { SidebarTree } from "./SidebarTree";

/** Only mounted for members who can manage content (see Sidebar.tsx) — everyone else gets the plain server-rendered SidebarList with no client JS at all. */
export function SidebarBody({
  tree,
  paths,
  baseHref,
  activePageId,
  listStyle,
  orgSlug,
  siteId,
}: {
  tree: PageTreeNode[];
  paths: Map<string, string[]>;
  baseHref: string;
  activePageId: string;
  listStyle: ThemeConfig["sidebarStyle"]["listStyle"];
  orgSlug: string;
  siteId: string;
}) {
  const { editing } = useEditMode();

  if (editing) {
    return <SidebarTree tree={tree} baseHref={baseHref} paths={paths} activePageId={activePageId} orgSlug={orgSlug} siteId={siteId} />;
  }

  return <SidebarList tree={tree} paths={paths} baseHref={baseHref} activePageId={activePageId} depth={0} listStyle={listStyle} />;
}
