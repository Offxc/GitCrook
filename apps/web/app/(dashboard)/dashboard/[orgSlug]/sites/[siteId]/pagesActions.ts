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
  // client to navigate to instead of calling redirect() directly.
  return { redirectTo: `/dashboard/${orgSlug}/sites/${siteId}/pages/${page.id}` };
}

const CreatePageGroupSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

export interface CreatePageGroupState {
  error?: string;
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
  return {};
}
