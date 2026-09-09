"use client";

import { useState, useTransition } from "react";
import { PAGE_ICONS } from "@/lib/editor/pageIcons";
import { updatePageIcon } from "./actions";

export function PageIconPicker({ orgSlug, siteId, pageId, initialIcon }: { orgSlug: string; siteId: string; pageId: string; initialIcon: string | null }) {
  const [icon, setIcon] = useState(initialIcon);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const filtered = q ? PAGE_ICONS.filter((e) => e.name.includes(q) || e.keywords.some((k) => k.includes(q))) : PAGE_ICONS;

  function choose(emoji: string | null) {
    setIcon(emoji);
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      await updatePageIcon(orgSlug, siteId, pageId, emoji);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={icon ? "Change page icon" : "Add a page icon"}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-sm text-ink-muted transition hover:bg-surface hover:text-ink"
      >
        {icon ?? <PlaceholderIcon />}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-border bg-canvas p-2 shadow-2xl">
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the picker should focus search immediately */}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search icons..."
              className="mb-2 w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand"
            />
            <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
              {filtered.map((entry) => (
                <button
                  key={entry.emoji}
                  type="button"
                  title={entry.name}
                  onClick={() => choose(entry.emoji)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-lg transition hover:bg-surface"
                >
                  {entry.emoji}
                </button>
              ))}
              {filtered.length === 0 ? <p className="col-span-8 py-3 text-center text-xs text-ink-muted">No matching icons</p> : null}
            </div>
            {icon ? (
              <button type="button" onClick={() => choose(null)} className="mt-2 w-full rounded-lg py-1.5 text-center text-xs text-ink-muted hover:text-danger">
                Remove icon
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.7-1.2c0 1.7-2.2 1.9-2.2 3.7M12 16.5h.01" />
    </svg>
  );
}
