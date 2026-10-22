import { serializeBlocks } from "@gitcrook/markdown";

/**
 * A page's blocks as Markdown, for the "copy/view as markdown" page actions (GitBook offers the same two
 * on every page). It is the same writer Git Sync uses, so what a reader copies is what the repository would
 * contain: callouts as GitHub alerts, tables as tables, GitCrook's own blocks as `::directives`.
 */
export function blocksToMarkdown(content: unknown): string {
  return serializeBlocks(content).markdown.trim();
}
