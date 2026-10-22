import type { Definition } from "mdast";
import type { Diagnostics } from "../diagnostics";
import type { IdSource } from "../ids";
import type { Block } from "../types";

export interface ParseOptions {
  /** The file's path in the repository: used for diagnostics and as the seed for block ids. */
  path?: string;
  /** Overrides the id seed (defaults to `path`). */
  idSeed?: string;
  /**
   * Use a leading `# Heading` as the page title and remove it from the blocks (the site shows the title
   * itself, so leaving it would show it twice). On by default; round-trip tests turn it off.
   */
  extractTitle?: boolean;
  /** Understand GitBook's `{% hint %}`-style tags. On by default. */
  gitbook?: boolean;
  /** Resolves `{% include %}`; return null if the file doesn't exist. Without it includes are reported, not followed. */
  resolveInclude?: (path: string) => string | null;
  /** Deepest block nesting accepted. */
  maxDepth?: number;
  /** Most blocks accepted in one page. */
  maxBlocks?: number;
}

export const DEFAULT_LIMITS = { maxDepth: 20, maxBlocks: 5000 } as const;

/** Something in the page that points at another file or URL, so the caller can resolve or import it. */
export interface Reference {
  kind: "image" | "link" | "file" | "video" | "audio" | "card-image" | "card-link" | "page-link" | "button";
  target: string;
  /** The id of the block that holds it, so a rewritten target can be put back. */
  blockId: string;
  line?: number;
}

export interface ConvertContext {
  /** The document's text after front matter and tag translation: positions in the tree index into it. */
  source: string;
  ids: IdSource;
  diags: Diagnostics;
  options: Required<Pick<ParseOptions, "maxDepth" | "maxBlocks">> & ParseOptions;
  /** Link reference definitions (`[label]: url`) found anywhere in the document, by lower-cased label. */
  definitions: Map<string, Definition>;
  references: Reference[];
  state: { blocks: number; overflowReported: boolean };
}

/** Where a block is being built: its position in the tree decides its id. */
export interface Place {
  path: number[];
  depth: number;
}

/** Creates a block with a position-derived id, enforcing the limits. Returns null when the page is over them. */
export function createBlock(
  ctx: ConvertContext,
  place: Place,
  index: number,
  type: string,
  props: Record<string, unknown>,
  content?: Block["content"],
  node?: { position?: unknown } | null,
): Block | null {
  if (ctx.state.blocks >= ctx.options.maxBlocks) {
    if (!ctx.state.overflowReported) {
      ctx.state.overflowReported = true;
      ctx.diags.add("GS-207", `The page has more than ${ctx.options.maxBlocks} blocks; the rest was skipped.`, node?.position as never);
    }
    return null;
  }
  ctx.state.blocks++;
  const block: Block = { id: ctx.ids.next([...place.path, index], type), type, props, children: [] };
  if (content !== undefined) block.content = content;
  return block;
}
