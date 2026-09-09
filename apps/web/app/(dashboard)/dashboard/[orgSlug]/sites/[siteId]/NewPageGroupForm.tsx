"use client";

import { useActionState } from "react";
import { createPageGroup, type CreatePageGroupState } from "./pagesActions";

export function NewPageGroupForm({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const [state, formAction, pending] = useActionState<CreatePageGroupState, FormData>(createPageGroup.bind(null, orgSlug, siteId), {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        name="title"
        required
        maxLength={120}
        placeholder="New group title"
        className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface disabled:opacity-60"
      >
        {pending ? "Creating..." : "New group"}
      </button>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}
