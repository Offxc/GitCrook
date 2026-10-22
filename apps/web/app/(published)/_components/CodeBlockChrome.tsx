"use client";

import { useState } from "react";

/** Header bar (language label + copy button) around a Shiki-highlighted code block. */
export function CodeBlockChrome({ html, code, language }: { html: string | null; code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions) —
      // silently no-op rather than show an error for a non-critical affordance.
    }
  }

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-site-border">
      <div className="flex items-center justify-between bg-site-surface px-3.5 py-1.5">
        <span className="font-mono text-xs text-site-ink-muted">{language && language !== "text" ? language : "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-site-ink-muted transition hover:text-site-ink"
        >
          {copied ? (
            <>
              <CheckIcon />
              Copied
            </>
          ) : (
            <>
              <CopyIcon />
              Copy
            </>
          )}
        </button>
      </div>
      {html ? (
        <div className="[&_pre]:overflow-x-auto [&_pre]:p-4 [&_pre]:text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto p-4 text-sm text-site-ink" style={{ fontFamily: "var(--site-font-mono)" }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
