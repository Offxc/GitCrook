"use client";

import { useActionState, useState } from "react";
import { connectRepository, type GitActionState } from "./actions";

export interface VariantOption {
  id: string;
  label: string;
  pageCount: number;
}

const input = "w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand disabled:opacity-60";

export function ConnectForm({ orgSlug, siteId, variants, canSaveToken, tokenProblem, host }: { orgSlug: string; siteId: string; variants: VariantOption[]; canSaveToken: boolean; tokenProblem: string | null; host: string }) {
  const [state, formAction, pending] = useActionState<GitActionState, FormData>(connectRepository.bind(null, orgSlug, siteId), {});
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const selected = variants.find((v) => v.id === variantId);
  const error = (field: string) => (state.field === field && state.error ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Repository</span>
        <input name="repository" required placeholder={`owner/name, or its ${host} address`} autoComplete="off" spellCheck={false} className={input} />
        {error("repository")}
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Version of the site it fills</span>
        <select name="variantId" value={variantId} onChange={(e) => setVariantId(e.target.value)} className={input}>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} — {v.pageCount === 0 ? "empty" : `${v.pageCount} page${v.pageCount === 1 ? "" : "s"}`}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink-muted">A repository fills a whole version. Other versions stay editable here.</span>
        {error("variant")}
      </label>

      {selected && selected.pageCount > 0 ? (
        <label className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <input type="checkbox" name="replace" className="mt-0.5" />
          <span>
            <span className="font-medium text-ink">Replace the {selected.pageCount} page{selected.pageCount === 1 ? "" : "s"} in “{selected.label}”.</span>
            <span className="block text-xs text-ink-muted">They are deleted for good and the repository&apos;s pages take their place. This cannot be undone.</span>
          </span>
        </label>
      ) : null}
      {error("replace")}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Branch</span>
          <input name="branch" placeholder="the repository's default" autoComplete="off" spellCheck={false} className={input} />
          {error("branch")}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">Docs folder</span>
          <input name="rootDir" placeholder="the whole repository" autoComplete="off" spellCheck={false} className={input} />
          {error("rootDir")}
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-ink-muted">Access token (private repositories only)</span>
        <input name="token" type="password" autoComplete="off" spellCheck={false} disabled={!canSaveToken} placeholder={canSaveToken ? "github_pat_…" : "not available on this server"} className={input} />
        <span className="mt-1 block text-xs text-ink-muted">
          {canSaveToken
            ? "A fine-grained token with read-only access to the repository's contents. It is stored encrypted and never shown again."
            : (tokenProblem ?? "Whoever runs this server needs to set GIT_SYNC_ENCRYPTION_KEY before tokens can be saved. Public repositories work without one.")}
        </span>
        {error("token")}
      </label>

      {state.error && !state.field ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.message ? <p className="text-sm text-success">{state.message}</p> : null}

      <button type="submit" disabled={pending || variants.length === 0} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
        {pending ? "Checking the repository…" : "Connect repository"}
      </button>
    </form>
  );
}
