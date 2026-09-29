"use client";

import { Fragment, useEffect, useState } from "react";
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
import { useRouter } from "next/navigation";
import type { PageTreeNode } from "@/lib/tenancy/getPageTree";
import { reorderPageTree, renamePage } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pagesActions";
import { updatePageIcon, deletePage, getPageChildCount } from "@/app/(dashboard)/dashboard/[orgSlug]/sites/[siteId]/pages/[pageId]/actions";
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

const ROOT_END_DROPZONE_ID = "__root_end__";
const ROOT_START_DROPZONE_ID = "__root_start__";
const GROUP_DROPZONE_PREFIX = "__group_empty__:";
const groupDropzoneId = (groupId: string) => `${GROUP_DROPZONE_PREFIX}${groupId}`;

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
 * site is in edit mode. Drop rules, anchored on the row you drop ON rather
 * than pixel position within it (simpler to get right, and covers
 * everything the current UI can actually produce — see the reorderPageTree
 * comment for why nesting under a plain page isn't a case that exists yet):
 *   - dragging a group          -> always becomes a root-level sibling of
 *                                  whatever it's dropped on; groups can
 *                                  never nest, not even inside each other
 *   - drop a page on a group    -> nest inside that group, as its last child
 *   - drop on anything else     -> become that row's sibling, inserted before it
 * Two dashed strips appear only while dragging, above and below the list:
 * "move to top level" (drop at the very end of the root) and "move to the
 * top" (drop before whatever's currently first, including a leading group —
 * the only way to land there, since dropping ON a group always means
 * nesting rather than becoming its sibling).
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
  const [deleteState, setDeleteState] = useState<{ id: string; childCount: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const router = useRouter();

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

  async function startDelete(id: string) {
    setDeleteError(null);
    const result = await getPageChildCount(siteId, id);
    if (!result.ok) {
      setDeleteError(result.error ?? "Couldn't check this page.");
      return;
    }
    setDeleteState({ id, childCount: result.childCount ?? 0 });
  }

  async function confirmDelete() {
    if (!deleteState) return;
    const { id } = deleteState;
    setDeletingId(id);
    const wasActive = id === activePageId || isDescendantOf(rows, activePageId, id);
    const result = await deletePage(orgSlug, siteId, id);
    setDeletingId(null);
    setDeleteState(null);
    if (!result.ok) {
      setDeleteError(result.error ?? "Couldn't delete this page.");
      return;
    }
    // deletePage's own redirectTo is the dashboard's page list — right for
    // its original caller there, wrong here, since we're already looking at
    // the site. If the deleted page (or an ancestor of the page you're on)
    // is gone, the current URL 404s next render, so send the visitor to the
    // site root instead; otherwise just drop the row and stay put.
    if (wasActive) {
      window.location.href = baseHref;
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id && !isDescendantOf(prev, r.id, id)));
    router.refresh();
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

    if (over.id === ROOT_END_DROPZONE_ID) {
      if (activeRow.parentId === null) return; // already root; dropping at the end-of-root strip is a no-op unless it's actually moving
      applyMove(activeRow.id, null, rows.filter((r) => r.parentId === null).length);
      return;
    }

    // The one way to land before whatever's currently first at the root —
    // including a group, which the rule below can never target for a
    // sibling-insert (dropping ON a group always means "go inside it").
    // Without this, a brand new group (or a page meant to sit outside every
    // group) had no way to ever get positioned above an existing leading
    // group: dropping on it nested you inside instead of beside it, and
    // there was nothing else above it to drop on.
    if (over.id === ROOT_START_DROPZONE_ID) {
      applyMove(activeRow.id, null, 0);
      return;
    }

    if (typeof over.id === "string" && over.id.startsWith(GROUP_DROPZONE_PREFIX)) {
      const groupId = over.id.slice(GROUP_DROPZONE_PREFIX.length);
      if (activeRow.isGroup || isDescendantOf(rows, groupId, activeRow.id)) return; // groups can't nest; can't drop a group into its own descendant group
      applyMove(activeRow.id, groupId, 0);
      return;
    }

    const overRow = rows.find((r) => r.id === over.id);
    if (!overRow) return;
    if (isDescendantOf(rows, overRow.id, activeRow.id)) return; // can't drop into/beside your own descendant

    // Groups are always top-level (schema invariant), so a dragged group can
    // only ever become a root-level sibling of whatever it's dropped on —
    // never nest inside it. This has to be checked before the "dropped on a
    // group -> nest inside" rule below, which is otherwise unconditional:
    // without this branch, dragging one group onto another tried to nest
    // it, which both makes no sense for a group and is exactly why groups
    // could never be reordered against each other by dropping directly on
    // one another.
    if (activeRow.isGroup) {
      if (overRow.parentId !== null) return; // target isn't root-level either; nothing sensible to do
      const rootSiblings = rows.filter((r) => r.parentId === null && r.id !== activeRow.id);
      const overIndex = rootSiblings.findIndex((r) => r.id === overRow.id);
      applyMove(activeRow.id, null, overIndex === -1 ? rootSiblings.length : overIndex);
      return;
    }

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
      {deleteError ? <p className="mb-2 px-2 text-xs text-site-danger">{deleteError}</p> : null}
      {deleteState ? (
        <div className="mb-2 rounded-md border border-site-danger/40 bg-site-danger/5 px-2.5 py-2 text-xs text-site-ink">
          <p>
            {deleteState.childCount > 0
              ? `Delete this and ${deleteState.childCount} sub-page${deleteState.childCount === 1 ? "" : "s"}?`
              : "Delete this page?"}
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="font-medium text-site-danger hover:underline disabled:opacity-60"
            >
              {deletingId ? "Deleting…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setDeleteState(null)} className="text-site-ink-muted hover:text-site-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <RootDropzone id={ROOT_START_DROPZONE_ID} label="Drop here to move to the top" visible={activeId !== null} />
        <SortableContext items={display.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {display.map((row) => (
              <Fragment key={row.id}>
                <SidebarTreeRow
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
                  onStartDelete={() => startDelete(row.id)}
                />
                {/* An empty group's own row is the only drop target dropping a page
                    "into" it — with closestCenter collision detection that's a thin,
                    fiddly band, worse now that group headers carry extra spacing for
                    visual weight. A dedicated, generously-sized zone right under an
                    empty group's header makes that drop actually easy to land. Not
                    needed once the group has a child: dropping near/on that child
                    already inserts as its new first/last sibling via the normal
                    sortable rows below. */}
                {row.isGroup && activeId !== null && activeId !== row.id && rows.filter((r) => r.parentId === row.id).length === 0 ? (
                  <GroupDropzone groupId={row.id} depth={row.depth} />
                ) : null}
              </Fragment>
            ))}
          </ul>
        </SortableContext>
        <RootDropzone id={ROOT_END_DROPZONE_ID} label="Drop here to move to top level" visible={activeId !== null} />
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
  onStartDelete,
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
  onStartDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Bold, uppercase, and set off by a rule above — a group is a section
  // divider, not another row in the list, and needs to read as one at a
  // glance in edit mode too, not just in the read-only sidebar.
  const liClassName = row.isGroup
    ? `group flex items-center gap-1 rounded-md py-1 pr-1 mt-6 border-t border-site-border pt-5 first:mt-0 first:border-t-0 first:pt-1 ${isDragging ? "opacity-40" : ""}`
    : `group flex items-center gap-1 rounded-md py-1 pr-1 ${isDragging ? "opacity-40" : ""}`;

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
      ) : isRenaming ? (
        <RenameInput title={row.title} onSubmit={onSubmitRename} onCancel={onCancelRename} />
      ) : (
        <Link
          href={href}
          onDoubleClick={(e) => {
            e.preventDefault();
            onStartRename();
          }}
          title="Double-click to rename"
          className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-[13px] leading-5 ${
            isActive ? "font-medium text-site-primary" : "text-site-ink-muted hover:text-site-ink"
          }`}
        >
          <span className="truncate">{row.title}</span>
        </Link>
      )}
      {!isRenaming && !row.isGroup ? (
        // Always visible, not hover-gated: an icon that only appears once
        // you happen to hover the exact row is indistinguishable from "not
        // there" until you already know to look for it.
        <button
          type="button"
          onClick={onStartRename}
          title="Rename page"
          aria-label="Rename page"
          className="shrink-0 rounded p-1 text-site-ink-muted transition hover:bg-site-surface hover:text-site-ink"
        >
          <PencilIcon />
        </button>
      ) : null}
      {!isRenaming ? (
        <button
          type="button"
          onClick={onStartDelete}
          title={row.isGroup ? "Delete group" : "Delete page"}
          aria-label={row.isGroup ? "Delete group" : "Delete page"}
          className="shrink-0 rounded p-1 text-site-ink-muted transition hover:bg-site-surface hover:text-site-danger"
        >
          <TrashIcon />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The page-row equivalent of GroupLabel's inline rename, but simpler: this
 * only ever exists in the DOM while isRenaming is true (SidebarTreeRow swaps
 * it in for the <Link> at that same position), so it mounts fresh on every
 * open and its own `useState(title)` initializer is always current — no
 * resync effect needed the way GroupLabel needs one for its always-mounted
 * wrapper.
 */
function RenameInput({ title, onSubmit, onCancel }: { title: string; onSubmit: (title: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(title);
  return (
    // eslint-disable-next-line jsx-a11y/no-autofocus -- opening rename should focus the input immediately
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(draft);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSubmit(draft)}
      className="min-w-0 flex-1 rounded-md border border-site-primary bg-site-canvas px-1.5 py-0.5 text-[13px] text-site-ink outline-none"
    />
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
    </svg>
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
        className="min-w-0 flex-1 rounded-md border border-site-primary bg-site-canvas px-1.5 py-0.5 text-[13px] font-bold uppercase tracking-wide text-site-ink outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onStartRename}
      title="Rename group"
      className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-[13px] font-bold uppercase tracking-wide text-site-ink hover:text-site-ink"
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

function GroupDropzone({ groupId, depth }: { groupId: string; depth: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: groupDropzoneId(groupId) });
  return (
    <li style={{ paddingLeft: depth * 16 }} className="py-0.5">
      <div
        ref={setNodeRef}
        className={`rounded-md border border-dashed px-2 py-2 text-center text-[11px] ${
          isOver ? "border-site-primary bg-site-primary/10 text-site-primary" : "border-site-border text-site-ink-muted"
        }`}
      >
        Drop here to add to this group
      </div>
    </li>
  );
}

function RootDropzone({ id, label, visible }: { id: string; label: string; visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  if (!visible) return null;
  return (
    <div
      ref={setNodeRef}
      className={`my-2 rounded-md border border-dashed px-2 py-2 text-center text-[11px] ${
        isOver ? "border-site-primary bg-site-primary/10 text-site-primary" : "border-site-border text-site-ink-muted"
      }`}
    >
      {label}
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
