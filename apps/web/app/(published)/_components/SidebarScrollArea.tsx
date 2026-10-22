"use client";

import { useCallback, useEffect, useRef } from "react";
import { RESTORE_SIDEBAR_SOURCE, restoreSidebar, revealActive, sidebarOpenKey, sidebarScrollKey } from "./sidebarRestore";

/** Scroll and toggle events caused by our own restore land in this window and must not be saved as if the reader did them. */
const QUIET_MS = 300;

/**
 * The sidebar's scroll container. It lives in the site's layout and so is not rebuilt when the reader
 * navigates: the scroll offset and the open groups simply stay as they are. What is left for this
 * component to do:
 *
 * - On a hard load or reload, put back the offset and open groups the reader left (per site and
 *   variant, in sessionStorage). The page is server-rendered with the sidebar at the top, and React
 *   can't restore anything until it hydrates, so an inline script runs as the HTML is parsed and the
 *   sidebar is already in place when it is first painted. The same restore runs from the ref callback
 *   (before paint) when the variant changes, since that swaps the tree inside this same container.
 * - When navigation lands on a page that is out of view (a link in the page body, search, a deep link),
 *   scroll it into view. A click on a link that is already visible leaves the offset alone.
 * - Remember the offset and open groups. The offset is saved when a link is clicked, not only on a
 *   debounce: a click a few milliseconds after a scroll used to navigate before it was written. A
 *   restore never overwrites what was stored; the scroll event it causes is ignored.
 */
export function SidebarScrollArea({
  storageKey,
  activeId,
  nonce,
  className,
  children,
}: {
  storageKey: string;
  /** The page being read; when it changes, make sure it is visible. */
  activeId: string | null;
  nonce?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietUntil = useRef(0);

  const saveScroll = useCallback(() => {
    const node = nodeRef.current;
    // Hidden below the lg breakpoint: a 0 height means nothing real to record.
    if (!node || node.clientHeight === 0) return;
    try {
      sessionStorage.setItem(sidebarScrollKey(storageKey), String(Math.round(node.scrollTop)));
    } catch {
      // best-effort only
    }
  }, [storageKey]);

  const saveOpenGroups = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    const open = Array.from(node.querySelectorAll<HTMLDetailsElement>("details[data-node-id][open]")).map((d) => d.dataset.nodeId);
    try {
      sessionStorage.setItem(sidebarOpenKey(storageKey), JSON.stringify(open));
    } catch {
      // best-effort only
    }
  }, [storageKey]);

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      nodeRef.current = node;
      quietUntil.current = performance.now() + QUIET_MS;
      restoreSidebar(node, storageKey);

      // `toggle` doesn't bubble, but a capture listener on the ancestor still sees it.
      const onToggle = () => {
        if (performance.now() >= quietUntil.current) saveOpenGroups();
      };
      node.addEventListener("toggle", onToggle, true);
      return () => {
        node.removeEventListener("toggle", onToggle, true);
        if (nodeRef.current === node) nodeRef.current = null;
      };
    },
    [storageKey, saveOpenGroups],
  );

  // Navigation moved the active item: bring it into view if it isn't. Not on first mount, where the
  // restore above already did it.
  const lastActive = useRef(activeId);
  useEffect(() => {
    if (lastActive.current === activeId) return;
    lastActive.current = activeId;
    const node = nodeRef.current;
    if (!node || !activeId) return;
    quietUntil.current = performance.now() + QUIET_MS;
    revealActive(node);
  }, [activeId]);

  useEffect(() => {
    window.addEventListener("pagehide", saveScroll);
    return () => {
      window.removeEventListener("pagehide", saveScroll);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [saveScroll]);

  function onScroll() {
    if (performance.now() < quietUntil.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveScroll, 100);
  }

  return (
    <>
      <div ref={attach} onScroll={onScroll} onClickCapture={saveScroll} className={className}>
        {children}
      </div>
      <InlineScript
        nonce={nonce}
        html={`(${RESTORE_SIDEBAR_SOURCE})(document.currentScript.previousElementSibling,${JSON.stringify(storageKey)})`}
      />
    </>
  );
}

/**
 * An inline script that runs during HTML parsing (before first paint) and is inert
 * when React renders it on the client — scripts React inserts after hydration
 * don't execute anyway, and the `text/plain` type keeps React from warning about
 * them in development.
 */
function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return (
    <script
      nonce={nonce}
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
