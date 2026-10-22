"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSection, renameSection, deleteSection, type SectionActionState } from "../sectionsActions";

export interface SectionRow {
  id: string;
  title: string;
  slug: string;
  pageCount: number;
}

export function SectionsManager({ orgSlug, siteId, sections }: { orgSlug: string; siteId: string; sections: SectionRow[] }) {
  const [state, formAction, pending] = useActionState<SectionActionState, FormData>(createSection.bind(null, orgSlug, siteId), {});
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {sections.map((section) => (
          <SectionItem key={section.id} orgSlug={orgSlug} siteId={siteId} section={section} onChanged={() => router.refresh()} canDelete={sections.length > 1} />
        ))}
      </div>

      <form action={formAction} className="rounded-xl border border-border bg-canvas p-5">
        <h2 className="mb-1 text-sm font-medium text-ink">New section</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Each section gets its own page tree and appears as a tab above the sidebar on the published site.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="title"
            placeholder="e.g. Developers"
            maxLength={80}
            className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
          <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-ink transition hover:opacity-90 disabled:opacity-60">
            {pending ? "Creating..." : "Add section"}
          </button>
        </div>
        {state.error ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
      </form>
    </div>
  );
}

function SectionItem({
  orgSlug,
  siteId,
  section,
  canDelete,
  onChanged,
}: {
  orgSlug: string;
  siteId: string;
  section: SectionRow;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(section.title);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (title.trim() === section.title || !title.trim()) {
      setTitle(section.title);
      return;
    }
    startTransition(async () => {
      const result = await renameSection(orgSlug, siteId, section.id, title);
      if (result.error) {
        setError(result.error);
        setTitle(section.title);
      } else {
        setError(null);
        onChanged();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteSection(orgSlug, siteId, section.id);
      if (result.error) setError(result.error);
      else onChanged();
      setConfirming(false);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-canvas px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setTitle(section.title);
          }}
          aria-label={`Section title for ${section.slug}`}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink outline-none hover:border-border focus:border-brand"
        />
        <span className="shrink-0 font-mono text-xs text-ink-muted">/{section.slug}</span>
        <span className="shrink-0 text-xs text-ink-muted">
          {section.pageCount} page{section.pageCount === 1 ? "" : "s"}
        </span>
        {canDelete ? (
          confirming ? (
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={remove} disabled={pending} className="text-xs font-medium text-danger hover:underline disabled:opacity-60">
                {pending ? "Deleting..." : "Delete everything in it"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-muted hover:text-ink">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="shrink-0 text-xs text-ink-muted transition hover:text-danger">
              Delete
            </button>
          )
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
