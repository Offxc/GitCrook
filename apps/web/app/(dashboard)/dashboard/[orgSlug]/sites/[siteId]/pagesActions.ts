"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { validateSlug } from "@gitcrook/shared";
import { requireSite } from "@/lib/dashboard/site";
import { computePagePath } from "@/lib/tenancy/computePagePath";
import { extractPlainText } from "@/lib/editor/extractText";
import { toJsonSafe } from "@/lib/editor/jsonSafe";

export interface CreatePageState {
  error?: string;
  redirectTo?: string;
  slug?: string;
}

const CreatePageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "page"
  );
}

export async function createPage(orgSlug: string, siteId: string, _prev: CreatePageState, formData: FormData): Promise<CreatePageState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = CreatePageSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const allowed = await canUserDoX(userId, "content.edit", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to add pages to this site." };

  // Every site created via `createSite` gets exactly one Section/Space/Variant
  // in Phase 1/2 — page management UI for additional sections/spaces isn't
  // built yet, so new pages always land in that default variant, at the root
  // of the page tree.
  const section = await prisma.section.findFirst({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  if (!section) return { error: "This site has no section to add pages to." };
  const space = await prisma.space.findFirst({ where: { sectionId: section.id }, orderBy: { order: "asc" } });
  if (!space) return { error: "This site has no space to add pages to." };
  const variant = await prisma.variant.findFirst({ where: { spaceId: space.id, isDefault: true } });
  if (!variant) return { error: "This site has no default variant to add pages to." };

  const baseSlug = slugify(parsed.data.title);
  let slug = baseSlug;
  let suffix = 0;
  while ((await prisma.page.findFirst({ where: { variantId: variant.id, parentId: null, slug } })) || !validateSlug(slug).ok) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const maxOrder = await prisma.page.aggregate({ where: { variantId: variant.id, parentId: null }, _max: { order: true } });

  const page = await prisma.page.create({
    data: {
      variantId: variant.id,
      siteId: site.id,
      title: parsed.data.title,
      slug,
      order: (maxOrder._max.order ?? -1) + 1,
      content: [{ type: "paragraph", content: [] }],
      contentText: "",
      publishedAt: new Date(),
    },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/pages/${page.id}`);
  // See sites/actions.ts's createSite for why this returns a URL for the
  // client to navigate to instead of calling redirect() directly. `slug` is
  // for callers (the live sidebar's AddNewButton) that want the published
  // URL instead of the dashboard editor's.
  return { redirectTo: `/dashboard/${orgSlug}/sites/${siteId}/pages/${page.id}`, slug };
}

const CreatePageGroupSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

export interface CreatePageGroupState {
  error?: string;
  slug?: string;
}

/**
 * GitBook's "page group": title + optional icon, no content, always
 * top-level (matching GitBook's own page groups, which can't nest inside
 * each other — see schema.prisma's isGroup comment). Sidebar.tsx renders
 * it as a plain header, not a link; resolvePublishedPath.ts resolves a
 * direct visit to its own URL through to its first real child instead of
 * trying to render group "content", since there isn't any.
 */
export async function createPageGroup(orgSlug: string, siteId: string, _prev: CreatePageGroupState, formData: FormData): Promise<CreatePageGroupState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = CreatePageGroupSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const allowed = await canUserDoX(userId, "content.edit", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to add groups to this site." };

  const section = await prisma.section.findFirst({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  if (!section) return { error: "This site has no section to add a group to." };
  const space = await prisma.space.findFirst({ where: { sectionId: section.id }, orderBy: { order: "asc" } });
  if (!space) return { error: "This site has no space to add a group to." };
  const variant = await prisma.variant.findFirst({ where: { spaceId: space.id, isDefault: true } });
  if (!variant) return { error: "This site has no default variant to add a group to." };

  const baseSlug = slugify(parsed.data.title);
  let slug = baseSlug;
  let suffix = 0;
  while ((await prisma.page.findFirst({ where: { variantId: variant.id, parentId: null, slug } })) || !validateSlug(slug).ok) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const maxOrder = await prisma.page.aggregate({ where: { variantId: variant.id, parentId: null }, _max: { order: true } });

  await prisma.page.create({
    data: {
      variantId: variant.id,
      siteId: site.id,
      title: parsed.data.title,
      slug,
      isGroup: true,
      order: (maxOrder._max.order ?? -1) + 1,
      content: [],
      contentText: "",
      publishedAt: new Date(),
    },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { slug };
}

const MAX_IMPORT_FILES = 50;
/** Generous for prose, but bounded — this is client-supplied JSON hitting a Json column. */
const MAX_IMPORT_BYTES_PER_PAGE = 1_000_000;

const ImportPagesSchema = z
  .array(
    z.object({
      title: z.string().trim().min(1, "Each file needs a title").max(120),
      blocks: z.array(z.unknown()).min(1),
    }),
  )
  .min(1)
  .max(MAX_IMPORT_FILES, `Up to ${MAX_IMPORT_FILES} files at a time.`);

export interface ImportPagesResult {
  error?: string;
  created?: number;
  /** Slug of the first page created, so the caller can navigate straight to it. */
  firstSlug?: string;
}

/**
 * Creates one page per imported Markdown file, at the root of the tree.
 *
 * The Markdown is parsed into blocks *client-side* by BlockNote's own
 * `tryParseMarkdownToBlocks` (see ImportMarkdownForm) rather than by a
 * parser of our own: that guarantees the stored document is shaped exactly
 * like one the editor itself would produce. Hand-rolling block JSON is how
 * tables ended up with a cell shape the editor never emits, which rendered
 * blank everywhere outside the editor.
 *
 * Blocks arrive as client-supplied JSON, so they're size-capped and
 * normalised here (toJsonSafe) before touching the database — BlockNote
 * emits `undefined` inside arrays, which Prisma's Json column rejects
 * outright.
 */
export async function importMarkdownPages(orgSlug: string, siteId: string, pages: unknown): Promise<ImportPagesResult> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = ImportPagesSchema.safeParse(pages);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const allowed = await canUserDoX(userId, "content.edit", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to add pages to this site." };

  const section = await prisma.section.findFirst({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  if (!section) return { error: "This site has no section to add pages to." };
  const space = await prisma.space.findFirst({ where: { sectionId: section.id }, orderBy: { order: "asc" } });
  if (!space) return { error: "This site has no space to add pages to." };
  const variant = await prisma.variant.findFirst({ where: { spaceId: space.id, isDefault: true } });
  if (!variant) return { error: "This site has no default variant to add pages to." };

  // Load the existing root-level slugs once and dedupe in memory: a
  // per-candidate query (fine for createPage's single page) would also miss
  // collisions *within* this batch, since none of them are committed yet.
  const existing = await prisma.page.findMany({ where: { variantId: variant.id, parentId: null }, select: { slug: true } });
  const taken = new Set(existing.map((p) => p.slug));

  const maxOrder = await prisma.page.aggregate({ where: { variantId: variant.id, parentId: null }, _max: { order: true } });
  let order = (maxOrder._max.order ?? -1) + 1;

  const rows: { title: string; slug: string; content: object; contentText: string; order: number }[] = [];
  for (const page of parsed.data) {
    const content = toJsonSafe(page.blocks);
    if (JSON.stringify(content).length > MAX_IMPORT_BYTES_PER_PAGE) {
      return { error: `"${page.title}" is too large to import.` };
    }

    const baseSlug = slugify(page.title);
    let slug = baseSlug;
    let suffix = 0;
    while (taken.has(slug) || !validateSlug(slug).ok) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    taken.add(slug);

    rows.push({ title: page.title, slug, content: content as object, contentText: extractPlainText(content), order: order++ });
  }

  // All-or-nothing: a half-finished import would leave the tree in a state
  // the person has to hand-unpick, with no record of which files landed.
  await prisma.$transaction(
    rows.map((row) =>
      prisma.page.create({
        data: {
          variantId: variant.id,
          siteId: site.id,
          title: row.title,
          slug: row.slug,
          order: row.order,
          content: row.content,
          contentText: row.contentText,
          publishedAt: new Date(),
        },
      }),
    ),
  );

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { created: rows.length, firstSlug: rows[0]?.slug };
}

const ReorderSchema = z
  .array(
    z.object({
      id: z.string().cuid(),
      parentId: z.string().cuid().nullable(),
      order: z.number().int().min(0).max(100_000),
    }),
  )
  .min(1)
  .max(500);

export interface ReorderResult {
  ok?: boolean;
  error?: string;
  /** New URL path segments for every moved page, keyed by id — a move can change a page's
   * URL (a new parent group, or a different position relative to section/space siblings),
   * so the caller can redirect off a now-stale URL instead of leaving the visitor on a
   * link that 404s the moment they reload it. */
  newPaths?: Record<string, string[]>;
}

/**
 * Applied from the live sidebar's drag-and-drop tree (SidebarTree.tsx) —
 * every row that needs a new order and/or a new parent after a drop,
 * already resolved client-side against the tree it was dragging. Re-checked
 * here rather than trusted, since a client payload can be forged: every id
 * must belong to this site, and no proposed parent may be the page itself
 * or one of its own descendants (which would detach that whole branch from
 * the tree instead of moving it).
 */
export async function reorderPageTree(orgSlug: string, siteId: string, updates: unknown): Promise<ReorderResult> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const allowed = await canUserDoX(userId, "content.edit", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to reorder pages on this site." };

  const parsed = ReorderSchema.safeParse(updates);
  if (!parsed.success) return { error: "Invalid input" };

  const ids = parsed.data.map((u) => u.id);
  const existing = await prisma.page.findMany({ where: { id: { in: ids } }, select: { id: true, siteId: true } });
  if (existing.length !== ids.length || existing.some((p) => p.siteId !== site.id)) {
    return { error: "One of these pages no longer exists." };
  }

  // Overlay the proposed moves onto the site's current parent graph, then
  // confirm the result is still a tree (no page ends up as its own
  // ancestor) before touching the database.
  const allPages = await prisma.page.findMany({ where: { siteId: site.id }, select: { id: true, parentId: true } });
  const parentOf = new Map<string, string | null>(allPages.map((p) => [p.id, p.parentId] as const));
  for (const u of parsed.data) parentOf.set(u.id, u.parentId);

  function isDescendantOf(nodeId: string, maybeAncestorId: string): boolean {
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

  for (const u of parsed.data) {
    if (u.parentId === u.id) return { error: "A page can't be its own parent." };
    if (u.parentId && isDescendantOf(u.parentId, u.id)) return { error: "Can't move a page inside its own subtree." };
  }

  await prisma.$transaction(parsed.data.map((u) => prisma.page.update({ where: { id: u.id }, data: { parentId: u.parentId, order: u.order } })));

  const newPaths: Record<string, string[]> = {};
  for (const u of parsed.data) {
    const path = await computePagePath(u.id);
    if (path) newPaths[u.id] = path;
  }

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { ok: true, newPaths };
}

const RenamePageSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

export interface RenamePageResult {
  ok?: boolean;
  error?: string;
  /** The page's freshly recomputed URL path, since the slug now follows the title —
   * lets a caller viewing this page's old URL redirect to where it lives now. */
  newPath?: string[];
}

/**
 * Renaming updates the slug to match, so the URL always reflects the
 * current title — the trade-off (accepted deliberately, see the user
 * discussion this changed from the original "slug is stable" design) is
 * that a link to the old URL 404s after a rename, same as if the page were
 * deleted and recreated with the new title. Used from the live sidebar's
 * edit-mode tree, primarily for groups: a group has no content of its own
 * to navigate to, so clicking one in edit mode renames it in place instead
 * of linking anywhere.
 */
export async function renamePage(orgSlug: string, siteId: string, pageId: string, title: string): Promise<RenamePageResult> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = RenamePageSchema.safeParse({ title });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { siteId: true, variantId: true, parentId: true, slug: true } });
  if (!page || page.siteId !== site.id) return { error: "Page not found." };

  const allowed = await canUserDoX(userId, "content.edit", { type: "page", id: pageId });
  if (!allowed) return { error: "You don't have permission to rename this page." };

  const baseSlug = slugify(parsed.data.title);
  let slug = baseSlug;
  let suffix = 0;
  while (
    slug !== page.slug &&
    ((await prisma.page.findFirst({ where: { variantId: page.variantId, parentId: page.parentId, slug, id: { not: pageId } } })) || !validateSlug(slug).ok)
  ) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  await prisma.page.update({ where: { id: pageId }, data: { title: parsed.data.title, slug } });
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  const newPath = await computePagePath(pageId);
  return { ok: true, newPath: newPath ?? undefined };
}
