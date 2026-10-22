import { describe, expect, it } from "vitest";
import { checkMigrations, loadMigrations } from "./check-migrations.mjs";
import { fileURLToPath } from "node:url";

const m = (name, sql) => ({ name, sql });

describe("checkMigrations", () => {
  it("passes a history that never drops a hand-written index", () => {
    expect(
      checkMigrations([
        m("1", 'CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");'),
        m("2", 'CREATE INDEX "Other_idx" ON "Other"("x");\nDROP INDEX "Other_idx";'),
      ]),
    ).toEqual([]);
  });

  it("flags dropping a GIN index created earlier", () => {
    const problems = checkMigrations([
      m("1", 'CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");'),
      m("2", 'DROP INDEX "Page_searchVector_idx";'),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Page_searchVector_idx");
  });

  it("flags dropping a partial unique index", () => {
    const problems = checkMigrations([
      m("1", 'CREATE UNIQUE INDEX "A_key" ON "A"("x") WHERE "y" IS NULL;'),
      m("2", 'DROP INDEX IF EXISTS "A_key";'),
    ]);
    expect(problems).toHaveLength(1);
  });

  it("allows a drop that is declared deliberate", () => {
    expect(
      checkMigrations([
        m("1", 'CREATE UNIQUE INDEX "A_key" ON "A"("x") WHERE "y" IS NULL;'),
        m("2", '-- allow-drop-index: "A_key"\nDROP INDEX "A_key";'),
      ]),
    ).toEqual([]);
  });

  it("ignores a DROP that only appears in a comment", () => {
    expect(
      checkMigrations([
        m("1", 'CREATE INDEX "I" ON "T" USING GIN ("c");'),
        m("2", '-- Prisma generated: DROP INDEX "I";\nSELECT 1;'),
      ]),
    ).toEqual([]);
  });

  it("does not complain about dropping an index before it was hand-written", () => {
    expect(checkMigrations([m("1", 'DROP INDEX "A_key";'), m("2", 'CREATE UNIQUE INDEX "A_key" ON "A"("x") WHERE "y";')])).toEqual([]);
  });

  it("flags a change to the generated searchVector column", () => {
    expect(checkMigrations([m("1", 'ALTER TABLE "Page" ALTER COLUMN "searchVector" DROP DEFAULT;')])).toHaveLength(1);
  });

  it("accepts this repository's real migration history", () => {
    const dir = fileURLToPath(new URL("../packages/db/prisma/migrations", import.meta.url));
    expect(checkMigrations(loadMigrations(dir))).toEqual([]);
  });
});
