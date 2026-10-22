import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processAsset } from "./process";

const canvas = (format: "png" | "jpeg" | "webp" | "gif", opts: { exif?: boolean; width?: number; height?: number } = {}) => {
  let img = sharp({ create: { width: opts.width ?? 4, height: opts.height ?? 3, channels: 3, background: { r: 200, g: 30, b: 30 } } });
  if (opts.exif) img = img.withExif({ IFD0: { Copyright: "SECRET-OWNER", ImageDescription: "private" } });
  return img.toFormat(format).toBuffer();
};
const text = (s: string) => new TextEncoder().encode(s);

describe("images", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)("re-encodes %s and reports its size", async (format) => {
    const result = await processAsset(await canvas(format, { width: 7, height: 5 }), { filename: `x.${format}` });
    expect(result).toMatchObject({ ok: true, kind: "IMAGE", mime: `image/${format}`, width: 7, height: 5 });
  });

  it("strips metadata", async () => {
    const source = await canvas("jpeg", { exif: true });
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await processAsset(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sharp(result.bytes).metadata()).exif).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("SECRET-OWNER"))).toBe(false);
  });

  it("never stores the sender's bytes: a payload appended to an image is gone", async () => {
    const png = await canvas("png");
    const polyglot = Buffer.concat([png, Buffer.from("<script>alert(1)</script><!--GIF89a-->")]);
    const result = await processAsset(polyglot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.includes(Buffer.from("<script>"))).toBe(false);
  });

  it("trusts the bytes, not the name: an HTML file called .png is refused", async () => {
    const result = await processAsset(text("<html><script>alert(1)</script></html>"), { filename: "photo.png" });
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("refuses an image that only claims to be one, or that is damaged", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a png")]);
    expect(await processAsset(fake)).toMatchObject({ ok: false });
    const damaged = Buffer.from(await canvas("png", { width: 40, height: 40 }));
    damaged.fill(0x41, 40, damaged.length - 12); // header intact, image data destroyed
    expect(await processAsset(damaged)).toMatchObject({ ok: false, status: 422 });
  });

  it("applies the size limit", async () => {
    const result = await processAsset(await canvas("png", { width: 50, height: 50 }), {}, { maxImageBytes: 100, maxFileBytes: 100 });
    expect(result).toMatchObject({ ok: false, status: 413 });
  });
});

describe("svg", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><script>alert(1)</script><rect width="20" height="10" onclick="x()"/></svg>';

  it("is rebuilt, not copied, and reported as an image", async () => {
    const result = await processAsset(text(svg), { filename: "diagram.svg" });
    expect(result).toMatchObject({ ok: true, kind: "IMAGE", mime: "image/svg+xml", extension: "svg", width: 20, height: 10 });
    if (!result.ok) return;
    const out = result.bytes.toString("utf8");
    expect(out).toContain("<rect");
    expect(out).not.toMatch(/script|onclick|alert/);
  });

  it("is refused when it is not an SVG, whatever its name", async () => {
    expect(await processAsset(text("<html></html>"), { filename: "x.svg" })).toMatchObject({ ok: false, status: 422 });
    expect(await processAsset(text("hello"), { filename: "x.svg" })).toMatchObject({ ok: false, status: 422 });
  });

  it("is only looked for when the name says so", async () => {
    expect(await processAsset(text(svg), { filename: "diagram.png" })).toMatchObject({ ok: false, status: 415 });
    expect(await processAsset(text(svg))).toMatchObject({ ok: false, status: 415 });
  });
});

describe("other files", () => {
  const pdf = text("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

  it("keeps a PDF as it is", async () => {
    const result = await processAsset(pdf, { filename: "spec.pdf" });
    expect(result).toMatchObject({ ok: true, kind: "FILE", mime: "application/pdf", extension: "pdf" });
    if (result.ok) expect(result.bytes.equals(Buffer.from(pdf))).toBe(true);
  });

  it.each([
    ["notes.txt", "plain text\nwith lines", "text/plain"],
    ["data.csv", "a,b\n1,2\n", "text/csv"],
    ["config.json", '{"a":1}', "application/json"],
  ])("accepts %s as text", async (name, body, mime) => {
    expect(await processAsset(text(body), { filename: name })).toMatchObject({ ok: true, kind: "FILE", mime });
  });

  it("refuses binary data that is called text", async () => {
    expect(await processAsset(new Uint8Array([0, 1, 2, 3, 255]), { filename: "x.txt" })).toMatchObject({ ok: false, status: 415 });
    expect(await processAsset(new Uint8Array([0xff, 0xfe, 0xfd]), { filename: "x.csv" })).toMatchObject({ ok: false, status: 415 });
  });

  it("needs a name to treat bytes as text", async () => {
    expect(await processAsset(text("plain"))).toMatchObject({ ok: false, status: 415 });
  });

  it.each(["tool.exe", "page.html", "script.js", "archive.tar", "x.bin"])("refuses %s", async (name) => {
    expect(await processAsset(text("MZ whatever"), { filename: name })).toMatchObject({ ok: false, status: 415 });
  });

  it("applies the file size limit", async () => {
    expect(await processAsset(pdf, { filename: "a.pdf" }, { maxImageBytes: 10, maxFileBytes: 10 })).toMatchObject({ ok: false, status: 413 });
  });
});
