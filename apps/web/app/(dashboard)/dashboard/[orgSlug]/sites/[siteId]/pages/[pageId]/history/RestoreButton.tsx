"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restorePageVersion } from "../actions";

export function RestoreButton({ orgSlug, siteId, pageId, versionId }: { orgSlug: string; siteId: string; pageId: string; versionId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleRestore() {
    setError(null);
    startTransition(async () => {
      const result = await restorePageVersion(pageId, versionId);
      if (result.error) setError(result.error);
      else router.push(`/dashboard/${orgSlug}/sites/${siteId}/pages/${pageId}`);
    });
  }

  return (
    <div className="shrink-0 text-right">
      <button type="button" disabled={pending} onClick={handleRestore} className="text-xs text-brand hover:underline disabled:opacity-60">
        {pending ? "Restoring..." : "Restore"}
      </button>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
