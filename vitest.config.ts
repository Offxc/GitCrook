import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webRoot = fileURLToPath(new URL("./apps/web", import.meta.url));
const pkg = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

// Two projects so the fast, dependency-free suite can run anywhere and the database-backed one is
// opt-in with a clear failure instead of a silent skip:
//   pnpm test               unit tests — no database, no network
//   pnpm test:integration   needs TEST_DATABASE_URL (see tests/support/globalSetup.ts)
//   pnpm test:e2e           needs a running app and its database (see tests/e2e/README.md)
export default defineConfig({
  // tsconfig says jsx: "preserve" for Next; tests need it compiled.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      // Workspace packages by source, so tests under tests/ (which have no node_modules link to them)
      // and tests inside packages resolve the same files. More specific subpaths come first.
      { find: /^@gitcrook\/shared\/server$/, replacement: pkg("shared/src/server.ts") },
      { find: /^@gitcrook\/shared$/, replacement: pkg("shared/src/index.ts") },
      { find: /^@gitcrook\/db$/, replacement: pkg("db/src/index.ts") },
      { find: /^@gitcrook\/markdown$/, replacement: pkg("markdown/src/index.ts") },
      { find: /^@gitcrook\/git-sync\/pure$/, replacement: pkg("git-sync/src/pure.ts") },
      { find: /^@gitcrook\/git-sync$/, replacement: pkg("git-sync/src/index.ts") },
      { find: /^@gitcrook\/assets$/, replacement: pkg("assets/src/index.ts") },
      { find: /^@gitcrook\/docs-cli$/, replacement: pkg("docs-cli/src/index.ts") },
      { find: /^@gitcrook\/auth$/, replacement: pkg("auth/src/index.ts") },
      { find: /^@\//, replacement: `${webRoot}/` },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["{packages,apps}/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
          exclude: ["**/node_modules/**", "**/*.int.test.ts", "**/.next/**"],
          environment: "node",
          setupFiles: ["tests/support/unitSetup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["{packages,apps}/**/*.int.test.ts"],
          exclude: ["**/node_modules/**", "**/.next/**"],
          environment: "node",
          globalSetup: ["tests/support/globalSetup.ts"],
          setupFiles: ["tests/support/integrationSetup.ts"],
          // One shared database: files run one after another and each starts from an empty one.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.e2e.test.ts"],
          environment: "node",
          // Drives a real browser against a running production build; see tests/e2e/README.md.
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
