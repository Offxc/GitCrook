"use client";

import { useActionState } from "react";
import { updateRepository, type GitActionState } from "./actions";

const input = "w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand disabled:opacity-60";

export function SourceSettings({
  orgSlug,
  siteId,
  sourceId,
  branch,
  rootDir,
  pollIntervalSec,
  deleteGraceDays,
  hasToken,
  canSaveToken,
}: {
  orgSlug: string;
  siteId: string;
  sourceId: string;
  branch: string;
  rootDir: string;
  pollIntervalSec: number;
  deleteGraceDays: number;
  hasToken: boolean;
  canSaveToken: boolean;
}) {
  const [state, formAction, pending] = useActionState<GitActionState, FormData>(updateRepository.bind(null, orgSlug, siteId, sourceId), {});
  const error = (field: string) => (state.field === field && state.error ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null);

  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-ink-muted hover:text-ink">Settings</summary>
      <form action={formAction} className="space-y-4 border-t border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Branch</span>
            <input name="branch" defaultValue={branch} required autoComplete="off" spellCheck={false} className={input} />
            {error("branch")}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Docs folder</span>
            <input name="rootDir" defaultValue={rootDir} placeholder="the whole repository" autoComplete="off" spellCheck={false} className={input} />
            {error("rootDir")}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Check for changes every (seconds)</span>
            <input name="pollIntervalSec" type="number" min={60} max={86400} defaultValue={pollIntervalSec} className={input} />
            <span className="mt-1 block text-xs text-ink-muted">Pushes are picked up straight away when the webhook is set up; this is the fallback.</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-ink-muted">Keep removed pages for (days)</span>
            <input name="deleteGraceDays" type="number" min={1} max={90} defaultValue={deleteGraceDays} className={input} />
            <span className="mt-1 block text-xs text-ink-muted">A page whose file is deleted leaves the site at once and is erased after this long.</span>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">{hasToken ? "Replace the access token" : "Access token"}</span>
          <input name="token" type="password" autoComplete="off" spellCheck={false} disabled={!canSaveToken} placeholder={hasToken ? "leave empty to keep the saved one" : "github_pat_…"} className={input} />
          {error("token")}
        </label>
        {hasToken ? (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" name="removeToken" /> Remove the saved token (only for a repository that has become public)
          </label>
        ) : null}

        {state.error && !state.field ? <p className="text-sm text-danger">{state.error}</p> : null}
        {state.message ? <p className="text-sm text-success">{state.message}</p> : null}
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </form>
    </details>
  );
}
