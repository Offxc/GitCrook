import { createReactBlockSpec } from "@blocknote/react";

/**
 * GitBook's real Page Link resolves a live reference to another page in the
 * same site. Simplified here to an author-entered link card (href + title +
 * description) rather than a live site-search picker — still delivers the
 * visual "reference card, not an inline text link" pattern, and works for
 * external links too, not just internal pages.
 */
export const createPageLink = createReactBlockSpec(
  {
    type: "pageLink",
    propSchema: {
      href: { default: "" },
      title: { default: "" },
      description: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { href, title, description } = props.block.props;
      const update = (patch: Partial<{ href: string; title: string; description: string }>) =>
        props.editor.updateBlock(props.block, { type: "pageLink", props: patch });

      return (
        <div
          contentEditable={false}
          style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem 0.9rem", display: "flex", flexDirection: "column", gap: 4 }}
        >
          <input
            value={title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Page title"
            style={{ border: "none", outline: "none", background: "transparent", fontWeight: 600, fontSize: 14 }}
          />
          <input
            value={description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Short description (optional)"
            style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, color: "#6b7280" }}
          />
          <input
            value={href}
            onChange={(e) => update({ href: e.target.value })}
            placeholder="/path-or-https://url"
            style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}
          />
        </div>
      );
    },
  },
);
