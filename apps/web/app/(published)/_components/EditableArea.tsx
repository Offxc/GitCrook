"use client";

import { useRouter } from "next/navigation";
import { InPlaceEditorLoader } from "./InPlaceEditorLoader";
import { useEditMode } from "./EditModeContext";

/**
 * Wraps a page's read-only rendered content. Members with edit rights get an
 * Edit toggle that swaps this same spot for the real editor — same page,
 * same theme, not a separate dashboard route. Anonymous/non-editing
 * visitors never render (or download the JS for) anything in this file
 * beyond this thin wrapper — see InPlaceEditorLoader for why.
 *
 * `editing` comes from EditModeContext, shared with the sidebar's toggle —
 * so switching into edit mode from either place puts both the page tree
 * (reorder/regroup) and this page's content into edit mode together.
 */
export function EditableArea({
  canEdit,
  pageId,
  organizationId,
  siteId,
  initialContent,
  initialVersion,
  children,
}: {
  canEdit: boolean;
  pageId: string;
  organizationId: string;
  siteId: string;
  initialContent: unknown;
  initialVersion: number;
  children: React.ReactNode;
}) {
  const { editing, setEditing } = useEditMode();
  const router = useRouter();

  if (!canEdit) return <>{children}</>;

  if (editing) {
    return (
      <InPlaceEditorLoader
        pageId={pageId}
        organizationId={organizationId}
        siteId={siteId}
        initialContent={initialContent}
        initialVersion={initialVersion}
        onDone={() => {
          setEditing(false);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 rounded-lg border border-site-border px-3 py-1.5 text-xs font-medium text-site-ink-muted transition hover:border-site-primary hover:text-site-primary"
        >
          <EditIcon />
          Edit
        </button>
      </div>
      {children}
    </div>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
