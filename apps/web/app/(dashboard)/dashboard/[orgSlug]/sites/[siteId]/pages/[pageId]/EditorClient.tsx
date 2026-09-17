"use client";

import { useCallback, useRef, useState } from "react";
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import * as blockNoteLocales from "@blocknote/core/locales";
import { multiColumnDropCursor, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { savePageContent } from "./actions";
import { gitCrookSchema } from "@/lib/editor/schema";
import { getGitCrookSlashMenuItems } from "@/lib/editor/slashMenu";

type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

const DEFAULT_CONTENT = [{ type: "paragraph" as const, content: [] }];

export function EditorClient({
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
  const versionRef = useRef(initialVersion);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <div className="flex flex-1 flex-col">
      <div className="border-b border-border px-6 py-1.5 text-right text-xs text-ink-muted">
        <SaveIndicator status={status} />
      </div>
      {/* onClick: see InPlaceEditorClient's identical fix — BlockNote's own
          root only sizes to its content, so without this, clicking the
          blank space below the last block (inside this flex-1 scroll area,
          but outside .bn-container itself) does nothing. */}
      <div className="flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && focusEditorEnd(e.currentTarget)}>
        <div className="mx-auto max-w-3xl px-6 py-8">
          <BlockNoteView editor={editor} onChange={scheduleSave} theme="light" slashMenu={false}>
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) => filterSuggestionItems(getGitCrookSlashMenuItems(editor), query)}
            />
          </BlockNoteView>
        </div>
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
      return <span className="text-danger">Edited elsewhere — reload the page before continuing</span>;
    case "error":
      return <span className="text-danger">Couldn't save — check your connection</span>;
    default:
      return <span>&nbsp;</span>;
  }
}
