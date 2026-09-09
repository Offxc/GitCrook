"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import * as blockNoteLocales from "@blocknote/core/locales";
import { multiColumnDropCursor, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { savePageContent } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pages/[pageId]/actions";
import { voidDocsSchema } from "@/lib/editor/schema";
import { getVoidDocsSlashMenuItems } from "@/lib/editor/slashMenu";

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
  onDone,
}: {
  pageId: string;
  organizationId: string;
  siteId: string;
  initialContent: unknown;
  initialVersion: number;
  onDone: () => void;
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
    schema: voidDocsSchema,
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
      <div className="mb-4 flex items-center justify-between rounded-lg border border-site-border bg-site-surface px-3.5 py-2 text-xs text-site-ink-muted">
        <SaveIndicator status={status} />
        <button type="button" onClick={onDone} className="rounded-md px-2 py-1 font-medium text-site-ink transition hover:bg-site-canvas">
          Done editing
        </button>
      </div>
      <BlockNoteView editor={editor} onChange={scheduleSave} theme={blockNoteTheme} slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(getVoidDocsSlashMenuItems(editor), query)}
        />
      </BlockNoteView>
    </div>
  );
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
