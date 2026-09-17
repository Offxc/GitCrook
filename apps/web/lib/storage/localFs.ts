// Re-exported from @gitcrook/shared/server, which apps/worker also needs
// (PDF export writes here too) — see that file for the actual implementation
// and why STORAGE_DIR must be absolute once more than one process uses it.
export { storagePathFor, writeStoredFile, readStoredFile } from "@gitcrook/shared/server";
