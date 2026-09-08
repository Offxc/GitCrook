"use client";

import { useActionState } from "react";
import { updateAudienceMode, type AccessActionState } from "./actions";

const OPTIONS = [
  { value: "PUBLIC", label: "Public", hint: "Anyone with the link can view." },
  { value: "PRIVATE", label: "Private", hint: "Only signed-in members with access can view." },
  { value: "PASSWORD", label: "Password-protected", hint: "Visitors must enter a password once." },
] as const;

export function AudienceForm({
  orgSlug,
  siteId,
  currentMode,
  hasPassword,
}: {
  orgSlug: string;
  siteId: string;
  currentMode: string;
  hasPassword: boolean;
}) {
  const [state, formAction, pending] = useActionState<AccessActionState, FormData>(updateAudienceMode.bind(null, orgSlug, siteId), {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="audienceMode" value={opt.value} defaultChecked={currentMode === opt.value} className="mt-0.5" />
            <span>
              <span className="block text-ink">{opt.label}</span>
              <span className="block text-xs text-ink-muted">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
        {pending ? "Saving..." : "Save"}
      </button>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {!hasPassword ? <p className="text-xs text-ink-muted">Set a password below first if you plan to switch to Password-protected.</p> : null}
    </form>
  );
}
