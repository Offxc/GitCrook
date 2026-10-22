# Contributing

## Set up

```bash
pnpm install            # also generates the Prisma client; no database needed for this
cp .env.example .env    # fill in AUTH_SECRET at least (openssl rand -base64 32)
pnpm db:deploy && pnpm db:seed
pnpm dev
```

The repository pins its package manager (`packageManager` in `package.json`), so any recent pnpm will
fetch the right one on first use.

## Before you push

```bash
pnpm lint                # ESLint across the workspace; warnings are tolerated, errors are not
pnpm typecheck           # web, worker, and the tests
pnpm test                # unit tests: no database, no network
pnpm check:migrations    # fails if a migration drops an index Prisma can't see
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres pnpm test:integration
```

`test:integration` creates a throwaway database on the server `TEST_DATABASE_URL` points at, applies every
migration to it, runs the suite, and drops it. It never touches your development database.

CI runs the same checks plus a production build, a migrations-and-seed run against an empty database,
`pnpm audit --prod`, and a Docker build of both images.

## Database changes

- Write migrations by hand or with `prisma migrate dev --create-only`, **and read the SQL before applying
  it.** Prisma can't see the search index or the partial unique indexes, so its generated migration will
  try to drop them (`DROP INDEX "Page_searchVector_idx"` and friends). Delete those statements.
  `pnpm check:migrations` catches it if you don't.
- A migration that adds a uniqueness rule must first repair existing data that violates it (see
  `20261022170000_page_slug_uniqueness` for the pattern), because production databases are not empty.

## Tests

Put a unit test next to the code (`foo.test.ts`). Anything that needs Postgres is `foo.int.test.ts`; use the
fixtures in `tests/support/factory.ts` and call `resetDatabase` in `beforeEach`. Prefer testing the rule
(a role matrix, a path round trip, a race) over the implementation.

## Security

Don't put details of an unfixed vulnerability in an issue, pull request, commit message or plan file. Report
it privately (see `SECURITY.md`).
