"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { validateSlug } from "@voiddocs/shared";
import { requireSite } from "@/lib/dashboard/site";

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

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}`);
  return { ok: true };
}
