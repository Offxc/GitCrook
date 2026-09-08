import { createReactBlockSpec } from "@blocknote/react";

/**
 * Two block types, matching GitBook's real Stepper: a "stepper" container and
 * numbered "step" children. Unlike Tabs (not built yet) or the Expandable
 * toggle, a stepper shows every step's content simultaneously — no
 * show/hide state needed, just numbering.
 */
export const createStepper = createReactBlockSpec(
  {
    type: "stepper",
    propSchema: {},
    content: "none",
  },
  {
    render: (props) => (
      <div className="stepper-block" style={{ width: "100%" }}>
        {/* BlockNote renders `block.children` (the "step" blocks) automatically,
            indented beneath whatever this component returns — nothing to do
            here besides existing as the container (confirmed via testing with
            the Columns/Toggle blocks: children render outside this return
            value, not through a ref this component controls). */}
      </div>
    ),
  },
);

export const createStep = createReactBlockSpec(
  {
    type: "step",
    propSchema: {
      index: { default: 1 },
    },
    content: "inline",
  },
  {
    render: (props) => (
      <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
        <div
          contentEditable={false}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#e5e7eb",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {props.block.props.index}
        </div>
        <div style={{ flex: 1, fontWeight: 600 }} ref={props.contentRef} />
      </div>
    ),
  },
);
