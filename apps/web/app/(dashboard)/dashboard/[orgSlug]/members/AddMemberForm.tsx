"use client";

import { useActionState } from "react";
import type { Role } from "@voiddocs/db";
import { addMember, type MemberActionState } from "./actions";

const ROLE_OPTIONS: Role[] = ["GUEST", "READER", "COMMENTER", "EDITOR", "REVIEWER", "CREATOR", "ADMIN"];

export function AddMemberForm({ orgSlug }: { orgSlug: string }) {
  const [state, formAction, pending] = useActionState<MemberActionState, FormData>(addMember.bind(null, orgSlug), {});

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm">
        <span className="mb-1 block text-ink-muted">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-ink-muted">Role</span>
        <select name="role" defaultValue="READER" className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand">
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
        {pending ? "Adding..." : "Add member"}
      </button>
      {state.error ? <p className="text-sm text-danger sm:basis-full">{state.error}</p> : null}
    </form>
  );
}
