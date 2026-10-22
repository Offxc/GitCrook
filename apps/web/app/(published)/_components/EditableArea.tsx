"use client";

import { InPlaceEditorLoader } from "./InPlaceEditorLoader";
import { useEditMode } from "./EditModeContext";

/**
 * Wraps a page's read-only rendered content, swapping in the real editor
 * while the site is in edit mode. `editing` comes from EditModeContext — the
 * single floating toggle (EditModeToggle) is the only on/off switch, for
 * both this page's content and the sidebar's tree editing, so exiting edit
 * mode isn't a button living in this content area too.
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
  const { editing } = useEditMode();

  if (!canEdit || !editing) return <>{children}</>;

  return (
    <InPlaceEditorLoader
      pageId={pageId}
      organizationId={organizationId}
      siteId={siteId}
      initialContent={initialContent}
      initialVersion={initialVersion}
    />
  );
}
