/** Bounds on what one sync will read. A repository is untrusted input: none of these is "unlimited". */
export interface SyncLimits {
  /** Markdown and asset files per source. */
  maxFiles: number;
  /** Bytes in one Markdown file. */
  maxMarkdownBytes: number;
  /** Bytes of Markdown read in one run. */
  maxMarkdownRunBytes: number;
  /** Bytes in one image or other asset. */
  maxAssetBytes: number;
  /** Bytes of assets in one run. */
  maxRunBytes: number;
  /** Bytes of config files (`gitcrook.yaml`, `SUMMARY.md`). */
  maxConfigBytes: number;
  /** Files fetched at once. */
  concurrency: number;
  /** Longest a run may take. */
  runTimeoutMs: number;
}

export const DEFAULT_LIMITS: SyncLimits = {
  maxFiles: 5_000,
  maxMarkdownBytes: 1_000_000,
  maxMarkdownRunBytes: 100_000_000,
  maxAssetBytes: 20_000_000,
  maxRunBytes: 500_000_000,
  maxConfigBytes: 256_000,
  concurrency: 4,
  runTimeoutMs: 10 * 60_000,
};
