"use client";

import { useActionState } from "react";
import { submitSitePassword, type PasswordGateState } from "@/lib/tenancy/passwordGateActions";

export function PasswordGate({ siteId, siteName, redirectTo }: { siteId: string; siteName: string; redirectTo: string }) {
  const [state, formAction, pending] = useActionState<PasswordGateState, FormData>(submitSitePassword.bind(null, siteId), {});

  return (
    <div data-site-root className="flex min-h-screen flex-col items-center justify-center bg-site-canvas px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-lg font-semibold text-site-ink">{siteName}</h1>
        <p className="mt-1 text-center text-sm text-site-ink-muted">This site is password-protected.</p>
        <form action={formAction} className="mt-6 space-y-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the only field on the page; focusing it is the whole point */}
          <input
            autoFocus
            type="password"
            name="password"
            required
            placeholder="Password"
            className="w-full rounded-lg border border-site-border bg-site-canvas px-3 py-2 text-sm text-site-ink outline-none focus:border-site-primary"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-site-primary px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Checking..." : "Continue"}
          </button>
          {state.error ? <p className="text-center text-sm text-red-500">{state.error}</p> : null}
        </form>
      </div>
    </div>
  );
}
