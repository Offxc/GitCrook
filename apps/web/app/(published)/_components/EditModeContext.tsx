"use client";

import { createContext, useContext, useState } from "react";

interface EditModeState {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

const EditModeContext = createContext<EditModeState | null>(null);

/**
 * One toggle, shared by the sidebar and the page content area, so "Edit"
 * puts the whole site — structure (page/group ordering) and the current
 * page's content — into edit mode together. Previously each surface owned
 * its own local state, which is what made the content editor's Edit button
 * look like the only editing entry point, with no way to reorder pages/
 * groups at all.
 */
export function EditModeProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <EditModeContext.Provider value={{ editing, setEditing }}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditModeState {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error("useEditMode must be used within an EditModeProvider");
  return ctx;
}
