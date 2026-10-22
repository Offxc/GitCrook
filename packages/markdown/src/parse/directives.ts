import type { Paragraph, PhrasingContent, RootContent } from "mdast";
import type { ContainerDirective, LeafDirective } from "mdast-util-directive";
import { toString } from "mdast-util-to-string";
import { resolveEmbed, safeHref, safeMediaUrl } from "@gitcrook/shared";
import type { Block, Inline } from "../types";
import { createBlock, type ConvertContext, type Place } from "./context";
import { convertNodes, collectLinkReferences } from "./convert";
import { phrasingToInline } from "./inline";

type Directive = ContainerDirective | LeafDirective;
type Attrs = Record<string, string | null | undefined>;

const attr = (attrs: Attrs | null | undefined, key: string): string => (attrs?.[key] ?? "").toString().trim();

function numberAttr(attrs: Attrs | null | undefined, key: string): number | undefined {
  const raw = attr(attrs, key);
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** `:::name[Label]` puts the label in a first paragraph marked `directiveLabel`; split it off the body. */
function splitLabel(node: ContainerDirective): { label: PhrasingContent[] | null; body: RootContent[] } {
  const [first, ...rest] = node.children;
  if (first?.type === "paragraph" && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
    return { label: (first as Paragraph).children, body: rest as RootContent[] };
  }
  return { label: null, body: node.children as RootContent[] };
}

/** A directive's title: the `[label]` if given (it keeps inline formatting), else the `title` attribute. */
function titleOf(node: ContainerDirective, label: PhrasingContent[] | null, ctx: ConvertContext): Inline[] {
  if (label) return phrasingToInline(label, { diags: ctx.diags, definitions: ctx.definitions, source: ctx.source });
  const title = attr(node.attributes, "title");
  return title ? [{ type: "text", text: title, styles: {} }] : [];
}

/** The directive exactly as the author wrote it, for the places where we show it rather than interpret it. */
function rawSource(node: Directive, ctx: ConvertContext): string {
  const { start, end } = node.position ?? {};
  if (start?.offset === undefined || end?.offset === undefined) return `:::${node.name}`;
  return ctx.source.slice(start.offset, end.offset);
}

function warnAttrs(ctx: ConvertContext, node: Directive, message: string) {
  ctx.diags.add("GS-205", `${message} (:${node.type === "leafDirective" ? ":" : "::"}${node.name})`, node.position);
}

export function convertDirective(node: Directive, ctx: ConvertContext, place: Place, index: number): Block[] {
  const make = (type: string, props: Record<string, unknown>, content?: Block["content"]) => createBlock(ctx, place, index, type, props, content, node);
  const childPlace: Place = { path: [...place.path, index], depth: place.depth + 1 };
  const attrs = node.attributes;
  const name = node.name.toLowerCase();

  // ---------------------------------------------------------------------------------------------
  // Leaf directives: one line, no body.
  // ---------------------------------------------------------------------------------------------
  if (node.type === "leafDirective") {
    switch (name) {
      case "embed": {
        const url = attr(attrs, "url");
        if (!url || !resolveEmbed(url)) {
          warnAttrs(ctx, node, url ? "That URL is not from a supported embed provider; it was turned into a link" : "An embed needs a url");
          if (!safeHref(url)) return [];
          const link = make("paragraph", {}, [{ type: "link", href: safeHref(url), content: [{ type: "text", text: url, styles: {} }] }]);
          return link ? [link] : [];
        }
        const block = make("embed", { url });
        return block ? [block] : [];
      }
      case "video":
      case "audio": {
        const src = safeMediaUrl(attr(attrs, "src"));
        if (!src) {
          warnAttrs(ctx, node, `A ${name} needs a src`);
          return [];
        }
        const props: Record<string, unknown> = { url: src, caption: attr(attrs, "caption"), name: attr(attrs, "name") };
        const width = numberAttr(attrs, "width");
        if (name === "video" && width) props.previewWidth = width;
        const block = make(name, props);
        if (!block) return [];
        ctx.references.push({ kind: name, target: src, blockId: block.id, line: node.position?.start.line });
        return [block];
      }
      case "file": {
        const src = safeHref(attr(attrs, "src"));
        if (!src) {
          warnAttrs(ctx, node, "A file needs a src");
          return [];
        }
        const block = make("file", { url: src, name: attr(attrs, "name") || toString(node as never), caption: attr(attrs, "caption") });
        if (!block) return [];
        ctx.references.push({ kind: "file", target: src, blockId: block.id, line: node.position?.start.line });
        return [block];
      }
      case "page-link":
      case "pagelink": {
        const href = safeHref(attr(attrs, "href"));
        if (!href) {
          warnAttrs(ctx, node, "A page link needs an href");
          return [];
        }
        const block = make("pageLink", { href, title: attr(attrs, "title") || toString(node as never), description: attr(attrs, "description") });
        if (!block) return [];
        ctx.references.push({ kind: "page-link", target: href, blockId: block.id, line: node.position?.start.line });
        return [block];
      }
      case "card": {
        const block = cardBlock(node, ctx, make, "");
        return block ? [block] : [];
      }
      case "button": {
        const href = safeHref(attr(attrs, "href"));
        const label = toString(node as never).trim();
        if (!href || !label) {
          warnAttrs(ctx, node, "A button needs a label and an href");
          return [];
        }
        const block = make("button", { label, href, style: attr(attrs, "style") === "secondary" ? "secondary" : "primary" });
        if (!block) return [];
        ctx.references.push({ kind: "button", target: href, blockId: block.id, line: node.position?.start.line });
        return [block];
      }
      default:
        return [unknown(node, ctx, make)].filter((b): b is Block => b !== null);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Container directives: they hold blocks.
  // ---------------------------------------------------------------------------------------------
  const { label, body } = splitLabel(node);

  switch (name) {
    case "hint": {
      // GitBook-style / explicit form of a callout: :::hint{style="warning" title="Heads up"}
      const style = ["info", "success", "warning", "danger"].includes(attr(attrs, "style")) ? attr(attrs, "style") : "info";
      const [first, ...rest] = body;
      const content = first?.type === "paragraph" ? phrasingToInline((first as Paragraph).children, { diags: ctx.diags, definitions: ctx.definitions, source: ctx.source }) : [];
      const props: Record<string, unknown> = { hintStyle: style };
      const title = attr(attrs, "title") || (label ? toString({ type: "paragraph", children: label } as never) : "");
      if (title) props.hintTitle = title;
      const block = make("hint", props, content);
      if (!block) return [];
      collectLinkReferences(content, block.id, ctx, node.position?.start.line);
      block.children = convertNodes((first?.type === "paragraph" ? rest : body) as RootContent[], ctx, childPlace);
      return [block];
    }

    case "columns": {
      const columns: Block[] = [];
      const block = make("columnList", {});
      if (!block) return [];
      const strays: RootContent[] = [];
      const flushStrays = () => {
        if (strays.length === 0) return;
        const col = createBlock(ctx, childPlace, columns.length, "column", { width: 1 });
        if (col) {
          col.children = convertNodes(strays.splice(0), ctx, { path: [...childPlace.path, columns.length], depth: childPlace.depth + 1 });
          columns.push(col);
        }
      };
      for (const child of body) {
        if (child.type === "containerDirective" && child.name.toLowerCase() === "column") {
          flushStrays();
          const col = createBlock(ctx, childPlace, columns.length, "column", { width: numberAttr(child.attributes, "width") ?? 1 }, undefined, child);
          if (!col) continue;
          const inner = splitLabel(child);
          col.children = convertNodes(inner.body, ctx, { path: [...childPlace.path, columns.length], depth: childPlace.depth + 1 });
          columns.push(col);
        } else strays.push(child);
      }
      if (strays.length > 0) {
        ctx.diags.add("GS-205", "Content directly inside :::columns was placed in its own column; wrap each column in :::column.", node.position);
        flushStrays();
      }
      if (columns.length > 4) ctx.diags.add("GS-205", "A columns block can hold up to 4 columns.", node.position);
      block.children = columns;
      return [block];
    }

    case "column": {
      ctx.diags.add("GS-205", ":::column belongs inside :::columns; its content was kept.", node.position);
      return convertNodes(body, ctx, place);
    }

    case "cards": {
      const block = make("cardGroup", { size: attr(attrs, "size") === "large" ? "large" : "medium" });
      if (!block) return [];
      const cards: Block[] = [];
      for (const child of body) {
        if ((child.type === "leafDirective" || child.type === "containerDirective") && child.name.toLowerCase() === "card") {
          const bodyText = child.type === "containerDirective" ? toString({ type: "root", children: splitLabel(child).body } as never).trim() : "";
          const card = cardBlock(
            child,
            ctx,
            (type, props, content) => createBlock(ctx, childPlace, cards.length, type, props, content, child),
            bodyText,
            child.type === "containerDirective" ? splitLabel(child).label : null,
          );
          if (card) cards.push(card);
        } else {
          ctx.diags.add("GS-205", "Only ::card entries can go inside :::cards; other content was skipped.", child.position);
        }
      }
      block.children = cards;
      return [block];
    }

    case "card": {
      ctx.diags.add("GS-205", ":::card belongs inside :::cards; it was wrapped in a card group.", node.position);
      const group = make("cardGroup", { size: "medium" });
      if (!group) return [];
      const card = cardBlock(node, ctx, (type, props, content) => createBlock(ctx, childPlace, 0, type, props, content, node), toString({ type: "root", children: body } as never).trim(), label);
      group.children = card ? [card] : [];
      return [group];
    }

    case "stepper":
    case "steps": {
      const block = make("stepper", {});
      if (!block) return [];
      const steps: Block[] = [];
      for (const child of body) {
        if (child.type === "containerDirective" && child.name.toLowerCase() === "step") {
          const inner = splitLabel(child);
          let title = titleOf(child, inner.label, ctx);
          let stepBody = inner.body;
          // GitBook writes a step's title as the first heading inside it.
          if (title.length === 0 && child.attributes?.title === undefined && stepBody[0]?.type === "heading") {
            title = phrasingToInline(stepBody[0].children, { diags: ctx.diags, definitions: ctx.definitions, source: ctx.source });
            stepBody = stepBody.slice(1);
          }
          const step = createBlock(ctx, childPlace, steps.length, "step", { index: steps.length + 1 }, title, child);
          if (!step) continue;
          step.children = convertNodes(stepBody, ctx, { path: [...childPlace.path, steps.length], depth: childPlace.depth + 1 });
          steps.push(step);
        } else {
          ctx.diags.add("GS-205", "Only :::step entries can go inside :::stepper; other content was skipped.", child.position);
        }
      }
      block.children = steps;
      return [block];
    }

    case "step": {
      ctx.diags.add("GS-205", ":::step belongs inside :::stepper; it was wrapped in one.", node.position);
      const stepper = make("stepper", {});
      if (!stepper) return [];
      const step = createBlock(ctx, childPlace, 0, "step", { index: 1 }, titleOf(node, label, ctx), node);
      if (step) {
        step.children = convertNodes(body, ctx, { path: [...childPlace.path, 0], depth: childPlace.depth + 1 });
        stepper.children = [step];
      }
      return [stepper];
    }

    case "updates": {
      const block = make("updates", {});
      if (!block) return [];
      const updates: Block[] = [];
      for (const child of body) {
        if (child.type === "containerDirective" && child.name.toLowerCase() === "update") {
          const inner = splitLabel(child);
          const props = { date: attr(child.attributes, "date"), tags: attr(child.attributes, "tags") };
          let title = titleOf(child, inner.label, ctx);
          let updateBody = inner.body;
          // GitBook writes an update's title as the first heading inside it.
          if (title.length === 0 && child.attributes?.title === undefined && updateBody[0]?.type === "heading") {
            title = phrasingToInline(updateBody[0].children, { diags: ctx.diags, definitions: ctx.definitions, source: ctx.source });
            updateBody = updateBody.slice(1);
          }
          const update = createBlock(ctx, childPlace, updates.length, "update", props, title, child);
          if (!update) continue;
          update.children = convertNodes(updateBody, ctx, { path: [...childPlace.path, updates.length], depth: childPlace.depth + 1 });
          updates.push(update);
        } else {
          ctx.diags.add("GS-205", "Only :::update entries can go inside :::updates; other content was skipped.", child.position);
        }
      }
      block.children = updates;
      return [block];
    }

    case "update": {
      ctx.diags.add("GS-205", ":::update belongs inside :::updates; it was wrapped in one.", node.position);
      const updates = make("updates", {});
      if (!updates) return [];
      const update = createBlock(ctx, childPlace, 0, "update", { date: attr(attrs, "date"), tags: attr(attrs, "tags") }, titleOf(node, label, ctx), node);
      if (update) {
        update.children = convertNodes(body, ctx, { path: [...childPlace.path, 0], depth: childPlace.depth + 1 });
        updates.children = [update];
      }
      return [updates];
    }

    case "tabs": {
      // The editor has no tabs block yet. Each tab becomes an expandable section so that every tab's
      // content is still there to read, in order.
      ctx.diags.add("GS-210", "Tabs are shown as expandable sections.", node.position);
      const out: Block[] = [];
      for (const child of body) {
        if (child.type === "containerDirective" && child.name.toLowerCase() === "tab") {
          const inner = splitLabel(child);
          const toggle = createBlock(ctx, place, index + out.length, "toggleListItem", {}, titleOf(child, inner.label, ctx), child);
          if (!toggle) continue;
          toggle.children = convertNodes(inner.body, ctx, { path: [...place.path, index + out.length], depth: place.depth + 1 });
          out.push(toggle);
        } else {
          for (const b of convertNodes([child], ctx, place)) out.push(b);
        }
      }
      return out;
    }

    case "tab": {
      const inner = splitLabel(node);
      const toggle = make("toggleListItem", {}, titleOf(node, inner.label, ctx));
      if (!toggle) return [];
      toggle.children = convertNodes(inner.body, ctx, childPlace);
      return [toggle];
    }

    default: {
      const block = unknown(node, ctx, make);
      return block ? [block] : [];
    }
  }
}

/** A directive we don't know is shown exactly as written, in a code block, so no content is ever lost. */
function unknown(node: Directive, ctx: ConvertContext, make: (type: string, props: Record<string, unknown>, content?: Block["content"]) => Block | null): Block | null {
  ctx.diags.add("GS-203", `Unknown directive "${node.name}". It is shown as text.`, node.position);
  return make("codeBlock", { language: "text" }, [{ type: "text", text: rawSource(node, ctx), styles: {} }]);
}

function cardBlock(
  node: Directive,
  ctx: ConvertContext,
  make: (type: string, props: Record<string, unknown>, content?: Block["content"]) => Block | null,
  bodyText: string,
  label: PhrasingContent[] | null = null,
): Block | null {
  const attrs = node.attributes;
  const labelText = label ? toString({ type: "paragraph", children: label } as never) : node.type === "leafDirective" ? toString(node as never) : "";
  const title = attr(attrs, "title") || labelText;
  const href = attr(attrs, "href") ? safeHref(attr(attrs, "href")) : "";
  const image = attr(attrs, "image") ? safeMediaUrl(attr(attrs, "image")) : "";
  if (!title && !href && !image && !bodyText) {
    warnAttrs(ctx, node, "A card needs at least a title, link or image");
    return null;
  }
  const block = make("card", { title, description: attr(attrs, "description") || bodyText, href, imageUrl: image });
  if (!block) return null;
  if (href) ctx.references.push({ kind: "card-link", target: href, blockId: block.id, line: node.position?.start.line });
  if (image) ctx.references.push({ kind: "card-image", target: image, blockId: block.id, line: node.position?.start.line });
  return block;
}
