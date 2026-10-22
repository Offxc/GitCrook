/**
 * Dumps every table block's row count for a given page, plus its
 * contentVersion and updatedAt-equivalent, so we can see ground truth in the
 * DB immediately after a repro instead of guessing from code. Content-free
 * (only prints row counts, not text), safe to commit.
 *
 * Run:
 *   docker compose run --rm migrate pnpm --filter @gitcrook/db exec tsx prisma/dumpPageTables.ts <pageId>
 */
import { prisma } from "../src/client";

interface Block {
  type?: string;
  content?: { rows?: unknown[] };
  children?: Block[];
}

function findTables(blocks: Block[], path = ""): { path: string; rowCount: number }[] {
  const out: { path: string; rowCount: number }[] = [];
  blocks.forEach((b, i) => {
    const here = `${path}[${i}]`;
    if (b.type === "table" && Array.isArray(b.content?.rows)) {
      out.push({ path: here, rowCount: b.content.rows.length });
    }
    if (Array.isArray(b.children)) out.push(...findTables(b.children, `${here}.children`));
  });
  return out;
}

async function main() {
  const pageId = process.argv[2];
  if (!pageId) throw new Error("Usage: tsx prisma/dumpPageTables.ts <pageId>");

  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true, contentVersion: true, content: true } });
  if (!page) throw new Error(`No page with id "${pageId}"`);

  console.log(`Page "${page.title}" — contentVersion=${page.contentVersion}`);
  const tables = findTables(page.content as Block[]);
  if (tables.length === 0) {
    console.log("No table blocks found on this page.");
  } else {
    for (const t of tables) console.log(`  table at ${t.path}: ${t.rowCount} row(s) (including header row)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
