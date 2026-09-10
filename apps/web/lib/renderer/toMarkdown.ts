/**
 * Serialises a page's BlockNote document to Markdown for the "copy/view as
 * markdown" page actions (GitBook offers the same two on every page).
 *
 * Duck-types the block shapes for the same reason blockRenderer.tsx does —
 * this runs in a route that ships no editor code. Block types it doesn't
 * know about degrade to their plain text rather than being dropped, so a new
 * custom block never silently disappears from a copied page.
 */

interface LooseBlock {
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
}

export function blocksToMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return blockList(content as LooseBlock[], 0).replace(/\n{3,}/g, "\n\n").trim();
}

function blockList(blocks: LooseBlock[], depth: number): string {
  let numbering = 0;
  return blocks
    .map((block) => {
      if (block?.type === "numberedListItem") numbering += 1;
      else numbering = 0;
      return blockToMarkdown(block, depth, numbering);
    })
    .filter((chunk) => chunk !== "")
    .join("\n\n");
}

function blockToMarkdown(block: LooseBlock, depth: number, numbering: number): string {
  const props = (block?.props ?? {}) as Record<string, unknown>;
  const text = inlineToMarkdown(block?.content);
  const kids = Array.isArray(block?.children) ? (block.children as LooseBlock[]) : [];
  const indent = "  ".repeat(depth);
  const withKids = (self: string, childDepth = depth + 1) => {
    const nested = kids.length > 0 ? blockList(kids, childDepth) : "";
    return nested ? `${self}\n\n${nested}` : self;
  };

  switch (block?.type) {
    case "heading": {
      const level = Math.min(Number(props.level) || 2, 6);
      return withKids(`${"#".repeat(level)} ${text}`);
    }
    case "bulletListItem":
      return withKids(`${indent}- ${text}`);
    case "numberedListItem":
      return withKids(`${indent}${numbering || 1}. ${text}`);
    case "checkListItem":
      return withKids(`${indent}- [${props.checked ? "x" : " "}] ${text}`);
    case "toggleListItem":
      return withKids(`${indent}- ${text}`);
    case "quote":
      return withKids(`> ${text}`);
    case "codeBlock": {
      const lang = typeof props.language === "string" ? props.language : "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "hint": {
      // No portable Markdown callout syntax; a blockquote with the title in
      // bold is the closest lossless-enough shape.
      const title = typeof props.hintTitle === "string" ? props.hintTitle.trim() : "";
      const body = text ? `> ${text}` : "";
      return title ? [`> **${title}**`, ">", body].filter(Boolean).join("\n") : body;
    }
    case "divider":
      return "---";
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const caption = typeof props.caption === "string" ? props.caption : text;
      return url ? `![${caption}](${url})` : "";
    }
    case "file": {
      const url = typeof props.url === "string" ? props.url : "";
      const name = typeof props.name === "string" ? props.name : "File";
      return url ? `[${name}](${url})` : "";
    }
    case "math":
      return typeof props.latex === "string" ? `$$\n${props.latex}\n$$` : "";
    case "button": {
      const href = typeof props.href === "string" ? props.href : "";
      const label = typeof props.label === "string" ? props.label : text;
      return href ? `[${label}](${href})` : label;
    }
    case "embed":
      return typeof props.url === "string" ? props.url : "";
    case "pageLink": {
      const label = typeof props.label === "string" && props.label ? props.label : text;
      return label ? `- ${label}` : "";
    }
    // Containers: no Markdown equivalent, so emit their children inline.
    case "columnList":
    case "column":
    case "table":
    case "stepper":
    case "cardGroup":
    case "updates":
      return kids.length > 0 ? blockList(kids, depth) : text;
    case "step":
    case "card":
    case "update": {
      const title = typeof props.title === "string" ? props.title : "";
      const head = title ? `**${title}**` : "";
      const nested = kids.length > 0 ? blockList(kids, depth) : "";
      return [head, text, nested].filter(Boolean).join("\n\n");
    }
    default:
      return withKids(text);
  }
}

function inlineToMarkdown(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const node = item as Record<string, unknown>;

      if (node.type === "link") {
        const href = typeof node.href === "string" ? node.href : "";
        const label = inlineToMarkdown(node.content);
        return href ? `[${label}](${href})` : label;
      }

      let out = typeof node.text === "string" ? node.text : "";
      if (!out) return "";
      const styles = (node.styles ?? {}) as Record<string, unknown>;
      if (styles.code) out = `\`${out}\``;
      if (styles.bold) out = `**${out}**`;
      if (styles.italic) out = `_${out}_`;
      if (styles.strike) out = `~~${out}~~`;
      return out;
    })
    .join("");
}
