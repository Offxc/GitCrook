import { createReactBlockSpec } from "@blocknote/react";

export const createButton = createReactBlockSpec(
  {
    type: "button",
    propSchema: {
      label: { default: "Click me" },
      href: { default: "" },
      style: { default: "primary" as const, values: ["primary", "secondary"] as const },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { label, href, style } = props.block.props;
      const update = (patch: Partial<{ label: string; href: string; style: "primary" | "secondary" }>) =>
        props.editor.updateBlock(props.block, { type: "button", props: patch });
      const isPrimary = style === "primary";

      return (
        <div contentEditable={false} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span
            style={{
              display: "inline-block",
              padding: "0.4rem 0.9rem",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              background: isPrimary ? "#4f46e5" : "transparent",
              color: isPrimary ? "#fff" : "#4f46e5",
              border: isPrimary ? "none" : "1px solid #4f46e5",
            }}
          >
            {label}
          </span>
          <button
            type="button"
            onClick={() => update({ style: isPrimary ? "secondary" : "primary" })}
            style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}
          >
            {isPrimary ? "primary" : "secondary"}
          </button>
          <input
            value={label}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="Label"
            style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", width: 120 }}
          />
          <input
            value={href}
            onChange={(e) => update({ href: e.target.value })}
            placeholder="/path-or-https://url"
            style={{ fontSize: 12, fontFamily: "monospace", border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", flex: 1 }}
          />
        </div>
      );
    },
  },
);
