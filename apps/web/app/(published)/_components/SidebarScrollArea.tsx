"use client";

import { useCallback, useEffect, useRef } from "react";
import { RESTORE_SIDEBAR_SOURCE, restoreSidebar, sidebarOpenKey, sidebarScrollKey } from "./sidebarRestore";

/** Scroll and toggle events caused by our own restore land in this window and must not be saved as if the reader did them. */
const QUIET_MS = 300;

/**
 * The reader shell is rebuilt on every navigation (it is rendered by the page,
 * not a layout), so everything the sidebar holds in the DOM — its scroll offset
 * and which groups are open — is lost on each click. Until the shell moves into
 * a persistent layout (see PLAN.md, A2), remember both per site and variant and
 * put them back.
 *
 * - Restored from the ref callback, which runs during commit before paint, so
 *   the column never visibly jumps.
 * - Saved immediately when a link is clicked (not only on a debounce): a click
 *   a few milliseconds after a scroll used to navigate before the offset was
 *   written.
 * - A restore never overwrites what was stored. If the restored offset is
 *   clamped (the tree changed), the scroll event that causes is ignored.
 * - On a hard load the page is server-rendered with the sidebar at the top and
 *   React can't restore anything until it hydrates. The inline script below
 *   runs as the HTML is parsed, so the sidebar is already in place when it's
 *   first painted.
 */
export function SidebarScrollArea({
  storageKey,
  nonce,
  className,
  children,
}: {
  storageKey: string;
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
