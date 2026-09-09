import fs from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env";

/**
 * Local-disk storage, shared by apps/web (uploads) and apps/worker (PDF
 * export output) — both need to read/write the exact same files, which in
 * Docker Compose is one mounted volume at a fixed path. Not a pluggable
 * backend abstraction: there's exactly one storage target in this
 * deployment; a swap to object storage later is a contained change to this
 * one file, not a reason to build an interface no second implementation
 * exists for yet.
 */

function resolveStorageDir(): string {
  const dir = getEnv().STORAGE_DIR;
  // turbopackIgnore: this dynamic resolve() was making the build tracer treat
  // the whole project as reachable from here and bundle it together — harmless
  // on its own, but once client-only code (BlockNote/Mantine, added for the
  // in-place editor) was anywhere in that same graph, it started getting
  // pulled into server bundles that can't run it, breaking prerendering of
  // unrelated pages (found via a real build failure on Next's own
  // /_global-error page, not a hypothetical). Every real value STORAGE_DIR
  // takes in this project (Docker's /data/uploads, or local dev's absolute
  // path) is already absolute — the relative-path branch only exists for the
  // schema's own bare default — so opting this specific call out of tracing
  // changes nothing about what it actually resolves to.
  return path.isAbsolute(dir) ? dir : path.resolve(/* turbopackIgnore: true */ process.cwd(), dir);
}

export function storagePathFor(storageKey: string): string {
  // storageKey is always a value WE generate (checksum-derived), never taken
  // directly from user input, so this can't be used for path traversal.
  return path.join(resolveStorageDir(), storageKey);
}

export async function writeStoredFile(storageKey: string, data: Buffer): Promise<void> {
  const filePath = storagePathFor(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return fs.readFile(storagePathFor(storageKey));
}
