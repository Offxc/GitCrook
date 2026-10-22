"use client";

import { useState, useTransition } from "react";
import type { Role } from "@gitcrook/db";
import { revokeInvitation } from "./actions";

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

/** Invited but not signed in yet. Sign-up is closed by default, so these are people who can create an account. */
export function PendingInvitations({ orgSlug, invitations }: { orgSlug: string; invitations: InvitationRow[] }) {
  return (
    <ul className="space-y-2">
      {invitations.map((invitation) => (
        <InvitationItem key={invitation.id} orgSlug={orgSlug} invitation={invitation} />
      ))}
    </ul>
  );
}

function InvitationItem({ orgSlug, invitation }: { orgSlug: string; invitation: InvitationRow }) {
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (revoked) return null;

  function handleRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitation(orgSlug, invitation.id);
      if (result.error) setError(result.error);
      else setRevoked(true);
    });
  }

  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{invitation.email}</p>
          <p className="text-xs text-ink-muted">
            {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
          </p>
        </div>
        <button type="button" disabled={pending} onClick={handleRevoke} className="shrink-0 text-xs text-ink-muted transition hover:text-danger disabled:opacity-60">
          Revoke
        </button>
      </div>
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </li>
  );
}
