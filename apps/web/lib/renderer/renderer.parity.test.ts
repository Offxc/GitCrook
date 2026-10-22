import { describe, expect, it } from "vitest";
import { gitCrookSchema } from "@/lib/editor/schema";
import { RENDERED_BLOCK_TYPES } from "./blockRenderer";

// The editor and the published renderer must agree on every block. This is the check that was
// missing when quotes, video and audio rendered as nothing on the published site: a block added to
// the editor schema without a renderer case now fails here, in CI, instead of in front of readers.
describe("editor schema ↔ published renderer", () => {
  const editorTypes = Object.keys(gitCrookSchema.blockSpecs);

  it("has a renderer case for every block the editor can produce", () => {
    const missing = editorTypes.filter((type) => !(RENDERED_BLOCK_TYPES as readonly string[]).includes(type));
    expect(missing).toEqual([]);
  });

  it("does not claim to render blocks the editor no longer has", () => {
    const stale = (RENDERED_BLOCK_TYPES as readonly string[]).filter((type) => !editorTypes.includes(type));
    expect(stale).toEqual([]);
  });

  it("is not vacuous: the editor really does define the blocks we expect", () => {
    expect(editorTypes).toEqual(expect.arrayContaining(["paragraph", "heading", "quote", "video", "audio", "table", "hint", "columnList"]));
  });
});
