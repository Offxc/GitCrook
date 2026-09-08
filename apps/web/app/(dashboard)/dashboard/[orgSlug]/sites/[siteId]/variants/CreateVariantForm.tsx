"use client";

import { useActionState } from "react";
import { createVariant, type VariantActionState } from "./actions";

export function CreateVariantForm({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const [state, formAction, pending] = useActionState<VariantActionState, FormData>(createVariant.bind(null, orgSlug, siteId), {});

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">Name</span>
        <input name="name" required placeholder="v2.0" className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
      </label>
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">Slug</span>
        <input name="slug" required placeholder="v2" className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
        {pending ? "Creating..." : "Create variant"}
      </button>
      {state.error ? <p className="text-sm text-danger sm:basis-full">{state.error}</p> : null}
    </form>
  );
}
