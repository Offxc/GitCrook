-- DropIndex
DROP INDEX "Page_variantId_parentId_slug_key";

-- CreateIndex
CREATE INDEX "Page_variantId_parentId_slug_idx" ON "Page"("variantId", "parentId", "slug");
