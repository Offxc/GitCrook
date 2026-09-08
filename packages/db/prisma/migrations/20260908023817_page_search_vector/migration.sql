-- Generated (STORED) column: Postgres recomputes this automatically on every
-- INSERT/UPDATE, so search never falls out of sync with the title/contentText
-- it derives from. Title is weighted 'A' (highest) so a title match ranks
-- above a body-text match of the same term.
ALTER TABLE "Page" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("contentText", '')), 'B')
  ) STORED;

CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
