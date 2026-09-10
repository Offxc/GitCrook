"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface EditModeState {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

const EditModeContext = createContext<EditModeState | null>(null);

const STORAGE_PREFIX = "voiddocs-edit-mode:";

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

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") setEditingState(true);
    } catch {
      // Private-browsing contexts can throw on access — edit mode just
      // won't persist there, which is a degradation rather than a break.
    }
  }, [storageKey]);

  const setEditing = useCallback(
    (next: boolean) => {
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

  return <EditModeContext.Provider value={{ editing, setEditing }}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditModeState {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error("useEditMode must be used within an EditModeProvider");
  return ctx;
}
