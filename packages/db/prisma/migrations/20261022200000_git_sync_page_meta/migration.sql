-- Git Sync, second part: what the sync engine needs beyond the first set of tables.
--
--   Page.isHidden    front matter `hidden: true`: published, but not in the sidebar or prev/next.
--   Page.sourceMeta  the parser's reading of a file's front matter and heading, so the navigation can be
--                    rebuilt on every sync without fetching the files that did not change.
--   SiteRedirect.sourceId, .origin  mark a redirect the sync made and why (a moved file, or a
--                    `redirect_from` entry), so it can be added and removed without touching redirects
--                    made by hand.
--
-- The false diff Prisma generates for "Page_searchVector_idx" and the searchVector default has been removed
-- by hand, as in the previous migration.

ALTER TABLE "Page" ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceMeta" JSONB;

ALTER TABLE "SiteRedirect" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "origin" TEXT;

CREATE INDEX "SiteRedirect_sourceId_idx" ON "SiteRedirect"("sourceId");

ALTER TABLE "SiteRedirect" ADD CONSTRAINT "SiteRedirect_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GitSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
