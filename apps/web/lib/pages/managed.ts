import { prisma } from "@gitcrook/db";

/**
 * Pages that a Git repository manages are read-only everywhere else: the next sync would overwrite any change, so
 * letting one through would only lose someone's work later. The editor's UI hides the controls; these checks are
 * what actually holds, because a request can be made without the UI.
 */

export const MANAGED_PAGE_ERROR = "This page is managed by a Git repository. Change the file in the repository, or disconnect the repository in the site's Git settings.";
export const MANAGED_VARIANT_ERROR = "This version of the site is managed by a Git repository, so pages can't be added or changed here. Change the files in the repository, or disconnect it in the site's Git settings.";

/** True if a Git source manages this variant's page tree. */
export async function variantIsManaged(variantId: string): Promise<boolean> {
  return (await prisma.gitSource.count({ where: { variantId } })) > 0;
}

/** True if any of these pages is managed by a repository. */
export async function anyPageIsManaged(pageIds: readonly string[]): Promise<boolean> {
  if (pageIds.length === 0) return false;
  return (await prisma.page.count({ where: { id: { in: [...pageIds] }, OR: [{ managedBy: "GIT" }, { sourceId: { not: null } }] } })) > 0;
}
