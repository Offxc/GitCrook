"use client";

import { useActionState, useTransition } from "react";
import type { ShareLink } from "@gitcrook/db";
import { createShareLink, revokeShareLink, type AccessActionState } from "./actions";

export function ShareLinksSection({
  orgSlug,
  siteId,
  links,
  publishedBase,
}: {
  orgSlug: string;
  siteId: string;
  links: ShareLink[];
  publishedBase: string;
}) {
  const [state, formAction, pending] = useActionState<AccessActionState, FormData>(createShareLink.bind(null, orgSlug, siteId), {});

  return (
    <div className="space-y-4">
      {links.length > 0 ? (
        <ul className="space-y-2">
          {links.map((link) => (
            <ShareLinkRow key={link.id} orgSlug={orgSlug} siteId={siteId} link={link} publishedBase={publishedBase} />
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-muted">Label (optional)</span>
          <input name="label" placeholder="e.g. Beta partners" className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Expires in</span>
          <select name="expiresInDays" defaultValue="0" className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand">
            <option value="0">Never</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
          {pending ? "Creating..." : "Create link"}
        </button>
      </form>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
    </div>
  );
}

function ShareLinkRow({ orgSlug, siteId, link, publishedBase }: { orgSlug: string; siteId: string; link: ShareLink; publishedBase: string }) {
  const [pending, startTransition] = useTransition();
  const isRevoked = Boolean(link.revokedAt);
  const isExpired = Boolean(link.expiresAt && link.expiresAt < new Date());
  const url = `${publishedBase}?token=${link.token}`;

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate text-ink">{link.label || "Untitled link"}</p>
        <p className="truncate font-mono text-xs text-ink-muted">{url}</p>
        {isRevoked ? <p className="text-xs text-danger">Revoked</p> : isExpired ? <p className="text-xs text-danger">Expired</p> : null}
      </div>
      {!isRevoked ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              void revokeShareLink(orgSlug, siteId, link.id);
            })
          }
          className="shrink-0 text-xs text-ink-muted transition hover:text-danger disabled:opacity-60"
        >
          {pending ? "Revoking..." : "Revoke"}
        </button>
      ) : null}
    </li>
  );
}
