"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { validateSlug } from "@gitcrook/shared";
import { requireSite } from "@/lib/dashboard/site";

export interface VariantActionState {
  error?: string;
}

const CreateVariantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug is required")
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
});

/** Same default-space assumption as pagesActions.ts's createPage — this app doesn't have section/space management UI yet, so every site's variants live under its one auto-created default space. */
export async function createVariant(orgSlug: string, siteId: string, _prev: VariantActionState, formData: FormData): Promise<VariantActionState> {
  const { site, userId } = await requireSite(orgSlug, siteId);

  const parsed = CreateVariantSchema.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "site", id: site.id });
  if (!allowed) return { error: "You don't have permission to manage this site's variants." };

  const slugCheck = validateSlug(parsed.data.slug);
  if (!slugCheck.ok) return { error: slugCheck.reason };

  const section = await prisma.section.findFirst({ where: { siteId: site.id }, orderBy: { order: "asc" } });
  const space = section && (await prisma.space.findFirst({ where: { sectionId: section.id }, orderBy: { order: "asc" } }));
  if (!space) return { error: "This site has no space to add a variant to." };

  const existing = await prisma.variant.findUnique({ where: { spaceId_slug: { spaceId: space.id, slug: parsed.data.slug } } });
  if (existing) return { error: `"${parsed.data.slug}" is already in use.` };

  const maxOrder = await prisma.variant.aggregate({ where: { spaceId: space.id }, _max: { order: true } });

  await prisma.$transaction(async (tx) => {
    const variant = await tx.variant.create({
      data: { spaceId: space.id, name: parsed.data.name, slug: parsed.data.slug, isDefault: false, order: (maxOrder._max.order ?? -1) + 1 },
    });
    // A starter page so a fresh variant is immediately navigable, mirroring createSite's own starter page.
    await tx.page.create({
      data: {
        variantId: variant.id,
        siteId: site.id,
        title: "Introduction",
        slug: "introduction",
        order: 0,
        content: [{ type: "heading", props: { level: 1 }, content: [{ type: "text", text: `Welcome to ${parsed.data.name}`, styles: {} }] }],
        contentText: `Welcome to ${parsed.data.name}`,
        publishedAt: new Date(),
      },
    });
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/variants`);
  return {};
}
