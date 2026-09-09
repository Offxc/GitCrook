"use client";

import { findPageIcon } from "@/lib/editor/pageIcons";

/**
 * Renders whatever's stored in Page.icon — a slug into the flat Phosphor set
 * (see lib/editor/pageIcons.ts) for anything picked since that system
 * shipped. A value that isn't a known slug is rendered as literal text
 * instead of dropped, so a page/group icon picked back when this stored a
 * raw emoji character still shows something rather than silently vanishing.
 *
 * Must be a Client Component: Phosphor's icon components call useContext
 * internally, which breaks when rendered directly from a Server Component
 * (SidebarList/renderPublishedSite render this from server code, so this
 * file is the boundary that makes that safe).
 */
export function PageIcon({ icon, className }: { icon: string | null; className?: string }) {
  if (!icon) return null;
  const entry = findPageIcon(icon);
  if (entry) {
    const { Icon } = entry;
    return <Icon className={className} weight="regular" aria-hidden />;
  }
  return (
    <span aria-hidden className={className}>
      {icon}
    </span>
  );
}
