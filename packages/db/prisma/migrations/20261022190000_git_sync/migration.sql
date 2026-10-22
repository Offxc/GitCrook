-- Git Sync: the tables a repository-backed source needs, and the columns that tie pages and assets to one.
--
-- Prisma's generated diff for this change also tried to drop "Page_searchVector_idx" and the generated
-- searchVector column's default. Those statements are the known false diff (see the warning in
-- schema.prisma) and have been removed by hand; scripts/check-migrations.mjs enforces that.

-- CreateEnum
CREATE TYPE "PageManagedBy" AS ENUM ('EDITOR', 'GIT');

-- CreateEnum
CREATE TYPE "PageVersionOrigin" AS ENUM ('EDITOR', 'GIT', 'RESTORE');

-- CreateEnum
CREATE TYPE "GitProvider" AS ENUM ('GITHUB');

-- CreateEnum
CREATE TYPE "GitSyncStatus" AS ENUM ('IDLE', 'SYNCING', 'ERROR', 'PAUSED');

-- CreateEnum
CREATE TYPE "GitSyncTrigger" AS ENUM ('WEBHOOK', 'POLL', 'MANUAL', 'FULL');

-- CreateEnum
CREATE TYPE "GitSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "sourceBlobSha" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourcePath" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "frontMatterId" TEXT,
ADD COLUMN     "managedBy" "PageManagedBy" NOT NULL DEFAULT 'EDITOR',
ADD COLUMN     "sourceBlobSha" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourcePath" TEXT;

-- AlterTable
ALTER TABLE "PageVersion" ADD COLUMN     "commitSha" TEXT,
ADD COLUMN     "origin" "PageVersionOrigin" NOT NULL DEFAULT 'EDITOR';

-- CreateTable
CREATE TABLE "GitSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'GITHUB',
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "rootDir" TEXT NOT NULL DEFAULT '',
    "credentialId" TEXT,
    "status" "GitSyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncedSha" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "etag" TEXT,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "deleteGraceDays" INTEGER NOT NULL DEFAULT 14,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "installationId" TEXT,
    "secretCiphertext" BYTEA,
    "keyId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitSyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trigger" "GitSyncTrigger" NOT NULL,
    "deliveryId" TEXT,
    "fromSha" TEXT,
    "toSha" TEXT NOT NULL,
    "status" "GitSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stats" JSONB,
    "diagnostics" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitSource_variantId_key" ON "GitSource"("variantId");

-- CreateIndex
CREATE INDEX "GitSource_status_lastCheckedAt_idx" ON "GitSource"("status", "lastCheckedAt");

-- CreateIndex
CREATE INDEX "GitSource_organizationId_idx" ON "GitSource"("organizationId");

-- CreateIndex
CREATE INDEX "GitSource_siteId_idx" ON "GitSource"("siteId");

-- CreateIndex
CREATE INDEX "GitCredential_organizationId_idx" ON "GitCredential"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GitSyncRun_deliveryId_key" ON "GitSyncRun"("deliveryId");

-- CreateIndex
CREATE INDEX "GitSyncRun_sourceId_createdAt_idx" ON "GitSyncRun"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "GitSyncRun_status_createdAt_idx" ON "GitSyncRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sourceId_sourcePath_key" ON "Asset"("sourceId", "sourcePath");

-- CreateIndex
CREATE INDEX "Page_sourceId_frontMatterId_idx" ON "Page"("sourceId", "frontMatterId");

-- CreateIndex
CREATE INDEX "Page_deletedAt_idx" ON "Page"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Page_sourceId_sourcePath_key" ON "Page"("sourceId", "sourcePath");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GitSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GitSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSource" ADD CONSTRAINT "GitSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSource" ADD CONSTRAINT "GitSource_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSource" ADD CONSTRAINT "GitSource_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSource" ADD CONSTRAINT "GitSource_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "GitCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSource" ADD CONSTRAINT "GitSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitCredential" ADD CONSTRAINT "GitCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitCredential" ADD CONSTRAINT "GitCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitSyncRun" ADD CONSTRAINT "GitSyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GitSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A page whose file left the repository is soft-deleted (deletedAt is set) and kept for a grace period. It must
-- not hold its URL while it waits: a new page may take the slug, and reviving the old one (the file comes back)
-- picks a free slug if that happens. So the sibling-slug indexes now cover live pages only.
-- allow-drop-index: "Page_variantId_slug_root_key"
-- allow-drop-index: "Page_variantId_parentId_slug_child_key"
DROP INDEX "Page_variantId_slug_root_key";
DROP INDEX "Page_variantId_parentId_slug_child_key";

CREATE UNIQUE INDEX "Page_variantId_slug_root_key"
  ON "Page" ("variantId", slug)
  WHERE "parentId" IS NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "Page_variantId_parentId_slug_child_key"
  ON "Page" ("variantId", "parentId", slug)
  WHERE "parentId" IS NOT NULL AND "deletedAt" IS NULL;
