import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const dbPackage = fileURLToPath(new URL("../../packages/db", import.meta.url));

/**
 * Creates a throwaway database on the server named by TEST_DATABASE_URL (any database on it; the role
 * needs CREATE DATABASE), applies every migration to it with the same command production uses, and
 * drops it afterwards. The migrations themselves are therefore under test on every run.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at a Postgres server you can create databases on, e.g.\n" +
        "  TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm test:integration\n" +
        "A temporary database is created and dropped for the run; nothing on the server is modified.",
    );
  }

  const name = `gitcrook_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();

  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: dbPackage,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    const out = (error as { stdout?: Buffer; stderr?: Buffer });
    throw new Error(`prisma migrate deploy failed:\n${out.stdout?.toString() ?? ""}\n${out.stderr?.toString() ?? ""}`);
  }

  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  };
}
