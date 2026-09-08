"use client";

import { useActionState } from "react";
import { createPage, type CreatePageState } from "./pagesActions";

export function NewPageForm({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const [state, formAction, pending] = useActionState<CreatePageState, FormData>(createPage.bind(null, orgSlug, siteId), {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        name="title"
        required
        maxLength={120}
        placeholder="New page title"
        className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating..." : "New page"}
      </button>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}
