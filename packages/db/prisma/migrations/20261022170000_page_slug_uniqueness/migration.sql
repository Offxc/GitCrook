-- Sibling pages must have distinct slugs, or two pages share a URL and one is unreachable.
--
-- This was only enforced by an application-level "is it taken?" lookup, so two requests racing
-- on the same title could both pass it (D2 in PLAN.md). A plain @@unique on (variantId, parentId,
-- slug) can't express it because parentId is nullable and Postgres treats NULLs as distinct, so
-- top-level pages would never conflict. Two partial unique indexes cover both cases.
--
-- Prisma's schema language can't describe partial indexes, so they are invisible to
-- `prisma migrate dev`: it will try to drop them on its next run, as it does for
-- "Page_searchVector_idx". Run it with --create-only and delete any DROP INDEX statements for
-- these. scripts/check-migrations.mjs fails CI if a migration drops one.

-- Existing duplicates would make the indexes fail to build. Keep the oldest page of each clashing
-- set on its slug and give the rest a short unique tail. Their URLs were already ambiguous (the
-- reader resolved to whichever row Postgres returned first), so nothing that worked is lost.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY "variantId", "parentId", slug ORDER BY "createdAt", id) AS rn
  FROM "Page"
)
UPDATE "Page" p
SET slug = left(p.slug, 88) || '-' || right(p.id, 6)
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "Page_variantId_slug_root_key"
  ON "Page" ("variantId", slug)
  WHERE "parentId" IS NULL;

CREATE UNIQUE INDEX "Page_variantId_parentId_slug_child_key"
  ON "Page" ("variantId", "parentId", slug)
  WHERE "parentId" IS NOT NULL;
