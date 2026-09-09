"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import { reorderPageTree, renamePage } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pagesActions";
import { updatePageIcon } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pages/[pageId]/actions";
import { PageIcon } from "./PageIcon";
import { IconPickerPopover } from "./IconPickerPopover";

interface Row {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  slug: string;
  icon: string | null;
  isGroup: boolean;
}

const ROOT_DROPZONE_ID = "__root__";

function flatten(tree: PageTreeNode[], parentId: string | null = null): Row[] {
  const out: Row[] = [];
  tree.forEach((node, i) => {
    out.push({ id: node.id, parentId, order: i, title: node.title, slug: node.slug, icon: node.icon, isGroup: node.isGroup });
    out.push(...flatten(node.children, node.id));
  });
  return out;
}

/** Depth-first display order, each row's siblings sorted by `order` — recomputed after every drop instead of tracked as array position, so the drop logic only ever has to reason about a row's (parentId, order), never its index in some flat list. */
function displayList(rows: Row[]): (Row & { depth: number })[] {
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const out: (Row & { depth: number })[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const r of byParent.get(parentId) ?? []) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

function isDescendantOf(rows: Row[], nodeId: string, maybeAncestorId: string): boolean {
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId] as const));
  const seen = new Set<string>();
  let current = parentOf.get(nodeId) ?? null;
  while (current) {
    if (current === maybeAncestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Editable stand-in for SidebarList, swapped in by SidebarBody while the
 * site is in edit mode. Two drop rules, both anchored on the row you drop
 * ON rather than pixel position within it (simpler to get right, and covers
 * everything the current UI can actually produce — see the reorderPageTree
 * comment for why nesting under a plain page isn't a case that exists yet):
 *   - drop on a group's header  -> nest inside that group, as its last child
 *   - drop on anything else     -> become that row's sibling, inserted before it
 * A "move to top level" strip appears at the bottom only while dragging, for
 * the case where there's no root-level row to drop beside (e.g. an
 * otherwise-empty root, or wanting to append at the very end).
 */
export function SidebarTree({
  tree,
  baseHref,
  paths,
  activePageId,
  orgSlug,
  siteId,
}: {
  tree: PageTreeNode[];
  baseHref: string;
  paths: Map<string, string[]>;
  activePageId: string;
  orgSlug: string;
  siteId: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => flatten(tree));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [iconPickerRowId, setIconPickerRowId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    setRows(flatten(tree));
  }, [tree]);

  async function submitRename(id: string, title: string) {
    setRenamingId(null);
    const trimmed = title.trim();
    const previous = rows.find((r) => r.id === id);
    if (!trimmed || trimmed === previous?.title) return;
    const previousRows = rows;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, title: trimmed } : r)));
    const result = await renamePage(orgSlug, siteId, id, trimmed);
    if (result.error) {
      setRows(previousRows);
      setRenameError(result.error);
    }
  }

  async function chooseIcon(id: string, icon: string | null) {
    setIconPickerRowId(null);
    const previousRows = rows;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, icon } : r)));
    const result = await updatePageIcon(orgSlug, siteId, id, icon);
    if (!result.ok) {
      setRows(previousRows);
      setRenameError(result.error ?? "Couldn't update icon.");
    }
  }

  async function persist(updates: { id: string; parentId: string | null; order: number }[], previousRows: Row[]) {
    setStatus("saving");
    const result = await reorderPageTree(orgSlug, siteId, updates);
    if (result.error) {
      setRows(previousRows);
      setStatus("error");
      return;
    }
    setStatus("idle");
  }

  function applyMove(activeRowId: string, targetParentId: string | null, insertAt: number) {
    const previousRows = rows;
    const siblings = rows.filter((r) => r.parentId === targetParentId && r.id !== activeRowId);
    const activeRow = rows.find((r) => r.id === activeRowId);
    if (!activeRow) return;
    siblings.splice(Math.max(0, Math.min(insertAt, siblings.length)), 0, activeRow);

    const updates = siblings.map((r, i) => ({ id: r.id, parentId: targetParentId, order: i }));
    const updateById = new Map(updates.map((u) => [u.id, u] as const));
    setRows((prev) => prev.map((r) => (updateById.has(r.id) ? { ...r, ...updateById.get(r.id)! } : r)));
    void persist(updates, previousRows);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeRow = rows.find((r) => r.id === active.id);
    if (!activeRow) return;

    if (over.id === ROOT_DROPZONE_ID) {
      if (activeRow.parentId === null) return; // already root; dropping at the end-of-root strip is a no-op unless it's actually moving
      applyMove(activeRow.id, null, rows.filter((r) => r.parentId === null).length);
      return;
    }

    const overRow = rows.find((r) => r.id === over.id);
    if (!overRow) return;
    if (isDescendantOf(rows, overRow.id, activeRow.id)) return; // can't drop into/beside your own descendant

    // Groups are always top-level (schema invariant) — only allow reordering
    // them among other root-level rows, never nesting them under anything.
    if (activeRow.isGroup && overRow.parentId !== null) return;

    if (overRow.isGroup) {
      const childCount = rows.filter((r) => r.parentId === overRow.id).length;
      applyMove(activeRow.id, overRow.id, childCount);
      return;
    }

    const targetSiblings = rows.filter((r) => r.parentId === overRow.parentId && r.id !== activeRow.id);
    const overIndex = targetSiblings.findIndex((r) => r.id === overRow.id);
    applyMove(activeRow.id, overRow.parentId, overIndex === -1 ? targetSiblings.length : overIndex);
  }

  const display = displayList(rows);

  return (
    <div>
      {status === "error" ? <p className="mb-2 px-2 text-xs text-site-danger">Couldn&apos;t save that change — try again.</p> : null}
      {renameError ? <p className="mb-2 px-2 text-xs text-site-danger">{renameError}</p> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={display.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {display.map((row) => (
              <SidebarTreeRow
                key={row.id}
                row={row}
                href={`${baseHref}/${(paths.get(row.id) ?? [row.slug]).join("/")}`}
                isActive={row.id === activePageId}
                isRenaming={renamingId === row.id}
                onStartRename={() => setRenamingId(row.id)}
                onSubmitRename={(title) => submitRename(row.id, title)}
                onCancelRename={() => setRenamingId(null)}
                isPickingIcon={iconPickerRowId === row.id}
                onStartPickIcon={() => setIconPickerRowId(row.id)}
                onCancelPickIcon={() => setIconPickerRowId(null)}
                onPickIcon={(icon) => chooseIcon(row.id, icon)}
              />
            ))}
          </ul>
        </SortableContext>
        <RootDropzone visible={activeId !== null} />
      </DndContext>
      {status === "saving" ? <p className="mt-2 px-2 text-xs text-site-ink-muted">Saving order…</p> : null}
    </div>
  );
}

function SidebarTreeRow({
  row,
  href,
  isActive,
  isRenaming,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  isPickingIcon,
  onStartPickIcon,
  onCancelPickIcon,
  onPickIcon,
}: {
  row: Row & { depth: number };
  href: string;
  isActive: boolean;
  isRenaming: boolean;
  onStartRename: () => void;
  onSubmitRename: (title: string) => void;
  onCancelRename: () => void;
  isPickingIcon: boolean;
  onStartPickIcon: () => void;
  onCancelPickIcon: () => void;
  onPickIcon: (icon: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Bold, uppercase, and set off by a rule above — a group is a section
  // divider, not another row in the list, and needs to read as one at a
  // glance in edit mode too, not just in the read-only sidebar.
  const liClassName = row.isGroup
    ? `flex items-center gap-1 rounded-md py-1 pr-1 mt-5 border-t border-site-border pt-4 first:mt-0 first:border-t-0 first:pt-1 ${isDragging ? "opacity-40" : ""}`
    : `flex items-center gap-1 rounded-md py-1 pr-1 ${isDragging ? "opacity-40" : ""}`;

  return (
    <li ref={setNodeRef} style={{ ...style, paddingLeft: row.depth * 16 }} className={liClassName}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none rounded p-1 text-site-ink-muted hover:bg-site-surface hover:text-site-ink active:cursor-grabbing"
        aria-label={`Reorder ${row.title}`}
      >
        <GripIcon />
      </button>
      <RowIconButton icon={row.icon} isPicking={isPickingIcon} onStart={onStartPickIcon} onCancel={onCancelPickIcon} onPick={onPickIcon} />
      {row.isGroup ? (
        <GroupLabel row={row} isRenaming={isRenaming} onStartRename={onStartRename} onSubmitRename={onSubmitRename} onCancelRename={onCancelRename} />
      ) : (
        <Link
          href={href}
          className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-[13px] leading-5 ${
            isActive ? "font-medium text-site-primary" : "text-site-ink-muted hover:text-site-ink"
          }`}
        >
          <span className="truncate">{row.title}</span>
        </Link>
      )}
    </li>
  );
}

function RowIconButton({
  icon,
  isPicking,
  onStart,
  onCancel,
  onPick,
}: {
  icon: string | null;
  isPicking: boolean;
  onStart: () => void;
  onCancel: () => void;
  onPick: (icon: string | null) => void;
}) {
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={onStart}
        title={icon ? "Change icon" : "Add icon"}
        className="flex h-6 w-6 items-center justify-center rounded text-site-ink-muted hover:bg-site-surface hover:text-site-ink"
      >
        {icon ? <PageIcon icon={icon} className="h-4 w-4" /> : <PlaceholderIcon />}
      </button>
      {isPicking ? <IconPickerPopover onSelect={onPick} onClose={onCancel} canRemove={icon !== null} onRemove={() => onPick(null)} /> : null}
    </span>
  );
}

/**
 * A group has no content of its own — SidebarList's read-only view already
 * renders it as a plain (non-link) header rather than a page-like link; this
 * is the edit-mode equivalent, distinct the same way, except clicking it
 * renames it in place instead of just displaying it (a group has no other
 * settings screen to jump to for that).
 */
function GroupLabel({
  row,
  isRenaming,
  onStartRename,
  onSubmitRename,
  onCancelRename,
}: {
  row: Row;
  isRenaming: boolean;
  onStartRename: () => void;
  onSubmitRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const [draft, setDraft] = useState(row.title);

  // Resync on every open, not just at first mount — GroupLabel stays mounted
  // across renames (only `isRenaming` toggles), so without this a second
  // rename would start from whatever the title was the first time this row
  // ever rendered, not the current one.
  useEffect(() => {
    if (isRenaming) setDraft(row.title);
  }, [isRenaming, row.title]);

  if (isRenaming) {
    return (
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opening rename should focus the input immediately
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmitRename(draft);
          if (e.key === "Escape") onCancelRename();
        }}
        onBlur={() => onSubmitRename(draft)}
        className="min-w-0 flex-1 rounded-md border border-site-primary bg-site-canvas px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-site-ink outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onStartRename}
      title="Rename group"
      className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs font-bold uppercase tracking-wider text-site-ink-muted hover:text-site-ink"
    >
      <span className="truncate">{row.title}</span>
    </button>
  );
}

function PlaceholderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

function RootDropzone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROPZONE_ID });
  if (!visible) return null;
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 rounded-md border border-dashed px-2 py-2 text-center text-[11px] ${
        isOver ? "border-site-primary bg-site-primary/10 text-site-primary" : "border-site-border text-site-ink-muted"
      }`}
    >
      Drop here to move to top level
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="5" cy="3" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="5" cy="13" r="1.2" />
      <circle cx="11" cy="3" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="11" cy="13" r="1.2" />
    </svg>
  );
}
