#!/usr/bin/env node
// Fails when a migration drops an index that Prisma cannot see.
//
// Some indexes here are written by hand because the schema language can't express them: the GIN index
// behind search, and the partial unique indexes. `prisma migrate dev` doesn't know they exist, so on the
// next schema change it generates a DROP INDEX for each. Applied unreviewed, that silently removes search
// or a uniqueness guarantee (it happened once with search and stayed unnoticed for weeks). This check
// reads the migration history and fails if any such index is dropped later on.
//
// A drop can be made deliberate by putting `-- allow-drop-index: "<name>"` in the migration.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** SQL with `--` comments removed, so a commented-out DROP doesn't count. */
const withoutComments = (sql) => sql.replace(/--.*$/gm, "");

/** Index names created with a WHERE or USING clause: the ones Prisma's schema language cannot describe. */
function handWrittenIndexes(sql) {
  const names = [];
  const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"([^;]*);/gi;
  for (const match of withoutComments(sql).matchAll(re)) {
    if (/\bWHERE\b|\bUSING\b/i.test(match[2])) names.push(match[1]);
  }
  return names;
}

/**
 * @param {{ name: string, sql: string }[]} migrations in application order
 * @returns {string[]} human-readable problems
 */
export function checkMigrations(migrations) {
  const problems = [];
  const protectedIndexes = new Set();

  for (const { name, sql } of migrations) {
    const allowed = new Set([...sql.matchAll(/--\s*allow-drop-index:\s*"([^"]+)"/g)].map((m) => m[1]));
    const code = withoutComments(sql);

    for (const match of code.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)) {
      const index = match[1];
      if (protectedIndexes.has(index) && !allowed.has(index)) {
        problems.push(
          `${name}: drops "${index}", an index Prisma can't see. This is almost certainly the false diff from ` +
            `\`prisma migrate dev\`: delete the statement. If the drop is intentional, add  -- allow-drop-index: "${index}"`,
        );
      }
    }
    if (/ALTER\s+COLUMN\s+"searchVector"\s+DROP\s+DEFAULT/i.test(code)) {
      problems.push(`${name}: alters Page.searchVector's default, which is a generated column. Delete the statement (false diff from Prisma).`);
    }

    for (const index of handWrittenIndexes(sql)) protectedIndexes.add(index);
  }
  return problems;
}

export function loadMigrations(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = join(dir, name, "migration.sql");
      if (!existsSync(file)) throw new Error(`${name} has no migration.sql`);
      return { name, sql: readFileSync(file, "utf8") };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL("../packages/db/prisma/migrations", import.meta.url));
  const migrations = loadMigrations(dir);
  const problems = checkMigrations(migrations);
  if (problems.length > 0) {
    console.error(problems.map((p) => `✗ ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(`✓ ${migrations.length} migrations; no hand-written index is dropped.`);
}
