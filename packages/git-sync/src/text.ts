import { diagnostic, type Diagnostic } from "@gitcrook/markdown";

const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\b/;

/**
 * A file's bytes as text, or the reason it cannot be: it is binary, or it is a Git LFS pointer (the file itself was
 * never checked out). Shared by the sync and the local checker so they skip the same files.
 */
export function decodeRepoText(bytes: Uint8Array, shownPath: string): { text: string } | { diagnostic: Diagnostic } {
  if (bytes.includes(0)) return { diagnostic: diagnostic("GS-140", `"${shownPath}" is not a text file; it was skipped.`, { path: shownPath }) };
  const text = new TextDecoder("utf-8").decode(bytes);
  if (bytes.length < 1024 && LFS_POINTER.test(text)) return { diagnostic: diagnostic("GS-160", `"${shownPath}" is a Git LFS pointer, not the file itself; it was skipped.`, { path: shownPath }) };
  return { text };
}
