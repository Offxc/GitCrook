"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface EditModeState {
  editing: boolean;
  setEditing: (editing: boolean) => Promise<void>;
  /** InPlaceEditorClient registers its pending-save flush here while mounted, so
   * turning editing off can await it first instead of racing an in-flight debounce
   * against the unmount that would otherwise drop it — see registerSaveFlush below. */
  registerSaveFlush: (flush: (() => Promise<void>) | null) => void;
}

const EditModeContext = createContext<EditModeState | null>(null);

const STORAGE_PREFIX = "gitcrook-edit-mode:";

/**
 * One toggle, shared by the sidebar and the page content area, so "Edit"
 * puts the whole site — structure (page/group ordering) and the current
 * page's content — into edit mode together.
 *
 * Backed by sessionStorage rather than plain state because this provider
 * lives inside the page, not a layout: every navigation remounts it, and
 * some of them (AddNewButton after creating a page) are full document loads
 * that would reset React state regardless of where the provider sat. Edit
 * mode is supposed to last until you actually click Done, so it has to
 * survive both. Keyed per site so editing one site doesn't silently put
 * another into edit mode in the same tab, and session-scoped so it doesn't
 * outlive the tab.
 */
export function EditModeProvider({ siteId, children }: { siteId: string; children: React.ReactNode }) {
  // Always starts false: the server render can't know what's in
  // sessionStorage, so anything else would be a hydration mismatch.
  const [editing, setEditingState] = useState(false);
  const storageKey = `${STORAGE_PREFIX}${siteId}`;
  const saveFlushRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") setEditingState(true);
    } catch {
      // Private-browsing contexts can throw on access — edit mode just
      // won't persist there, which is a degradation rather than a break.
    }
  }, [storageKey]);

  const setEditing = useCallback(
    async (next: boolean) => {
      // Flush before switching to read-only: the editor is about to unmount,
      // which would silently drop anything still sitting in its 800ms
      // debounce (e.g. a table edit made right before clicking "Done").
      if (!next) await saveFlushRef.current?.();
      setEditingState(next);
      try {
        if (next) sessionStorage.setItem(storageKey, "1");
        else sessionStorage.removeItem(storageKey);
      } catch {
        // best-effort only
      }
    },
    [storageKey],
  );

  const registerSaveFlush = useCallback((flush: (() => Promise<void>) | null) => {
    saveFlushRef.current = flush;
  }, []);

  return <EditModeContext.Provider value={{ editing, setEditing, registerSaveFlush }}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditModeState {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error("useEditMode must be used within an EditModeProvider");
  return ctx;
}
