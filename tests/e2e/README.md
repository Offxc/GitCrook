# End-to-end tests

These drive a real Chromium against a **running production build** and the database it uses. They cover
what unit and integration tests can't: that the reader shell really stays mounted while you navigate,
that cookies and redirects behave in a browser, and that custom domains work end to end.

```bash
pnpm build
# serve it (standalone output) with DATABASE_URL pointing at a migrated database:
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
DATABASE_URL=... AUTH_SECRET=... ROOT_DOMAIN=localhost:3000 PORT=3000 HOSTNAME=127.0.0.1 \
  node apps/web/.next/standalone/apps/web/server.js &

DATABASE_URL=... E2E_BASE_URL=http://localhost:3000 pnpm test:e2e
```

The tests create their own organisations, users and sites in that database (and delete them afterwards),
so point it at a scratch database, not one with data you care about.

Chromium comes from Playwright's own browser cache. In CI it is installed with
`pnpm exec playwright-core install --with-deps chromium`; locally set `PLAYWRIGHT_BROWSERS_PATH`
or `E2E_CHROMIUM_PATH` to an existing build.
