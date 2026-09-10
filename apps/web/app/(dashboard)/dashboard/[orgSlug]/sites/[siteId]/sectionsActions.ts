"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { validateSlug } from "@voiddocs/shared";
import { requireSite } from "@/lib/dashboard/site";

/**
 * Sections are GitBook's top-level split of a site — the row of tabs above
 * the sidebar ("Documentation | Developers | Resources" on their own docs).
 * The model has been here since Phase 1 and the published router already
 * resolves them; this is the management surface that was missing, without
 * which every site was stuck on the single section createSite seeds.
 */

const TitleSchema = z.object({ title: z.string().trim().min(1, "Title is required").max(80) });

export interface SectionActionState {
  error?: string;
  ok?: boolean;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "section"
  );
}

export async function createSection(orgSlug: string, siteId: string, _prev: SectionActionState, formData: FormData): Promise<SectionActionState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = TitleSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Creating a section creates content containers, not just settings — same
  // permission the space/section-management actions use.
  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to add sections to this site." };

  const base = slugify(parsed.data.title);
  let slug = base;
  let suffix = 0;
  while ((await prisma.section.findFirst({ where: { siteId: site.id, slug } })) || !validateSlug(slug).ok) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  const maxOrder = await prisma.section.aggregate({ where: { siteId: site.id }, _max: { order: true } });

  // Mirrors createSite's seeding: a section needs a space/variant beneath it
  // before any page can hang off it, and an empty section would resolve to
  // nothing on the published site.
  await prisma.$transaction(async (tx) => {
    const section = await tx.section.create({
      data: { siteId: site.id, title: parsed.data.title, slug, order: (maxOrder._max.order ?? -1) + 1 },
    });
    const space = await tx.space.create({ data: { sectionId: section.id, title: parsed.data.title, slug, order: 0 } });
    const variant = await tx.variant.create({ data: { spaceId: space.id, name: "Default", slug: "default", isDefault: true, order: 0 } });
    await tx.page.create({
      data: {
        variantId: variant.id,
        siteId: site.id,
        title: "Overview",
        slug: "overview",
        order: 0,
        content: [{ type: "heading", props: { level: 1 }, content: [{ type: "text", text: parsed.data.title, styles: {} }] }],
        contentText: parsed.data.title,
        publishedAt: new Date(),
      },
    });
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/sections`);
  return { ok: true };
}

export async function renameSection(orgSlug: string, siteId: string, sectionId: string, title: string): Promise<SectionActionState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = TitleSchema.safeParse({ title });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to rename sections on this site." };

  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { siteId: true } });
  if (!section || section.siteId !== site.id) return { error: "Section not found." };

  // Title only — the slug is this section's URL segment, so renaming
  // shouldn't silently break links to it.
  await prisma.section.update({ where: { id: sectionId }, data: { title: parsed.data.title } });
  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/sections`);
  return { ok: true };
}

export async function deleteSection(orgSlug: string, siteId: string, sectionId: string): Promise<SectionActionState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to delete sections from this site." };

  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { siteId: true } });
  if (!section || section.siteId !== site.id) return { error: "Section not found." };

  // A site with no sections has nothing to resolve a published URL against,
  // so the last one can't be removed.
  const count = await prisma.section.count({ where: { siteId: site.id } });
  if (count <= 1) return { error: "A site needs at least one section." };

  // Space -> Variant -> Page all cascade from Section (see schema.prisma), so
  // this removes the section's whole subtree of content.
  await prisma.section.delete({ where: { id: sectionId } });

  await prisma.auditLog.create({
    data: { organizationId: site.organizationId, actorId: userId, action: "section.delete", targetType: "Section", targetId: sectionId },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/sections`);
  return { ok: true };
}
