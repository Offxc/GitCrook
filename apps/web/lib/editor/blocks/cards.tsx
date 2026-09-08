import { createReactBlockSpec } from "@blocknote/react";

/**
 * "cardGroup" container + "card" children, same parent/children pattern as
 * Stepper. Each card is self-contained (title/description/href/image as
 * props) rather than holding arbitrary nested content — matches GitBook's
 * own card model (a card is a link target, not a content container).
 */
export const createCardGroup = createReactBlockSpec(
  {
    type: "cardGroup",
    propSchema: {
      size: { default: "medium" as const, values: ["medium", "large"] as const },
    },
    content: "none",
  },
  {
    render: (props) => {
      const isLarge = props.block.props.size === "large";
      return (
        <div contentEditable={false} style={{ marginBottom: 4 }}>
          <button
            type="button"
            onClick={() => props.editor.updateBlock(props.block, { type: "cardGroup", props: { size: isLarge ? "medium" : "large" } })}
            style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
          >
            {isLarge ? "Large cards (2/row)" : "Medium cards (3/row)"} — click to toggle
          </button>
        </div>
      );
    },
  },
);

export const createCard = createReactBlockSpec(
  {
    type: "card",
    propSchema: {
      title: { default: "" },
      description: { default: "" },
      href: { default: "" },
      imageUrl: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { title, description, href, imageUrl } = props.block.props;
      const update = (patch: Partial<{ title: string; description: string; href: string; imageUrl: string }>) =>
        props.editor.updateBlock(props.block, { type: "card", props: patch });

      return (
        <div contentEditable={false} style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- editor-only preview, arbitrary user-entered URL
            <img src={imageUrl} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
          ) : null}
          <div style={{ padding: "0.6rem 0.75rem", display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              value={title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Card title"
              style={{ border: "none", outline: "none", background: "transparent", fontWeight: 600, fontSize: 13 }}
            />
            <input
              value={description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Description"
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, color: "#6b7280" }}
            />
            <input
              value={href}
              onChange={(e) => update({ href: e.target.value })}
              placeholder="Target link"
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}
            />
            <input
              value={imageUrl}
              onChange={(e) => update({ imageUrl: e.target.value })}
              placeholder="Cover image URL (optional)"
              style={{ border: "none", outline: "none", background: "transparent", fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}
            />
          </div>
        </div>
      );
    },
  },
);
