"use client";

import { useState, useTransition } from "react";
import { deletePage } from "./actions";

export function DeletePageButton({ orgSlug, siteId, pageId, childCount }: { orgSlug: string; siteId: string; pageId: string; childCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePage(orgSlug, siteId, pageId);
      if (result.ok && result.redirectTo) {
        // Same reasoning as sites/actions.ts's createSite — a real navigation
        // rather than next/navigation's redirect() straight after a Server Action.
        window.location.href = result.redirectTo;
      } else {
        setError(result.error ?? "Failed to delete page.");
        setConfirming(false);
      }
    });
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-sm text-ink-muted hover:text-danger">
        Delete
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-danger">{childCount > 0 ? `Delete this and ${childCount} sub-page${childCount === 1 ? "" : "s"}?` : "Delete this page?"}</span>
      <button type="button" disabled={pending} onClick={handleDelete} className="font-medium text-danger hover:underline disabled:opacity-60">
        {pending ? "Deleting..." : "Confirm"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-ink-muted hover:text-ink">
        Cancel
      </button>
      {error ? <span className="text-danger">{error}</span> : null}
    </div>
  );
}
