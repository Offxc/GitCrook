/**
 * Block ids that depend only on where a block is, never on when it was parsed. The editor mints random ids,
 * so re-importing a page would give every block a new identity (and every anchor a new URL). Here the same
 * file always produces the same ids, which keeps diffs between syncs about content rather than churn.
 *
 * A 64-bit hash built from two 32-bit mixes (the cyrb53 construction): small, dependency-free, and the
 * same in a browser, a worker and a test. It is an identifier, not a security boundary.
 */

function mix(input: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A short, stable identifier for `parts` (joined unambiguously), e.g. `"b3k9x2p1q7f"`. */
export function stableId(...parts: (string | number)[]): string {
  const key = parts.map((p) => String(p).replace(/\\/g, "\\\\").replace(/\|/g, "\\|")).join("|");
  return `b${mix(key, 0).toString(36)}${mix(key, 1).toString(36)}`.slice(0, 14);
}

/**
 * Hands out ids for the blocks of one document: the n-th block at a given position of a given type always
 * gets the same id, and ids are unique within the document.
 */
export class IdSource {
  private readonly used = new Set<string>();

  constructor(private readonly seed: string) {}

  next(path: readonly number[], type: string): string {
    let id = stableId(this.seed, path.join("."), type);
    // A collision (astronomically unlikely) must still not produce two blocks with the same id.
    for (let salt = 1; this.used.has(id); salt++) id = stableId(this.seed, path.join("."), type, salt);
    this.used.add(id);
    return id;
  }
}
