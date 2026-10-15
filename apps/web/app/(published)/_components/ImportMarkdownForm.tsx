"use client";

import { useRef, useState, useTransition } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { importMarkdownPages } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pagesActions";
import { gitCrookSchema } from "@/lib/editor/schema";

interface ParsedFile {
  name: string;
  title: string;
  blocks: unknown[];
}

/**
 * Markdown import, parsed with BlockNote's own `tryParseMarkdownToBlocks`
 * rather than a parser of our own — the stored document then has exactly the
 * shape the editor itself produces, including the block types this app's
 * read-only renderer expects. Parsing happens here, client-side, because
 * that API belongs to an editor instance and wants a DOM; the server action
 * only validates, normalises and stores the result.
 */
export function ImportMarkdownForm({ orgSlug, siteId, baseHref, onCancel }: { orgSlug: string; siteId: string; baseHref: string; onCancel: () => void }) {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    setReading(true);
    try {
      // One throwaway editor for the whole batch — creating it is the
      // expensive part, parsing against it is not.
      const editor = BlockNoteEditor.create({ schema: gitCrookSchema });
      const parsed: ParsedFile[] = [];
      for (const file of Array.from(picked)) {
        const blocks = editor.tryParseMarkdownToBlocks(await file.text()) as unknown[];
        parsed.push({ name: file.name, ...titleFor(blocks, file.name) });
      }
      setFiles(parsed.filter((f) => f.blocks.length > 0));
      if (parsed.every((f) => f.blocks.length === 0)) setError("Nothing to import — those files look empty.");
    } catch {
      setError("Couldn't read those files.");
    } finally {
      setReading(false);
    }
  }

  function submit() {
    if (files.length === 0) return;
    startTransition(async () => {
      const result = await importMarkdownPages(
        orgSlug,
        siteId,
        files.map((f) => ({ title: f.title, blocks: f.blocks })),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      // A real navigation rather than router.push — same reason as
      // AddNewButton's: a client transition straight after a Server Action
      // doesn't reliably pick up the new page here.
      window.location.href = result.firstSlug ? `${baseHref}/${result.firstSlug}` : baseHref;
    });
  }

  const busy = reading || pending;

  return (
    <div className="space-y-1.5 px-2">
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        multiple
        onChange={(e) => void onPick(e.target.files)}
        className="hidden"
      />

      {files.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full rounded-md border border-dashed border-site-border px-2 py-2 text-xs text-site-ink-muted transition hover:border-site-primary hover:text-site-ink disabled:opacity-50"
        >
          {reading ? "Reading..." : "Choose .md files"}
        </button>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {files.map((f) => (
            <li key={f.name} className="truncate text-[11px] text-site-ink-muted" title={`${f.name} → ${f.title}`}>
              {f.title}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || files.length === 0}
          className="rounded-md bg-site-primary px-2 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Importing..." : files.length > 0 ? `Import ${files.length}` : "Import"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-site-ink-muted hover:text-site-ink">
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-site-danger">{error}</p> : null}
    </div>
  );
}

/**
 * A Markdown file normally opens with its own title as an H1. Using it as
 * the page title (and dropping it from the body) avoids every imported page
 * rendering that heading twice, since the page template already shows the
 * title. Falls back to a tidied-up filename.
 */
function titleFor(blocks: unknown[], filename: string): { title: string; blocks: unknown[] } {
  const first = blocks[0] as { type?: string; props?: { level?: number }; content?: unknown } | undefined;
  if (first?.type === "heading" && first.props?.level === 1) {
    const heading = inlineText(first.content).trim();
    if (heading) return { title: heading.slice(0, 120), blocks: blocks.slice(1) };
  }
  return { title: filenameToTitle(filename), blocks };
}

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const it = item as { text?: string; content?: unknown };
      return typeof it.text === "string" ? it.text : inlineText(it.content);
    })
    .join("");
}

function filenameToTitle(filename: string): string {
  const base = filename.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ").trim();
  if (!base) return "Untitled";
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120);
}
