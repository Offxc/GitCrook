// Bundles the checker into one file that runs on plain Node (20+), with no install step: this is what is
// published or copied into a documentation repository's CI. Everything it needs from the workspace is inlined,
// and none of it is the database, the server or the Git host client.
import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/gitcrook-docs.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Some bundled CommonJS dependencies call require().
      'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    ].join("\n"),
  },
  minify: false,
  legalComments: "none",
  logLevel: "info",
});
await chmod("dist/gitcrook-docs.mjs", 0o755);
