"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { editModeCookieName } from "./editModeCookie";

interface EditModeState {
  editing: boolean;
  setEditing: (editing: boolean) => Promise<void>;
  /** InPlaceEditorClient registers its pending-save flush here while mounted, so
   * turning editing off can await it first instead of racing an in-flight debounce
   * against the unmount that would otherwise drop it — see registerSaveFlush below. */
  registerSaveFlush: (flush: (() => Promise<void>) | null) => void;
}

const EditModeContext = createContext<EditModeState | null>(null);

/**
 * One toggle, shared by the sidebar and the page content area, so "Edit"
 * puts the whole site — structure (page/group ordering) and the current
 * page's content — into edit mode together.
 *
 * The value is remembered in a cookie (see editModeCookie.ts) and handed in as
 * `initialEditing`, which the server reads from that cookie. This provider lives
 * inside the page, not a layout, so every navigation remounts it; starting from
 * the right value means the first render is already the right one, instead of
 * rendering read-only and flipping to editable from an effect. Edit mode is
 * supposed to last until you actually click Done.
 */
export function EditModeProvider({ siteId, initialEditing, children }: { siteId: string; initialEditing: boolean; children: React.ReactNode }) {
  const saveFlushRef = useRef<(() => Promise<void>) | null>(null);
  const [editing, setEditingState] = useState(initialEditing);
  const setEditing = useCallback(
    async (next: boolean) => {
      // Flush before switching to read-only: the editor is about to unmount,
      // which would silently drop anything still sitting in its 800ms
      // debounce (e.g. a table edit made right before clicking "Done").
      // Failures are swallowed here on purpose: InPlaceEditorClient already
      // surfaces a failed save via its own "error" status, and a rejection
      // escaping this await would skip setEditingState below entirely,
      // leaving "Done editing" looking completely inert — exiting edit mode
      // must not depend on the flush having succeeded.
      if (!next) {
        try {
          await saveFlushRef.current?.();
        } catch {
          // best-effort — see comment above
        }
      }
      setEditingState(next);
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = next
        ? `${editModeCookieName(siteId)}=1; Path=/; SameSite=Lax${secure}`
        : `${editModeCookieName(siteId)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    },
    [siteId],
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
