"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@voiddocs/db";
import { canUserDoX } from "@voiddocs/auth";
import { defaultTheme, validateSlug } from "@voiddocs/shared";
import { requireOrgMembership } from "@/lib/dashboard/org";

const CreateSiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z.string().trim().toLowerCase().min(1, "Slug is required").max(96),
});

export interface CreateSiteState {
  error?: string;
}

export async function createSite(orgSlug: string, _prev: CreateSiteState, formData: FormData): Promise<CreateSiteState> {
  const { organization, userId } = await requireOrgMembership(orgSlug);

  const parsed = CreateSiteSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, slug } = parsed.data;

  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) return { error: slugCheck.reason };

  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "org", id: organization.id });
  if (!allowed) return { error: "You don't have permission to create sites in this organization." };

  const existing = await prisma.site.findUnique({ where: { slug } });
  if (existing) return { error: `"${slug}" is already taken.` };

  // A new site always gets one default Section/Space/Variant to hang pages off
  // of, plus a starter page — mirrors GitBook giving you a starter page in a
  // new space. Sequential creates in a transaction (not one nested `create`)
  // because Page.siteId is intentionally denormalized and needs the Site's
  // real id, which a single nested-write tree can't reference for a plain
  // scalar field.
  const site = await prisma.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: { organizationId: organization.id, name, slug, theme: defaultTheme() },
    });
    const section = await tx.section.create({
      data: { siteId: site.id, title: "Documentation", slug: "docs", order: 0 },
    });
    const space = await tx.space.create({
      data: { sectionId: section.id, title: "Docs", slug: "docs", order: 0 },
    });
    const variant = await tx.variant.create({
      data: { spaceId: space.id, name: "Default", slug: "default", isDefault: true, order: 0 },
    });
    const introText = "This is your first page. Head to the editor to start writing.";
    await tx.page.create({
      data: {
        variantId: variant.id,
        siteId: site.id,
        title: "Introduction",
        slug: "introduction",
        order: 0,
        content: [
          { type: "heading", props: { level: 1 }, content: [{ type: "text", text: `Welcome to ${name}`, styles: {} }] },
          { type: "paragraph", content: [{ type: "text", text: introText, styles: {} }] },
        ],
        contentText: `Welcome to ${name}. ${introText}`,
        publishedAt: new Date(),
      },
    });
    return site;
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorId: userId,
      action: "site.create",
      targetType: "Site",
      targetId: site.id,
    },
  });

  // Without this, the redirect below can land on a stale cached response for
  // a route that's never been rendered before — reproduced directly: the
  // brand-new site's page 404'd immediately after this redirect, then loaded
  // fine on a plain reload of the exact same URL. Every other mutation in
  // this app already revalidates its destination path; this one just missed it.
  revalidatePath(`/dashboard/${orgSlug}/sites`);
  revalidatePath(`/dashboard/${orgSlug}/sites/${site.id}`);
  redirect(`/dashboard/${orgSlug}/sites/${site.id}`);
}
