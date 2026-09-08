import { createReactBlockSpec } from "@blocknote/react";
import { HINT_STYLES, HINT_STYLE_META, type HintStyle } from "@voiddocs/shared";

export const createHint = createReactBlockSpec(
  {
    type: "hint",
    propSchema: {
      hintStyle: { default: "info" as HintStyle, values: HINT_STYLES },
    },
    content: "inline",
  },
  {
    render: (props) => {
      const style = props.block.props.hintStyle;
      const meta = HINT_STYLE_META[style];
      return (
        <div
          className="hint-block"
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
            borderRadius: "8px",
            border: `1px solid ${meta.border}33`,
            background: meta.bg,
            padding: "0.75rem 0.9rem",
            width: "100%",
          }}
        >
          <div contentEditable={false} style={{ display: "flex", gap: "0.25rem", paddingTop: "0.15rem" }}>
            {HINT_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                title={HINT_STYLE_META[s].label}
                onClick={() => props.editor.updateBlock(props.block, { type: "hint", props: { hintStyle: s } })}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: HINT_STYLE_META[s].dot,
                  border: s === style ? "2px solid currentColor" : "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
          <div ref={props.contentRef} style={{ color: meta.text, flex: 1 }} />
        </div>
      );
    },
  },
);
