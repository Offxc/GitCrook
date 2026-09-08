// Client-safe exports ONLY — no Node built-ins, nothing that only makes
// sense server-side. Anything else (env config, safeFetch) belongs in
// ./server.ts instead. This barrel gets pulled into browser bundles by any
// client component that imports from "@voiddocs/shared" (e.g. the editor's
// custom block definitions), and Turbopack cannot bundle Node built-ins for
// the browser at all. Discovered via a real build failure: safeFetch's
// node:dns import was being dragged into the client bundle through this
// file before the split.
export * from "./theme";
export * from "./themeVars";
export * from "./fonts";
export * from "./reservedSlugs";
export * from "./blocks/hint";
export * from "./blocks/embed";
