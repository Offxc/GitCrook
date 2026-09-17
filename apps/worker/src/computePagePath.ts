import { prisma } from "@gitcrook/db";

/**
 * Duplicated from apps/web/lib/tenancy/computePagePath.ts rather than shared
 * — it only touches @gitcrook/db (no other web-internal imports), so the
 * copy is small and self-contained; moving it into packages/shared wasn't
 * worth a new cross-package dependency for one function. Keep the two in
 * sync if the URL-resolution rules ever change.
 */
export async function computePagePath(pageId: string): Promise<string[] | null> {
  const pageSlugs: string[] = [];
  let currentId: string | null = pageId;
  let variantId: string | null = null;

  while (currentId) {
    const page: { id: string; parentId: string | null; slug: string; variantId: string } | null = await prisma.page.findUnique({
      where: { id: currentId },
      select: { id: true, parentId: true, slug: true, variantId: true },
    });
    if (!page) return null;
    pageSlugs.unshift(page.slug);
    variantId = page.variantId;
    currentId = page.parentId;
  }
  if (!variantId) return null;

  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    include: { space: { include: { variants: true, section: { include: { spaces: true } } } } },
  });
  if (!variant) return null;

  const segments: string[] = [];
  if (variant.space.section.spaces.length > 1) segments.push(variant.space.slug);
  const section = variant.space.section;
  const siteSections = await prisma.section.count({ where: { siteId: section.siteId } });
  if (siteSections > 1) segments.unshift(section.slug);
  if (!variant.isDefault) segments.push("~v", variant.slug);

  return [...segments, ...pageSlugs];
}
