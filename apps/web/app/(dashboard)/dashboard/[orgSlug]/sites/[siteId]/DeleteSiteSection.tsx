"use client";

import { useState, useTransition } from "react";
import { deleteSite } from "../actions";

export function DeleteSiteSection({ orgSlug, siteId, siteSlug }: { orgSlug: string; siteId: string; siteSlug: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSite(orgSlug, siteId, confirmText);
      if (result.ok && result.redirectTo) {
        window.location.href = result.redirectTo;
      } else {
        setError(result.error ?? "Failed to delete site.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-danger/40 bg-canvas p-5">
      <h2 className="mb-1 text-sm font-semibold text-danger">Danger zone</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Permanently deletes this site — every page, page history, comment, custom domain, share link, and analytics event with it. This cannot be undone.
      </p>
      <label className="mb-2 block text-sm">
        <span className="mb-1 block text-ink-muted">
          Type <span className="font-mono font-medium text-ink">{siteSlug}</span> to confirm
        </span>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-danger"
        />
      </label>
      <button
        type="button"
        disabled={pending || confirmText !== siteSlug}
        onClick={handleDelete}
        className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Deleting..." : "Delete this site"}
      </button>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
