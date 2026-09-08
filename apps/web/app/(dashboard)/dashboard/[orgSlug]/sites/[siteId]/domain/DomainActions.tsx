"use client";

import { useActionState, useTransition } from "react";
import { verifyDomain, removeDomain } from "./actions";
import type { DomainActionState } from "./shared";

export function VerifyButton({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const [state, formAction, pending] = useActionState<DomainActionState, FormData>(
    async (prev) => verifyDomain(orgSlug, siteId).then((r) => r ?? prev),
    {},
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Checking..." : "Verify"}
      </button>
      {state.error ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}

export function RemoveDomainButton({ orgSlug, siteId }: { orgSlug: string; siteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          void removeDomain(orgSlug, siteId);
        })
      }
      className="text-sm text-ink-muted transition hover:text-danger disabled:opacity-60"
    >
      {pending ? "Removing..." : "Remove domain"}
    </button>
  );
}
