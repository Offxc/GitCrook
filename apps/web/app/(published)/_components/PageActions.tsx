"use client";

import { useState } from "react";

/**
 * The "Copy ▾" control GitBook puts at the top-right of every page. The
 * markdown is serialised server-side and passed in (see toMarkdown.ts), so
 * copying is a clipboard write with no round trip, and "view" just reveals
 * the same string — no extra route to secure, and nothing here that a
 * visitor without access to the page could reach anyway.
 */
export function PageActions({ markdown, allowCopy, allowView }: { markdown: string; allowCopy: boolean; allowView: boolean }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!allowCopy && !allowView) return null;

  async function copy() {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is permission-gated in some contexts — fall back to showing
      // the markdown so there's still a way to get it out.
      setViewing(true);
    }
  }

  return (
    <>
      <div className="relative flex shrink-0 items-stretch rounded-lg border border-site-border text-xs">
        {allowCopy ? (
          <button type="button" onClick={copy} className="flex items-center gap-1.5 rounded-l-lg px-2.5 py-1.5 text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink">
            <CopyIcon />
            {copied ? "Copied" : "Copy"}
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
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setViewing(true);
                  }}
                  className="block w-full px-3 py-2 text-left text-site-ink transition hover:bg-site-surface"
                >
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
              {markdown}
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
