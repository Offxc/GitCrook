import { BlockNoteSchema, createCodeBlockSpec } from "@blocknote/core";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { createHint } from "./blocks/hint";
import { createStepper, createStep } from "./blocks/stepper";
import { createPageLink } from "./blocks/pageLink";
import { createMath } from "./blocks/math";
import { createButton } from "./blocks/button";
import { createEmbed } from "./blocks/embed";
import { createCardGroup, createCard } from "./blocks/cards";
import { createUpdates, createUpdate } from "./blocks/updates";

/**
 * Assembly point for every custom GitBook-style block on top of BlockNote's
 * defaults (paragraph, headings, lists incl. toggleListItem — GitBook's
 * "Expandable" — code, image, file, table, ...). Each addition here needs a
 * matching case in lib/renderer/blockRenderer.tsx — the editor and the
 * read-only renderer must always agree on the shape.
 *
 * Columns use BlockNote's own first-party @blocknote/xl-multi-column package
 * (columnList/column block types + horizontal layout) rather than a
 * hand-rolled block — no reason to re-solve what BlockNote already ships.
 */
// IDs match Shiki's bundled language identifiers exactly (verified against
// shiki@4.4.3's own bundledLanguagesInfo/bundledLanguagesAlias) — the
// renderer passes props.language straight into Shiki's codeToHtml with no
// translation table, so a mismatch here would silently fall back to plain text.
const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "Plain text" },
  javascript: { name: "JavaScript", aliases: ["js"] },
  typescript: { name: "TypeScript", aliases: ["ts"] },
  jsx: { name: "JSX" },
  tsx: { name: "TSX" },
  python: { name: "Python", aliases: ["py"] },
  bash: { name: "Bash", aliases: ["sh", "shell"] },
  json: { name: "JSON" },
  yaml: { name: "YAML", aliases: ["yml"] },
  markdown: { name: "Markdown", aliases: ["md"] },
  css: { name: "CSS" },
  html: { name: "HTML" },
  sql: { name: "SQL" },
  go: { name: "Go", aliases: ["golang"] },
  rust: { name: "Rust", aliases: ["rs"] },
  java: { name: "Java" },
  csharp: { name: "C#", aliases: ["cs"] },
  ruby: { name: "Ruby", aliases: ["rb"] },
  php: { name: "PHP" },
  c: { name: "C" },
  cpp: { name: "C++" },
  swift: { name: "Swift" },
  kotlin: { name: "Kotlin", aliases: ["kt"] },
  docker: { name: "Dockerfile" },
};

export const gitCrookSchema = withMultiColumn(
  BlockNoteSchema.create().extend({
    blockSpecs: {
      codeBlock: createCodeBlockSpec({ supportedLanguages: CODE_LANGUAGES }),
      hint: createHint(),
      stepper: createStepper(),
      step: createStep(),
      pageLink: createPageLink(),
      math: createMath(),
      button: createButton(),
      embed: createEmbed(),
      cardGroup: createCardGroup(),
      card: createCard(),
      updates: createUpdates(),
      update: createUpdate(),
    },
  }),
);
