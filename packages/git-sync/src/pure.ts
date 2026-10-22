/**
 * The parts of Git Sync that need no database, network or server: what the local checker (`gitcrook-docs`) is built
 * from. Kept as its own entry point so a tool that imports it does not pull the sync engine, and with it the
 * database client, into its bundle.
 */
export * from "./analyze";
export * from "./limits";
export * from "./rewrite";
export * from "./text";
export * from "./tree";
export { GitHostError } from "./github/errors";
export type { TreeEntry } from "./github/client";
