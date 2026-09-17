"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import * as blockNoteLocales from "@blocknote/core/locales";
import { multiColumnDropCursor, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { savePageContent } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pages/[pageId]/actions";
import { gitCrookSchema } from "@/lib/editor/schema";
import { getGitCrookSlashMenuItems } from "@/lib/editor/slashMenu";

type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

const DEFAULT_CONTENT = [{ type: "paragraph" as const, content: [] }];

/**
 * Same editor as the dashboard's EditorClient (same schema, same save
 * action), but themed to the site being edited rather than the dashboard's
 * own light-only chrome — this is what makes editing "the same page" rather
 * than a different-looking admin tool bolted on top of it.
 */
export function InPlaceEditorClient({
  pageId,
  organizationId,
  siteId,
  initialContent,
  initialVersion,
}: {
  pageId: string;
  organizationId: string;
  siteId: string;
  initialContent: unknown;
  initialVersion: number;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [blockNoteTheme, setBlockNoteTheme] = useState<"light" | "dark">("light");
  const versionRef = useRef(initialVersion);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const root = document.querySelector("[data-site-root]");
    const mode = root?.getAttribute("data-site-mode");
    const resolved = mode === "dark" || mode === "light" ? mode : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setBlockNoteTheme(resolved);
  }, []);

  const editor = useCreateBlockNote({
    schema: gitCrookSchema,
    dropCursor: multiColumnDropCursor,
    dictionary: { ...blockNoteLocales.en, multi_column: multiColumnLocales.en },
    initialContent: isNonEmptyArray(initialContent) ? initialContent : DEFAULT_CONTENT,
    uploadFile: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("organizationId", organizationId);
      form.append("siteId", siteId);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const { url } = await res.json();
      return url as string;
    },
  });

  const doSave = useCallback(async () => {
    setStatus("saving");
    const result = await savePageContent(pageId, versionRef.current, editor.document);
    if (result.ok && result.contentVersion !== undefined) {
      versionRef.current = result.contentVersion;
      setStatus("saved");
    } else if (result.conflict) {
      setStatus("conflict");
    } else {
      setStatus("error");
    }
  }, [pageId, editor]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 800);
  }, [doSave]);

  return (
    <div>
      <div className="mb-4 rounded-lg border border-site-border bg-site-surface px-3.5 py-2 text-xs text-site-ink-muted">
        <SaveIndicator status={status} />
      </div>
      {/* min-height so there's always a large blank area below short content
          to click into — but BlockNote's own root (.bn-container) only ever
          sizes itself to its content, min-height on an ancestor doesn't
          stretch it, so that blank area belongs to THIS div, not the
          contenteditable inside it. onClick only fires when the click lands
          on the wrapper itself (not bubbled from a real block), and moves
          the cursor to the end of the document — the same "click below the
          last line to keep typing" affordance every block editor has, just
          implemented explicitly since the DOM doesn't give it to us for
          free here. */}
      <div className="min-h-[60vh] cursor-text" onClick={(e) => e.target === e.currentTarget && focusEditorEnd(e.currentTarget)}>
        <BlockNoteView editor={editor} onChange={scheduleSave} theme={blockNoteTheme} slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems(getGitCrookSlashMenuItems(editor), query)}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}

function focusEditorEnd(container: HTMLElement) {
  const editable = container.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editable) return;
  editable.focus();
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function isNonEmptyArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0;
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case "saving":
      return <span>Saving...</span>;
    case "saved":
      return <span>Saved</span>;
    case "conflict":
      return <span className="text-site-danger">Edited elsewhere — reload the page before continuing</span>;
    case "error":
      return <span className="text-site-danger">Couldn't save — check your connection</span>;
    default:
      return <span>&nbsp;</span>;
  }
}
