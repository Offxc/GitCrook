"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@gitcrook/db";
import { canUserDoX } from "@gitcrook/auth";
import { ThemeConfigSchema } from "@gitcrook/shared";
import { requireSite } from "@/lib/dashboard/site";

export interface ThemeActionState {
  error?: string;
}

const FIELD_LABELS: Record<string, string> = {
  "socials.x": "X link",
  "socials.github": "GitHub link",
  "socials.linkedin": "LinkedIn link",
  "socials.discord": "Discord link",
  "socials.bluesky": "Bluesky link",
  primaryLinkHref: "Primary link override",
  privacyPolicyHref: "Privacy policy link",
  "announcement.ctaHref": "Announcement CTA link",
  "announcement.ctaLabel": "Announcement CTA label",
  "announcement.message": "Announcement message",
};

/** Turns a zod issue path like ["header","links",0,"href"] into "Nav link #1" for a message a form-filler can actually act on. */
function describeThemeFieldPath(path: readonly PropertyKey[]): string | null {
  const key = path.filter((p) => typeof p === "string").join(".");
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (path[0] === "header" && path[1] === "links" && typeof path[2] === "number") {
    return `Nav link #${path[2] + 1}${path[3] === "href" ? "" : ` (${String(path[3])})`}`;
  }
  if (path[0] === "footer" && path[1] === "columns") {
    return "Footer link";
  }
  return path.length > 0 ? path.join(".") : null;
}

/**
 * The form (ThemeForm.tsx) keeps one ThemeConfig-shaped object in client
 * state and serializes it whole into a hidden field on submit — dozens of
 * individually-named FormData fields (many nested/array) would need as much
 * bespoke parsing here as the schema already does in one shot via
 * safeParse; this keeps the two in lockstep for free.
 */
export async function updateTheme(orgSlug: string, siteId: string, _prev: ThemeActionState, formData: FormData): Promise<ThemeActionState> {
  const ctx = await requireSite(orgSlug, siteId);
  const allowed = await canUserDoX(ctx.userId, "site.manageSettings", { type: "site", id: ctx.site.id });
  if (!allowed) return { error: "You don't have permission to manage this site's theme." };

  const raw = formData.get("themeJson");
  if (typeof raw !== "string") return { error: "Missing theme data." };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { error: "Malformed theme data." };
  }

  const parsed = ThemeConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return { error: "Invalid theme configuration." };
    const field = describeThemeFieldPath(issue.path);
    return { error: field ? `${field}: ${issue.message}` : issue.message };
  }

  await prisma.site.update({ where: { id: ctx.site.id }, data: { theme: parsed.data } });

  await prisma.auditLog.create({
    data: { organizationId: ctx.organization.id, actorId: ctx.userId, action: "site.updateTheme", targetType: "Site", targetId: ctx.site.id },
  });

  revalidatePath(`/dashboard/${orgSlug}/sites/${siteId}/theme`);
  revalidatePath(`/${ctx.site.slug}`, "layout");
  return {};
}
