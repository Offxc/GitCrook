"use client";

import { useState } from "react";
import { PAGE_ICONS } from "@/lib/editor/pageIcons";

/**
 * Presentation only — search + grid over the flat Phosphor icon set (see
 * pageIcons.ts), with no opinion on persistence. Callers wire onSelect to
 * whatever save path fits their context (a standalone Server Action call
 * from the dashboard's PageIconPicker; an optimistic row update from the
 * live sidebar's tree). Assumes a `position: relative` parent, same as any
 * anchored popover in this app.
 *
 * `variant` picks which token namespace to render with — the dashboard's
 * app-shell tokens (--color-*, unprefixed Tailwind classes) and a published
 * site's own theme tokens (--site-*) are deliberately separate systems (see
 * globals.css), and this component is used from both, so it can't hardcode
 * either one.
 */
export function IconPickerPopover({
  onSelect,
  onClose,
  canRemove,
  onRemove,
  variant = "site",
}: {
  onSelect: (slug: string) => void;
  onClose: () => void;
  canRemove?: boolean;
  onRemove?: () => void;
  variant?: "site" | "app";
}) {
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = q ? PAGE_ICONS.filter((e) => e.label.toLowerCase().includes(q) || e.slug.includes(q) || e.keywords.some((k) => k.includes(q))) : PAGE_ICONS;

  const t =
    variant === "app"
      ? {
          border: "border-border",
          canvas: "bg-canvas",
          ink: "text-ink",
          inkMuted: "text-ink-muted",
          hoverSurfaceInk: "hover:bg-surface hover:text-ink",
          accent: "focus:border-brand",
          danger: "hover:text-danger",
        }
      : {
          border: "border-site-border",
          canvas: "bg-site-canvas",
          ink: "text-site-ink",
          inkMuted: "text-site-ink-muted",
          hoverSurfaceInk: "hover:bg-site-surface hover:text-site-ink",
          accent: "focus:border-site-primary",
          danger: "hover:text-site-danger",
        };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border ${t.border} ${t.canvas} p-2 shadow-2xl`}>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the picker should focus search immediately */}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className={`mb-2 w-full rounded-lg border ${t.border} ${t.canvas} px-2.5 py-1.5 text-sm ${t.ink} outline-none ${t.accent}`}
        />
        <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
          {filtered.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              title={entry.label}
              onClick={() => onSelect(entry.slug)}
              className={`flex h-8 w-8 items-center justify-center rounded-md ${t.inkMuted} transition ${t.hoverSurfaceInk}`}
            >
              <entry.Icon className="h-4 w-4" weight="regular" />
            </button>
          ))}
          {filtered.length === 0 ? <p className={`col-span-8 py-3 text-center text-xs ${t.inkMuted}`}>No matching icons</p> : null}
        </div>
        {canRemove ? (
          <button type="button" onClick={onRemove} className={`mt-2 w-full rounded-lg py-1.5 text-center text-xs ${t.inkMuted} ${t.danger}`}>
            Remove icon
          </button>
        ) : null}
      </div>
    </>
  );
}
