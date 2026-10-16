"use client";

import { useCallback, useRef } from "react";

/**
 * The sidebar is rendered by the page, not a layout, so every navigation
 * remounts it and its scroll position resets to the top — on a site with a
 * long page tree that means losing your place in the nav every time you
 * click a page. Until the shell moves into a persistent layout, remember the
 * scroll offset per site and put it back when the column mounts again.
 *
 * Restoring happens in the ref callback rather than an effect: that runs
 * during commit, before paint, so the column never visibly jumps from the
 * top down to the saved offset. The children are server-rendered and already
 * in the DOM by then, so the content has its real height to scroll within.
 */
export function SidebarScrollArea({ storageKey, className, children }: { storageKey: string; className?: string; children: React.ReactNode }) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restore = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      try {
        const saved = Number(sessionStorage.getItem(storageKey));
        if (Number.isFinite(saved) && saved > 0) node.scrollTop = saved;
      } catch {
        // Private-browsing contexts can throw on access — the scroll just
        // won't persist there, which is a degradation rather than a break.
      }
    },
    [storageKey],
  );

  // Debounced: scroll fires far too often to write to sessionStorage on
  // every event, and only the position they settle on matters.
  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const { scrollTop } = event.currentTarget;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, String(scrollTop));
      } catch {
        // best-effort only
      }
    }, 100);
  }

  return (
    <div ref={restore} onScroll={onScroll} className={className}>
      {children}
    </div>
  );
}
