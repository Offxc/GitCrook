#!/usr/bin/env node
/**
 * Regenerates apps/web/lib/editor/iconPaths.generated.ts from the installed
 * @phosphor-icons/react package.
 *
 * We render icons as plain SVG paths rather than using Phosphor's React
 * components: we only ever use the "regular" weight, and their per-icon
 * module carries all six weights plus a runtime that reads React context —
 * which costs ~20x the bytes and forces every consumer to be a Client
 * Component. Extracting just the regular paths gives one renderer that works
 * in Server and Client Components alike.
 *
 * Run after bumping @phosphor-icons/react:
 *   node scripts/generate-icon-paths.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgEntry = require.resolve("@phosphor-icons/react", { paths: [path.resolve("apps/web")] });
const defsDir = path.join(path.dirname(pkgEntry), "defs");

/** Pull the `d` of every <path> in the map entry for the "regular" weight. */
function regularPaths(source) {
  const start = source.indexOf('"regular"');
  if (start === -1) return null;
  const rest = source.slice(start);
  let end = rest.length;
  for (const weight of ['"bold"', '"duotone"', '"fill"', '"light"', '"thin"']) {
    const at = rest.indexOf(weight, 1);
    if (at !== -1) end = Math.min(end, at);
  }
  const paths = [...rest.slice(0, end).matchAll(/d:\s*"([^"]+)"/g)].map((m) => m[1]);
  return paths.length > 0 ? paths : null;
}

const toSlug = (name) => name.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase().replace(/-+/g, "-");

const icons = {};
let skipped = 0;
for (const file of readdirSync(defsDir).filter((f) => f.endsWith(".es.js")).sort()) {
  const name = file.replace(".es.js", "");
  // Brand marks aren't useful as page icons and are a third of the set.
  if (name.endsWith("Logo")) {
    skipped += 1;
    continue;
  }
  const paths = regularPaths(readFileSync(path.join(defsDir, file), "utf8"));
  if (!paths) {
    skipped += 1;
    continue;
  }
  icons[toSlug(name)] = paths;
}

const out = `/**
 * GENERATED — do not edit by hand. See scripts/generate-icon-paths.mjs.
 *
 * Regular-weight path data for Phosphor's icon set, on a 0 0 256 256
 * viewBox, filled with currentColor (matching how Phosphor renders them).
 */

export const ICON_PATHS: Record<string, string[]> = ${JSON.stringify(icons)};
`;

const target = path.resolve("apps/web/lib/editor/iconPaths.generated.ts");
writeFileSync(target, out);
console.log(`wrote ${target}: ${Object.keys(icons).length} icons (${skipped} skipped)`);
