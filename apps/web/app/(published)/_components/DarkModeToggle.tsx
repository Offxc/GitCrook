"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark";

function getSiteRoot(): Element | null {
  return document.querySelector("[data-site-root]");
}

/**
 * Manual override on top of the system-preference default (see the
 * [data-site-mode] rules in globals.css). Reads/writes localStorage directly
 * rather than through a capability — this is a per-visitor UI convenience,
 * not state anyone else needs to see.
 */
export function DarkModeToggle() {
  // null until mount (avoids a hydration mismatch: the server can't know the
  // visitor's system preference or stored override).
  const [effective, setEffective] = useState<Mode | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("voiddocs-site-mode");
    } catch {
      // best-effort only — some private-browsing contexts throw on access
    }
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved: Mode = stored === "light" || stored === "dark" ? stored : systemPrefersDark ? "dark" : "light";
    setEffective(resolved);
    if (stored === "light" || stored === "dark") {
      getSiteRoot()?.setAttribute("data-site-mode", stored);
    }
  }, []);

  function toggle() {
    const next: Mode = effective === "dark" ? "light" : "dark";
    setEffective(next);
    getSiteRoot()?.setAttribute("data-site-mode", next);
    try {
      localStorage.setItem("voiddocs-site-mode", next);
    } catch {
      // best-effort persistence only
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="flex h-8 w-8 items-center justify-center rounded-md text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink"
    >
      {effective === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M14 9.3A6 6 0 1 1 6.7 2a4.7 4.7 0 0 0 7.3 7.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
