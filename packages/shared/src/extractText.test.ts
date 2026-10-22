import { describe, expect, it } from "vitest";
import { extractPlainText } from "./extractText";

const t = (text: string) => ({ type: "text", text, styles: {} });

describe("extractPlainText", () => {
  it("joins the text of every block, children included, with single spaces", () => {
    const blocks = [
      { type: "heading", content: [t("Install")], children: [] },
      { type: "bulletListItem", content: [t("one")], children: [{ type: "bulletListItem", content: [t("nested")] }] },
    ];
    expect(extractPlainText(blocks)).toBe("Install one nested");
  });

  it("reads links and table cells, in both cell shapes", () => {
    const blocks = [
      { type: "paragraph", content: [t("See "), { type: "link", href: "x", content: [t("the docs")] }] },
      { type: "table", content: { type: "tableContent", rows: [{ cells: [{ type: "tableCell", content: [t("A")], props: {} }, [t("B")]] }] } },
    ];
    expect(extractPlainText(blocks)).toBe("See the docs A B");
  });

  it("tolerates anything that is not a document", () => {
    for (const input of [null, undefined, "x", 4, {}, [null, 1, "a"], [{ content: 5 }]]) expect(extractPlainText(input)).toBe("");
  });
});
