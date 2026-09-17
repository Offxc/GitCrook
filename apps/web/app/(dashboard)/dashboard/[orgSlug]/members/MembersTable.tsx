"use client";

import { useState, useTransition } from "react";
import type { Role } from "@gitcrook/db";
import { updateMemberRole, removeMember } from "./actions";

const ROLE_OPTIONS: Role[] = ["GUEST", "READER", "COMMENTER", "EDITOR", "REVIEWER", "CREATOR", "ADMIN"];

interface MembershipRow {
  id: string;
  role: Role;
  userId: string;
  user: { id: string; name: string | null; email: string | null; image: string | null };
}

export function MembersTable({ orgSlug, memberships, currentUserId }: { orgSlug: string; memberships: MembershipRow[]; currentUserId: string }) {
  return (
    <ul className="space-y-2">
      {memberships.map((m) => (
        <MemberRow key={m.id} orgSlug={orgSlug} membership={m} isSelf={m.userId === currentUserId} />
      ))}
    </ul>
  );
}

function MemberRow({ orgSlug, membership, isSelf }: { orgSlug: string; membership: MembershipRow; isSelf: boolean }) {
  // Controlled by confirmed server state only — a rejected change (e.g. the
  // last-admin guard) must never leave the <select> showing a value that
  // was never actually saved, so this updates on success only, not on pick.
  const [role, setRole] = useState<Role>(membership.role);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRoleChange(next: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRole(orgSlug, membership.id, next);
      if (result.error) setError(result.error);
      else setRole(next as Role);
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeMember(orgSlug, membership.id);
      if (result.error) setError(result.error);
      else setRemoved(true);
    });
  }

  if (removed) return null;

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">
            {membership.user.name ?? membership.user.email ?? membership.userId}
            {isSelf ? <span className="ml-1.5 text-xs text-ink-muted">(you)</span> : null}
          </p>
          {membership.user.email ? <p className="truncate text-xs text-ink-muted">{membership.user.email}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={role}
            disabled={pending}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending} onClick={handleRemove} className="text-xs text-ink-muted transition hover:text-danger disabled:opacity-60">
            Remove
          </button>
        </div>
      </div>
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </li>
  );
}
