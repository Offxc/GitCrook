import { prisma } from "@gitcrook/db";

export interface CommitPageContentInput {
  pageId: string;
  /** The version the caller last saw; the write only happens if the page is still at it. */
  expectedVersion: number;
  content: object;
  contentText: string;
  userId: string;
  /** Whether to keep the replaced content as a history checkpoint. */
  snapshot: boolean;
}

/**
 * Writes a page's content only if it is still at `expectedVersion`, and returns
 * the new version — or null when the page changed (or vanished) in the meantime.
 *
 * Compare-and-set rather than read-then-write: two saves that both read the same
 * version would each pass a separate check and the later write would silently
 * win. Here the write itself is conditional, so whichever save commits second
 * matches nothing and the caller reports a conflict instead of overwriting.
 */
export async function commitPageContent(input: CommitPageContentInput): Promise<number | null> {
  const { pageId, expectedVersion, content, contentText, userId, snapshot } = input;

  return prisma.$transaction(async (tx) => {
    const before = await tx.page.findUnique({ where: { id: pageId }, select: { content: true } });
    if (!before) return null;

    const claimed = await tx.page.updateMany({
      where: { id: pageId, contentVersion: expectedVersion },
      data: { content, contentText, contentVersion: { increment: 1 } },
    });
    if (claimed.count === 0) return null;

    // The update only matched because the version was still `expectedVersion`, so
    // `before` (read in this transaction; versions only ever increase) is exactly
    // the content that was just replaced.
    if (snapshot) {
      await tx.pageVersion.create({ data: { pageId, content: before.content as object, version: expectedVersion, createdById: userId } });
    }
    return expectedVersion + 1;
  });
}
