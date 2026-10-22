"use client";

import { useEffect } from "react";

/**
 * Tracks outbound (different-origin, or explicit target=_blank) link clicks
 * for the "Links" analytics section — internal same-site navigation is
 * already captured by the pageview on the page it lands on, so counting it
 * again here would double up with a different, less useful shape of data.
 * One delegated listener on the whole site root rather than per-link
 * handlers, so it costs nothing as pages/blocks are added.
 */
export function ClickTracker({ siteId }: { siteId: string }) {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;

      let isExternal = anchor.getAttribute("target") === "_blank";
      try {
        isExternal = isExternal || new URL(href, window.location.href).origin !== window.location.origin;
      } catch {
        return;
      }
      if (!isExternal) return;

      const placement = (anchor.closest("[data-placement]") as HTMLElement | null)?.dataset.placement ?? "body";
      const payload = JSON.stringify({ path: window.location.pathname, linkTarget: href, linkPlacement: placement });
      navigator.sendBeacon?.(`/api/sites/${siteId}/track-click`, new Blob([payload], { type: "application/json" }));
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [siteId]);

  return null;
}
