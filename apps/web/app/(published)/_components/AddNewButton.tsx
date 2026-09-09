"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPage, createPageGroup } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pagesActions";

/**
 * Creating a page or group used to only be possible from a separate
 * dashboard screen — this puts it where GitBook actually puts it: a control
 * at the bottom of the sidebar itself, so nothing about authoring a site
 * requires leaving the page you're looking at.
 */
export function AddNewButton({ orgSlug, siteId, baseHref }: { orgSlug: string; siteId: string; baseHref: string }) {
  const [mode, setMode] = useState<"closed" | "menu" | "page" | "group">("closed");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setMode("closed");
    setTitle("");
    setError(null);
  }

  function submit() {
    if (!title.trim()) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("title", title);
      const result = mode === "page" ? await createPage(orgSlug, siteId, {}, formData) : await createPageGroup(orgSlug, siteId, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (mode === "page" && result.slug) {
        // A real navigation, not router.push — see sites/actions.ts's
        // createSite for why a client-side transition right after a Server
        // Action is unreliable here.
        window.location.href = `${baseHref}/${result.slug}`;
        return;
      }
      // A new (childless) group has nothing of its own to navigate to —
      // just refresh this page so the sidebar picks it up.
      router.refresh();
      reset();
    });
  }

  if (mode === "closed") {
    return (
      <button
        type="button"
        onClick={() => setMode("menu")}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink"
      >
        <PlusIcon />
        Add new...
      </button>
    );
  }

  if (mode === "menu") {
    return (
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => setMode("page")}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink"
        >
          <PageIcon />
          Page
        </button>
        <button
          type="button"
          onClick={() => setMode("group")}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[13px] text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink"
        >
          <GroupIcon />
          Group
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 px-2">
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening this form should focus the title immediately */}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") reset();
        }}
        placeholder={mode === "page" ? "Page title" : "Group title"}
        className="w-full rounded-md border border-site-border bg-site-canvas px-2 py-1 text-[13px] text-site-ink outline-none focus:border-site-primary"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !title.trim()}
          className="rounded-md bg-site-primary px-2 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating..." : "Create"}
        </button>
        <button type="button" onClick={reset} className="text-xs text-site-ink-muted hover:text-site-ink">
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-site-danger">{error}</p> : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
