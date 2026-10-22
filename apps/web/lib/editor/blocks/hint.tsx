import { createReactBlockSpec } from "@blocknote/react";
import { HINT_STYLES, HINT_STYLE_META, type HintStyle } from "@gitcrook/shared";

export const createHint = createReactBlockSpec(
  {
    type: "hint",
    propSchema: {
      hintStyle: { default: "info" as HintStyle, values: HINT_STYLES },
      // Optional heading for the callout. When set, the published renderer
      // switches to GitBook's two-tone shape (accent header band above a
      // lighter body); left empty it renders as a single body block.
      hintTitle: { default: "" },
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
            borderRadius: "8px",
            borderLeft: `3px solid ${meta.border}`,
            background: meta.bg,
            width: "100%",
            overflow: "hidden",
          }}
        >
          <div contentEditable={false} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: `${meta.border}22` }}>
            <div style={{ display: "flex", gap: "0.25rem" }}>
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
            <input
              value={props.block.props.hintTitle}
              onChange={(e) => props.editor.updateBlock(props.block, { type: "hint", props: { hintTitle: e.target.value } })}
              placeholder="Title (optional)"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                color: meta.text,
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            />
          </div>
          <div ref={props.contentRef} style={{ color: meta.text, padding: "0.65rem 0.75rem" }} />
        </div>
      );
    },
  },
);
