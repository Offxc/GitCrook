"use client";

import { useEffect, useState } from "react";
import type { HeadingEntry } from "@/lib/renderer/extractHeadings";

/**
 * Right-hand outline with scroll-spy, matching GitBook: the heading you're
 * currently reading is marked with the same 2px accent bar + primary colour
 * the sidebar uses for the active page, so the two columns read as one
 * navigation system.
 *
 * Spy is a passive scroll listener coalesced into a rAF rather than an
 * IntersectionObserver — "the last heading whose top has passed the reading
 * line" is one comparison over a handful of elements, and it stays correct
 * when several headings share a viewport or none intersect at all (long
 * sections, or scrolled past the final one), which is exactly where the
 * observer-based version needs extra bookkeeping to not go blank.
 */
export function TableOfContents({ headings }: { headings: HeadingEntry[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    let frame = 0;

    function measure() {
      frame = 0;
      // The line just under the sticky header where a heading counts as "current".
      const readingLine = 120;
      let current: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= readingLine) current = h.id;
        else break;
      }
      // Before the first heading reaches the line, highlight it anyway rather
      // than showing nothing at the top of the page.
      setActiveId(current ?? headings[0]?.id ?? null);
    }

    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 flex items-center gap-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-site-ink-muted">
        <ListIcon />
        On this page
      </p>
      <ul>
        {headings.map((h) => {
          const isActive = h.id === activeId;
          return (
            <li key={h.id} style={{ paddingLeft: `${(h.level - 1) * 0.625}rem` }}>
              <a
                href={`#${h.id}`}
                aria-current={isActive ? "location" : undefined}
                className={`block truncate rounded-r-2xl py-1 px-3 transition ${
                  isActive ? "border-l-2 border-site-primary font-semibold text-site-primary" : "text-site-ink-muted hover:text-site-ink"
                }`}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
    </svg>
  );
}
