"use client";

import { useEditMode } from "./EditModeContext";

/** Sitewide, not per-page — this is what makes "Edit" cover the page tree (drag to reorder/regroup) as well as the current page's content, both driven by the same flag. See EditModeContext. */
export function EditModeToggle() {
  const { editing, setEditing } = useEditMode();

  return (
    <button
      type="button"
      onClick={() => setEditing(!editing)}
      aria-pressed={editing}
      className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition ${
        editing ? "bg-site-primary text-white" : "text-site-ink-muted hover:bg-site-surface hover:text-site-ink"
      }`}
    >
      <EditIcon />
      {editing ? "Done" : "Edit"}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
