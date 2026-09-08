/**
 * Local-only convenience: runs a real PostgreSQL server via the `embedded-postgres`
 * package (downloads a real `postgres` binary as an npm dependency, no Docker/root/
 * system package manager needed) so this app can be developed and tested end-to-end
 * on a machine that doesn't have Docker or Postgres installed.
 *
 * Production NEVER imports this file — the Docker Compose stack runs a real
 * `postgres` container instead (see /docker-compose.yml). This script is invoked
 * standalone: `pnpm --filter @voiddocs/db dev:pg`.
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(here, "../.pgdata");
const PORT = 55432;
const USER = "voiddocs";
const PASSWORD = "voiddocs_dev";
const DB_NAME = "voiddocs";

async function main() {
  const alreadyInitialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (!alreadyInitialised) {
    console.log("[dev-pg] initialising a new local Postgres cluster...");
    await pg.initialise();
  }

  await pg.start();
  console.log(`[dev-pg] listening on 127.0.0.1:${PORT}`);

  if (!alreadyInitialised) {
    await pg.createDatabase(DB_NAME);
    console.log(`[dev-pg] created database "${DB_NAME}"`);
  }

  console.log(`[dev-pg] DATABASE_URL=postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`);
  console.log("[dev-pg] ready — leave this running while you develop. Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("\n[dev-pg] stopping...");
    await pg.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[dev-pg] failed to start:", err);
  process.exit(1);
});
