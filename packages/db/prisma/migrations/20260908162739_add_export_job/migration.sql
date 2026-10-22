-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- The DROP INDEX / ALTER COLUMN ... DROP DEFAULT that Prisma generated here
-- for "Page"."searchVector" are a false diff: that column is a raw-SQL
-- GENERATED ALWAYS AS ... STORED column (see the search-vector migration),
-- which Prisma's schema.prisma Unsupported("tsvector")? type can't fully
-- describe, so its diff engine thinks it drifted. Applying either statement
-- would either hurt search (drop the index) or fail outright (a generated
-- column has no "default" to drop) — intentionally omitted.

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "resultAssetId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_status_createdAt_idx" ON "ExportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ExportJob_pageId_idx" ON "ExportJob"("pageId");

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_resultAssetId_fkey" FOREIGN KEY ("resultAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
