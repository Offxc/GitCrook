"use client";

import { useState, useTransition } from "react";
import { PageIcon } from "@/app/(published)/_components/PageIcon";
import { IconPickerPopover } from "@/app/(published)/_components/IconPickerPopover";
import { updatePageIcon } from "./actions";

export function PageIconPicker({ orgSlug, siteId, pageId, initialIcon }: { orgSlug: string; siteId: string; pageId: string; initialIcon: string | null }) {
  const [icon, setIcon] = useState(initialIcon);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function choose(slug: string | null) {
    setIcon(slug);
    setOpen(false);
    startTransition(async () => {
      await updatePageIcon(orgSlug, siteId, pageId, slug);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={icon ? "Change page icon" : "Add a page icon"}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-ink-muted transition hover:bg-surface hover:text-ink"
      >
        {icon ? <PageIcon icon={icon} className="h-4 w-4" /> : <PlaceholderIcon />}
      </button>

      {open ? <IconPickerPopover variant="app" onSelect={choose} onClose={() => setOpen(false)} canRemove={icon !== null} onRemove={() => choose(null)} /> : null}
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.7-1.2c0 1.7-2.2 1.9-2.2 3.7M12 16.5h.01" />
    </svg>
  );
}
