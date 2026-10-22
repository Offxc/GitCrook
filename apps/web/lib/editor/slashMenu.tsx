import { combineByGroup } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from "@blocknote/react";
import { getMultiColumnSlashMenuItems } from "@blocknote/xl-multi-column";
import type { gitCrookSchema } from "./schema";

// `typeof gitCrookSchema.BlockNoteEditor` is BlockNote's own convention for
// naming "the concrete editor type produced by this specific schema" — the
// bare `BlockNoteEditor` type defaults to the built-in schema and rejects
// our custom block types (e.g. "hint") at the call sites below.
type GitCrookEditor = typeof gitCrookSchema.BlockNoteEditor;

/**
 * Registering a block in the schema (lib/editor/schema.ts) only makes the
 * TYPE exist — it does not add a slash-menu entry for it (confirmed via
 * testing: BlockNote shows "No items found" for a schema-only block).  Each
 * custom block needs an explicit entry here too. `combineByGroup` (rather
 * than a plain array spread) merges same-named groups from multiple sources
 * cleanly — needed now that both the multi-column package and our own custom
 * items exist alongside BlockNote's defaults.
 */
export function getGitCrookSlashMenuItems(editor: GitCrookEditor): DefaultReactSuggestionItem[] {
  // `onItemClick` is a no-arg closure (BlockNote's own type: `() => void`),
  // so this array has to close over `editor` and therefore live inside this
  // function — but it's still assigned to a typed variable rather than
  // passed as an inline literal, because combineByGroup's rest-parameter
  // type is a widened `{group?: string}[][]` and TS's excess-property check
  // rejects literal objects with extra fields (title, onItemClick, ...)
  // against that narrower shape. A variable of the wider
  // DefaultReactSuggestionItem[] type sidesteps the check entirely.
  const group = "GitBook blocks"; // distinct from BlockNote's own "Basic blocks" — see hint's history below
  const customItems: DefaultReactSuggestionItem[] = [
    {
      title: "Hint",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "hint" }),
      aliases: ["callout", "info", "warning", "danger", "success", "alert"],
      // A distinct group name, not "Basic blocks" — BlockNote's own default
      // items already use that exact string, and reusing it caused a real
      // "two children with the same key" React warning (confirmed via
      // testing), not just a cosmetic label choice.
      group,
      subtext: "Draw attention to important information",
    },
    {
      title: "Stepper",
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "stepper",
          children: [{ type: "step", props: { index: 1 }, content: "First step" }],
        }),
      aliases: ["steps", "walkthrough", "tutorial"],
      group,
      subtext: "Break a guide down into numbered steps",
    },
    {
      title: "Page link",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink" }),
      aliases: ["link card", "reference"],
      group,
      subtext: "Show a relation to another page as a card",
    },
    {
      title: "Math & TeX",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "math" }),
      aliases: ["formula", "latex", "equation"],
      group,
      subtext: "Display a mathematical formula",
    },
    {
      title: "Button",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "button" }),
      aliases: ["cta", "link button"],
      group,
      subtext: "A clickable link styled as a button",
    },
    {
      title: "Embed",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "embed" }),
      aliases: ["youtube", "vimeo", "spotify", "codepen", "video"],
      group,
      subtext: "Embed a video, music, or code demo",
    },
    {
      title: "Cards",
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "cardGroup",
          children: [
            { type: "card", props: { title: "Card one" } },
            { type: "card", props: { title: "Card two" } },
          ],
        }),
      aliases: ["grid", "gallery"],
      group,
      subtext: "A grid of linked cards, with or without images",
    },
    {
      title: "Updates",
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, {
          type: "updates",
          children: [{ type: "update", content: "A brand new update" }],
        }),
      aliases: ["changelog", "release notes"],
      group,
      subtext: "A changelog, perfect for release notes",
    },
  ];

  return combineByGroup(getDefaultReactSlashMenuItems(editor), getMultiColumnSlashMenuItems(editor), customItems);
}
