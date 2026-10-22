import { inject } from "vitest";

// Runs in each test worker before the test file's imports, so @gitcrook/db connects to the
// temporary database from globalSetup rather than whatever DATABASE_URL the shell has.
process.env.DATABASE_URL = inject("databaseUrl");
process.env.AUTH_SECRET ??= "integration-test-secret-integration-0123456789";
process.env.ROOT_DOMAIN ??= "localhost:3000";
process.env.ROOT_PROTOCOL ??= "http";
