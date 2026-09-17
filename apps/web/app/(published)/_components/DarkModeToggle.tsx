"use client";

import { useEffect, useState } from "react";

type Choice = "light" | "system" | "dark";

function getSiteRoot(): Element | null {
  return document.querySelector("[data-site-root]");
}

/**
 * A 3-way light/system/dark control, not a single light<->dark toggle —
 * "system" isn't just a starting default, it's a real choice a visitor can
 * return to (clears the stored override and the data-site-mode attribute
 * entirely, handing control back to the [data-site-mode] media-query rules
 * in globals.css). Fixed to the corner rather than living in the header, so
 * it's reachable without scrolling back to the top.
 */
export function DarkModeToggle() {
  // null until mount — the server can't know the visitor's stored choice.
  const [choice, setChoice] = useState<Choice | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("gitcrook-site-mode");
    } catch {
      // best-effort only — some private-browsing contexts throw on access
    }
    setChoice(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  function choose(next: Choice) {
    setChoice(next);
    if (next === "system") {
      getSiteRoot()?.removeAttribute("data-site-mode");
      try {
        localStorage.removeItem("gitcrook-site-mode");
      } catch {
        // best-effort only
      }
    } else {
      getSiteRoot()?.setAttribute("data-site-mode", next);
      try {
        localStorage.setItem("gitcrook-site-mode", next);
      } catch {
        // best-effort only
      }
    }
  }

  if (!choice) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-0.5 rounded-full border border-site-border bg-site-canvas p-1 shadow-lg">
      {(
        [
          ["light", "Light", <SunIcon key="i" />],
          ["system", "Match system", <SystemIcon key="i" />],
          ["dark", "Dark", <MoonIcon key="i" />],
        ] as const
      ).map(([value, label, icon]) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-label={label}
          aria-pressed={choice === value}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
            choice === value ? "bg-site-surface text-site-ink" : "text-site-ink-muted hover:text-site-ink"
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        d="M8 1v1.4M8 13.6V15M15 8h-1.4M2.4 8H1M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M14 9.3A6 6 0 1 1 6.7 2a4.7 4.7 0 0 0 7.3 7.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 14h5M8 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
