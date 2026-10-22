import { prisma } from "@gitcrook/db";
import { freeSlug, slugify } from "@gitcrook/shared";

/** Prisma's unique-constraint violation, matched by code so it works across bundled copies of the client. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Runs `write` with a slug that is free among the page's siblings, and retries with a fresh one when
 * the database says another request took it first. The partial unique indexes on Page are what make
 * the guarantee; the lookup only picks a good candidate.
 *
 * `exceptPageId` excludes the page being renamed from its own siblings, so keeping the slug it
 * already has is not treated as a clash.
 *
 * Contenders for the same title all compute the same next candidate, so each round only one of them
 * wins. A short randomised pause after a loss spreads the rest out; without it a burst of N
 * simultaneous creations needs N rounds.
 */
const MAX_ATTEMPTS = 30;

export async function withFreeSlug<T>(
  scope: { variantId: string; parentId: string | null; exceptPageId?: string },
  title: string,
  write: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const siblings = await prisma.page.findMany({
      where: { variantId: scope.variantId, parentId: scope.parentId, ...(scope.exceptPageId ? { id: { not: scope.exceptPageId } } : {}) },
      select: { slug: true },
    });
    const slug = freeSlug(slugify(title), new Set(siblings.map((s) => s.slug)));
    try {
      return await write(slug);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * (attempt + 1)));
    }
  }
  throw new Error("Could not find a free URL for this page. Try again.");
}
