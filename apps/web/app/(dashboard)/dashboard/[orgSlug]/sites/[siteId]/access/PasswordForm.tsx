"use client";

import { useActionState, useRef } from "react";
import { setSitePassword, type AccessActionState } from "./actions";

export function PasswordForm({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<AccessActionState, FormData>(async (prev, formData) => {
    const result = await setSitePassword(orgSlug, siteId, prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={4}
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
        {pending ? "Saving..." : "Set password"}
      </button>
      {state.error ? <p className="text-sm text-danger sm:basis-full">{state.error}</p> : null}
    </form>
  );
}
