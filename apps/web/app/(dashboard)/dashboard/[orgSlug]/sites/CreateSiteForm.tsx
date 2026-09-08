"use client";

import { useActionState } from "react";
import { createSite, type CreateSiteState } from "./actions";

export function CreateSiteForm({ orgSlug }: { orgSlug: string }) {
  const [state, formAction, pending] = useActionState<CreateSiteState, FormData>(createSite.bind(null, orgSlug), {});

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">Site name</span>
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Product Docs"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </label>
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">Slug</span>
        <input
          name="slug"
          required
          maxLength={96}
          pattern="[a-z0-9\-]+"
          placeholder="product-docs"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create site"}
      </button>
      {state.error ? <p className="text-sm text-danger sm:basis-full">{state.error}</p> : null}
    </form>
  );
}
