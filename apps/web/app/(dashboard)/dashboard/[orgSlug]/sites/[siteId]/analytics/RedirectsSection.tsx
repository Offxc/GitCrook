"use client";

import { useActionState, useTransition } from "react";
import type { SiteRedirect } from "@voiddocs/db";
import { createRedirect, deleteRedirect, type RedirectActionState } from "./redirectActions";

export function RedirectsSection({ orgSlug, siteId, redirects, prefillFrom }: { orgSlug: string; siteId: string; redirects: SiteRedirect[]; prefillFrom?: string }) {
  const [state, formAction, pending] = useActionState<RedirectActionState, FormData>(createRedirect.bind(null, orgSlug, siteId), {});

  return (
    <div className="space-y-4">
      {redirects.length > 0 ? (
        <ul className="space-y-1.5">
          {redirects.map((r) => (
            <RedirectRow key={r.id} orgSlug={orgSlug} siteId={siteId} redirect={r} />
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-muted">From path</span>
          <input
            name="fromPath"
            defaultValue={prefillFrom}
            placeholder="old-page"
            className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-muted">To path</span>
          <input name="toPath" placeholder="new-page" className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
          {pending ? "Adding..." : "Add redirect"}
        </button>
      </form>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </div>
  );
}

function RedirectRow({ orgSlug, siteId, redirect }: { orgSlug: string; siteId: string; redirect: SiteRedirect }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <p className="min-w-0 truncate font-mono text-xs text-ink">
        /{redirect.fromPath} <span className="text-ink-muted">→</span> /{redirect.toPath}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => void deleteRedirect(orgSlug, siteId, redirect.id))}
        className="shrink-0 text-xs text-ink-muted transition hover:text-danger disabled:opacity-60"
      >
        {pending ? "Removing..." : "Remove"}
      </button>
    </li>
  );
}
