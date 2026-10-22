import type { Block } from "../types";

/** Blocks without their ids: two parses of equivalent content have different ids if their positions differ. */
export function strip(blocks: Block[]): unknown[] {
  return blocks.map((b) => ({
    type: b.type,
    props: b.props,
    ...(b.content !== undefined ? { content: b.content } : {}),
    children: strip(b.children),
  }));
}
