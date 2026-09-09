"use client";

import { useRouter } from "next/navigation";
import { useEditMode } from "./EditModeContext";

/**
 * The single edit-mode switch — floating, not embedded in the sidebar or the
 * content area, since it's a full-page state (page tree + current page's
 * content together, see EditModeContext) rather than something scoped to
 * either one. Stacked above DarkModeToggle rather than sharing its row.
 */
export function EditModeToggle() {
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
    <button
      type="button"
      onClick={toggle}
      aria-pressed={editing}
      className={`fixed bottom-16 right-4 z-40 flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium shadow-lg transition ${
        editing ? "border-site-primary bg-site-primary text-white" : "border-site-border bg-site-canvas text-site-ink-muted hover:text-site-ink"
      }`}
    >
      <EditIcon />
      {editing ? "Done editing" : "Edit"}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
