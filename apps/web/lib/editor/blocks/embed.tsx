import { createReactBlockSpec } from "@blocknote/react";
import { resolveEmbed } from "@gitcrook/shared";

export const createEmbed = createReactBlockSpec(
  {
    type: "embed",
    propSchema: {
      url: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { url } = props.block.props;
      const match = url ? resolveEmbed(url) : null;
      return (
        <div style={{ width: "100%" }}>
          <input
            contentEditable={false}
            value={url}
            onChange={(e) => props.editor.updateBlock(props.block, { type: "embed", props: { url: e.target.value } })}
            placeholder="Paste a YouTube, Vimeo, Spotify, or CodePen URL"
            style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.4rem 0.6rem", fontSize: 13, marginBottom: 8 }}
          />
          {match ? (
            <iframe
              src={match.embedUrl}
              style={{ width: "100%", aspectRatio: "16/9", border: "1px solid #e5e7eb", borderRadius: 6 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          ) : url ? (
            <p style={{ fontSize: 13, color: "#9ca3af" }}>Unrecognized URL — supported: YouTube, Vimeo, Spotify, CodePen.</p>
          ) : null}
        </div>
      );
    },
  },
);
