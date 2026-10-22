"use client";

import { useState } from "react";

/**
 * The "Copy ▾" control GitBook puts at the top-right of every page. The markdown is fetched when
 * it is asked for (see /api/pages/[pageId]/markdown) rather than embedded in every page's HTML,
 * where nearly every reader would download it and never use it.
 */
export function PageActions({ pageId, allowCopy, allowView }: { pageId: string; allowCopy: boolean; allowView: boolean }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "copied" | "failed">("idle");

  if (!allowCopy && !allowView) return null;

  async function fetchMarkdown(): Promise<string> {
    const res = await fetch(`/api/pages/${pageId}/markdown${window.location.search.includes("token=") ? window.location.search : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    setMarkdown(text);
    return text;
  }

  async function copy() {
    setOpen(false);
    setStatus("loading");
    try {
      // Safari only allows a clipboard write inside the click that asked for it, and the fetch below
      // outlives that click. Handing the clipboard a promise keeps the write attached to the gesture.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const blob = fetchMarkdown().then((text) => new Blob([text], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        await navigator.clipboard.writeText(markdown ?? (await fetchMarkdown()));
      }
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1600);
    } catch {
      // Clipboard is permission-gated in some contexts — fall back to showing the markdown so
      // there's still a way to get it out (or an honest failure if it couldn't be fetched at all).
      try {
        if (markdown === null) await fetchMarkdown();
        setViewing(true);
        setStatus("idle");
      } catch {
        setStatus("failed");
        setTimeout(() => setStatus("idle"), 2400);
      }
    }
  }

  async function view() {
    setOpen(false);
    setViewing(true);
    if (markdown === null) {
      try {
        await fetchMarkdown();
      } catch {
        setViewing(false);
        setStatus("failed");
        setTimeout(() => setStatus("idle"), 2400);
      }
    }
  }

  return (
    <>
      <div className="relative flex shrink-0 items-stretch rounded-lg border border-site-border text-xs">
        {allowCopy ? (
          <button type="button" onClick={copy} className="flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink">
            <CopyIcon />
            {status === "copied" ? "Copied" : status === "loading" ? "Copying…" : status === "failed" ? "Couldn’t copy" : "Copy"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Page actions"
          aria-expanded={open}
          className={`flex items-center px-1.5 text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink ${allowCopy ? "border-l border-site-border rounded-r-lg" : "rounded-lg"}`}
        >
          <ChevronDownIcon />
        </button>

        {open ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-site-border bg-site-canvas py-1 shadow-2xl">
              {allowCopy ? (
                <button type="button" onClick={copy} className="block w-full px-3 py-2 text-left text-site-ink transition hover:bg-site-surface">
                  Copy as Markdown
                </button>
              ) : null}
              {allowView ? (
                <button type="button" onClick={view} className="block w-full px-3 py-2 text-left text-site-ink transition hover:bg-site-surface">
                  View as Markdown
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {viewing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setViewing(false)}>
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-site-border bg-site-canvas shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-site-border px-4 py-2.5">
              <p className="text-sm font-medium text-site-ink">Markdown</p>
              <button type="button" onClick={() => setViewing(false)} className="rounded px-2 py-1 text-xs text-site-ink-muted transition hover:text-site-ink">
                Close
              </button>
            </div>
            <pre className="overflow-auto px-4 py-3 text-xs leading-6 text-site-ink" style={{ fontFamily: "var(--site-font-mono)" }}>
              {markdown ?? "Loading…"}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
