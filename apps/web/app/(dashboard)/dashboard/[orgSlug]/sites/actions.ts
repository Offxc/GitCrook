"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { defaultTheme, validateSlug } from "@gitcrook/shared";
import { requireOrgMembership } from "@/lib/dashboard/org";

const CreateSiteSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z.string().trim().toLowerCase().min(1, "Slug is required").max(96),
});

export interface CreateSiteState {
  error?: string;
  redirectTo?: string;
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

  revalidatePath(`/dashboard/${orgSlug}/sites`);
  revalidatePath(`/dashboard/${orgSlug}/sites/${site.id}`);
  // A server-side redirect() here 404s on first hit and only works on a
  // manual reload — reproduced across three unrelated Server Actions in
  // this app, so it's Next.js's client-side transition after a Server
  // Action that's unreliable here, not this route specifically. Returning
  // the URL and letting the client do a real navigation (see
  // CreateSiteForm's useEffect) sidesteps that transition entirely.
  return { redirectTo: `/dashboard/${orgSlug}/sites/${site.id}` };
}

export interface DeleteSiteResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

/**
 * Every child row (Section/Space/Variant/Page/CustomDomain/SitePassword/
 * ShareLink/SiteRedirect/*Permission/AnalyticsEvent/PageRating/Comment/...)
 * is onDelete: Cascade back to Site in schema.prisma, so a single delete
 * here is a complete, atomic cleanup — no manual multi-table teardown needed.
 * Asset.siteId is the one exception (onDelete: SetNull, deliberately —
 * uploaded files outlive the site as unrestricted-access assets rather than
 * being force-deleted).
 */
export async function deleteSite(orgSlug: string, siteId: string, confirmSlug: string): Promise<DeleteSiteResult> {
  const { organization, userId } = await requireOrgMembership(orgSlug);

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { slug: true, name: true, organizationId: true } });
  if (!site || site.organizationId !== organization.id) return { ok: false, error: "Site not found." };
  if (confirmSlug !== site.slug) return { ok: false, error: "That doesn't match the site's slug." };

  const allowed = await canUserDoX(userId, "content.manageSpaces", { type: "org", id: organization.id });
  if (!allowed) return { ok: false, error: "You don't have permission to delete this site." };

  // Logged before the delete, not after — nothing to attach targetId to
  // once the row is gone, and an audit trail for "someone deleted this"
  // matters more than it surviving a crash between the two statements.
  await prisma.auditLog.create({
    data: { organizationId: organization.id, actorId: userId, action: "site.delete", targetType: "Site", targetId: siteId, metadata: { name: site.name, slug: site.slug } },
  });
  await prisma.site.delete({ where: { id: siteId } });

  revalidatePath(`/dashboard/${orgSlug}/sites`);
  return { ok: true, redirectTo: `/dashboard/${orgSlug}/sites` };
}
