"use client";

import { useEffect, useState } from "react";
import { SITE_MODE_COOKIE, isSiteMode, siteModeAttribute, type SiteMode } from "./siteMode";

const LEGACY_STORAGE_KEY = "gitcrook-site-mode";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function getSiteRoot(): Element | null {
  return document.querySelector("[data-site-root]");
}

function applyMode(mode: SiteMode) {
  const attribute = siteModeAttribute(mode);
  const root = getSiteRoot();
  if (!root) return;
  if (attribute) root.setAttribute("data-site-mode", attribute);
  else root.removeAttribute("data-site-mode");
}

function writeCookie(mode: SiteMode) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SITE_MODE_COOKIE}=${mode}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

function hasModeCookie(): boolean {
  return document.cookie.split("; ").some((part) => part.startsWith(`${SITE_MODE_COOKIE}=`));
}

/**
 * A 3-way light/system/dark control, not a single light<->dark toggle —
 * "system" isn't just a starting default, it's a real choice a visitor can
 * return to (it is stored explicitly, so it also overrides a site whose theme
 * defaults to dark). `initialChoice` comes from the server, which already put
 * the matching attribute on the page, so the toggle and the page agree from the
 * first paint. Fixed to the corner rather than living in the header, so it's
 * reachable without scrolling back to the top.
 */
export function DarkModeToggle({ initialChoice }: { initialChoice: SiteMode }) {
  const [choice, setChoice] = useState<SiteMode>(initialChoice);

  // One-time migration for visitors who chose a mode before it moved from
  // localStorage to a cookie: honour their old choice instead of resetting it.
  useEffect(() => {
    if (hasModeCookie()) return;
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // best-effort only — some private-browsing contexts throw on access
    }
    if (isSiteMode(legacy)) {
      writeCookie(legacy);
      applyMode(legacy);
      setChoice(legacy);
    }
  }, []);

  function choose(next: SiteMode) {
    setChoice(next);
    applyMode(next);
    writeCookie(next);
  }

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
