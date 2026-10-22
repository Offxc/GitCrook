/**
 * Deletes a single page/group by id. Content-free, safe to commit.
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/deletePageById.ts <pageId>
 */
import { prisma } from "../src/client";

async function main() {
  const pageId = process.argv[2];
  if (!pageId) throw new Error("Usage: tsx prisma/deletePageById.ts <pageId>");

  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new Error(`No page with id "${pageId}"`);

  const childCount = await prisma.page.count({ where: { parentId: pageId } });
  console.log(`Deleting "${page.title}" (${page.id}) slug=${page.slug} isGroup=${page.isGroup} — ${childCount} child page(s) will cascade-delete with it.`);

  await prisma.page.delete({ where: { id: pageId } });
  console.log("Deleted.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
