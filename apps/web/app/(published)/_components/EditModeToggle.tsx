"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditMode } from "./EditModeContext";

/**
 * The site owner's floating toolbar: the single edit-mode switch, plus a way
 * into site settings without going and finding the dashboard first. Edit
 * mode is full-page state (page tree + current page's content together, see
 * EditModeContext), so its switch isn't embedded in either surface.
 * Stacked above DarkModeToggle rather than sharing its row.
 */
export function EditModeToggle({ settingsHref }: { settingsHref?: string }) {
  const { editing, setEditing } = useEditMode();
  const router = useRouter();

  function toggle() {
    const next = !editing;
    setEditing(next);
    // Turning editing off: reconcile the read-only view with whatever was
    // just saved — nothing else refetches it, since this is local state.
    if (!next) router.refresh();
  }

  return (
    <div className="fixed bottom-16 right-4 z-40 flex items-center gap-2">
      {settingsHref ? (
        <Link
          href={settingsHref}
          title="Site settings"
          aria-label="Site settings"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-site-border bg-site-canvas text-site-ink-muted shadow-lg transition hover:text-site-ink"
        >
          <GearIcon />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={editing}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium shadow-lg transition ${
          editing ? "border-site-primary bg-site-primary text-white" : "border-site-border bg-site-canvas text-site-ink-muted hover:text-site-ink"
        }`}
      >
        <EditIcon />
        {editing ? "Done editing" : "Edit"}
      </button>
    </div>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.63.71 1.09 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
