"use client";

import { useState, useTransition } from "react";
import { disconnectRepository, pauseSource, syncNow, type GitActionState } from "./actions";

const button = "rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm text-ink transition hover:bg-surface disabled:opacity-60";

export function SourceActions({ orgSlug, siteId, sourceId, paused }: { orgSlug: string; siteId: string; sourceId: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<GitActionState>({});
  const [confirming, setConfirming] = useState(false);
  const [keepPages, setKeepPages] = useState(true);

  const run = (action: () => Promise<GitActionState>) =>
    start(async () => {
      setResult(await action());
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={pending} onClick={() => run(() => syncNow(orgSlug, siteId, sourceId, false))}>
          Sync now
        </button>
        <button type="button" className={button} disabled={pending} title="Read every file again, not only what changed" onClick={() => run(() => syncNow(orgSlug, siteId, sourceId, true))}>
          Full re-sync
        </button>
        <button type="button" className={button} disabled={pending} onClick={() => run(() => pauseSource(orgSlug, siteId, sourceId, !paused))}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className={`${button} text-danger`} disabled={pending} onClick={() => setConfirming((c) => !c)}>
          Disconnect…
        </button>
      </div>

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-medium text-ink">What should happen to the pages?</p>
          <label className="flex items-start gap-2">
            <input type="radio" name={`keep-${sourceId}`} checked={keepPages} onChange={() => setKeepPages(true)} className="mt-1" />
            <span>
              <span className="text-ink">Keep them</span>
              <span className="block text-xs text-ink-muted">They stay on the site as ordinary pages you can edit here. Nothing more is synced.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name={`keep-${sourceId}`} checked={!keepPages} onChange={() => setKeepPages(false)} className="mt-1" />
            <span>
              <span className="text-ink">Delete them</span>
              <span className="block text-xs text-ink-muted">The pages from this repository are removed from the site. This cannot be undone.</span>
            </span>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={pending} className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60" onClick={() => run(() => disconnectRepository(orgSlug, siteId, sourceId, keepPages))}>
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
            <button type="button" className={button} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {result.error ? <p className="text-sm text-danger">{result.error}</p> : null}
      {result.message ? <p className="text-sm text-success">{result.message}</p> : null}
    </div>
  );
}
