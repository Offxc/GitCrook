import { createReactBlockSpec } from "@blocknote/react";
import katex from "katex";
import "katex/dist/katex.min.css";

export const createMath = createReactBlockSpec(
  {
    type: "math",
    propSchema: {
      formula: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { formula } = props.block.props;
      let html = "";
      let error = false;
      try {
        html = katex.renderToString(formula || "\\LaTeX", { throwOnError: true, displayMode: true });
      } catch {
        error = true;
        html = katex.renderToString(formula || "", { throwOnError: false, displayMode: true });
      }
      return (
        <div style={{ width: "100%" }}>
          <input
            contentEditable={false}
            value={formula}
            onChange={(e) => props.editor.updateBlock(props.block, { type: "math", props: { formula: e.target.value } })}
            placeholder="Enter a LaTeX formula, e.g. E = mc^2"
            style={{
              width: "100%",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "0.4rem 0.6rem",
              fontFamily: "monospace",
              fontSize: 13,
              marginBottom: 8,
            }}
          />
          <div
            contentEditable={false}
            style={{ textAlign: "center", padding: "0.75rem", border: error ? "1px solid #f87171" : "1px solid #e5e7eb", borderRadius: 6, overflowX: "auto" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      );
    },
  },
);
