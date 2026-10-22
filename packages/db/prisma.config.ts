import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load the repo-root .env regardless of which directory this CLI command is
// invoked from (pnpm runs workspace scripts with that package's dir as cwd).
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

// `prisma generate` (the postinstall hook) only reads the schema and never connects,
// but the config still has to resolve a URL — and on a fresh clone there is no
// .env yet, so `pnpm install` used to fail with PrismaConfigEnvError. Every other
// command (migrate, studio, seed) still requires the real value and says so.
const isGenerate = process.argv.includes("generate");
const GENERATE_ONLY_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: isGenerate ? (process.env.DATABASE_URL ?? GENERATE_ONLY_URL) : env("DATABASE_URL"),
  },
});
