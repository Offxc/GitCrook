import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load the repo-root .env regardless of which directory this CLI command is
// invoked from (pnpm runs workspace scripts with that package's dir as cwd).
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
