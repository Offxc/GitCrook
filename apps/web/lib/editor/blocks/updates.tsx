import { createReactBlockSpec } from "@blocknote/react";

/**
 * "updates" container + "update" children — a changelog. Unlike Cards, each
 * update's body IS arbitrary nested content (matching GitBook's real
 * behavior: "supports any block content inside it"), so only date/tags are
 * props; the body is the update block's children, same as Stepper's steps.
 */
export const createUpdates = createReactBlockSpec(
  {
    type: "updates",
    propSchema: {},
    content: "none",
  },
  {
    render: () => <div className="updates-block" style={{ width: "100%" }} />,
  },
);

export const createUpdate = createReactBlockSpec(
  {
    type: "update",
    propSchema: {
      date: { default: "" },
      tags: { default: "" }, // comma-separated — propSchema only supports primitives, see packages/shared/src/blocks/embed.ts's note on the same constraint
    },
    content: "inline",
  },
  {
    render: (props) => {
      const { date, tags } = props.block.props;
      const update = (patch: Partial<{ date: string; tags: string }>) => props.editor.updateBlock(props.block, { type: "update", props: patch });

      return (
        <div style={{ width: "100%", borderLeft: "2px solid #e5e7eb", paddingLeft: "0.9rem" }}>
          <div contentEditable={false} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => update({ date: e.target.value })}
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", color: "#6b7280" }}
            />
            <input
              value={tags}
              onChange={(e) => update({ tags: e.target.value })}
              placeholder="tags, comma, separated"
              style={{ fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 4, padding: "2px 6px", color: "#6b7280", flex: 1 }}
            />
          </div>
          <div ref={props.contentRef} style={{ fontWeight: 600 }} />
        </div>
      );
    },
  },
);
