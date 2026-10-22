-- Prisma's diff engine generates a DROP INDEX "Page_searchVector_idx" +
-- ALTER COLUMN "searchVector" DROP DEFAULT on every migration touching any
-- other table — a known false diff against the raw-SQL GENERATED ALWAYS ...
-- STORED column from 20260908023817_page_search_vector, which Unsupported("tsvector")
-- can't fully describe to Prisma. Both are intentionally omitted here, same
-- as the fix in 20260908162739_add_export_job — inspect (--create-only) and
-- strip these two statements on every future migration touching this schema.

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "siteId" TEXT;

-- CreateIndex
CREATE INDEX "Asset_siteId_idx" ON "Asset"("siteId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
