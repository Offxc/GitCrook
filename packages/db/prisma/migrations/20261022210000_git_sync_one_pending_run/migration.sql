-- At most one waiting sync per source. A burst of pushes (or a webhook delivered twice and a poll in
-- the same minute) all want "bring the site up to the branch head"; one waiting run does that, and the
-- newest request is merged into it. Prisma's schema language cannot describe a partial index, so this
-- one is invisible to `prisma migrate dev` — scripts/check-migrations.mjs fails CI if a migration drops it.
CREATE UNIQUE INDEX "GitSyncRun_one_pending_per_source" ON "GitSyncRun" ("sourceId") WHERE status = 'PENDING';
