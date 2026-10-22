import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// One config for the whole workspace: `eslint-config-next` brings React, React Hooks, the Next.js
// rules and a handful of jsx-a11y rules; its TypeScript preset covers the packages and the worker too.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "packages/db/generated/**",
    "apps/web/lib/editor/iconPaths.generated.ts",
    "next-env.d.ts",
  ]),
  {
    settings: { next: { rootDir: "apps/web" } },
    rules: {
      // The full jsx-a11y recommended set, which eslint-config-next only partly enables. Warnings, not
      // errors: each is a real accessibility gap to burn down (PLAN.md F2), but the existing ones
      // shouldn't block unrelated work. New code should not add to the count.
      ...Object.fromEntries(Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, "warn"])),
      "jsx-a11y/label-has-for": "off", // deprecated; label-has-associated-control replaces it

      // These come from React Compiler's analysis. The app doesn't use the compiler, and each hit is
      // a pattern that works today (state initialised from props in an effect, a navigation via
      // `window.location`). They are worth cleaning up as the components are reworked (the
      // persistent shell, search), so they stay visible as warnings instead of failing the build.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
