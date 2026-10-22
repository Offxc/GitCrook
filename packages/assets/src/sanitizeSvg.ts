import { Parser } from "htmlparser2";

/**
 * SVG from an untrusted source (a repository, an upload) becomes a new document built only from what is known to
 * be harmless. Nothing is "cleaned": the input is read into events and the output is written out from an allow-list
 * of elements and attributes, so anything not named here — scripts, event handlers, animation that can set an
 * `href`, `foreignObject`, external references, DTDs — simply cannot appear.
 *
 * The result is also only ever shown through `<img>`, which does not run scripts, and is served with a sandboxing
 * Content-Security-Policy. This is the first of three layers, not the only one.
 */

const ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker", "style",
  // Filter primitives, minus feImage, which can load a URL.
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feMerge", "feMergeNode",
  "feDropShadow", "feMorphology", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feFuncA", "feTurbulence", "feDisplacementMap",
]);

/** Elements whose text content is kept. */
const TEXT_ELEMENTS = new Set(["text", "tspan", "textPath", "title", "desc", "style"]);

const ATTRIBUTES = new Set([
  "id", "class", "style", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
  "viewBox", "preserveAspectRatio", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit", "opacity", "offset", "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy", "fr", "clip-path", "clip-rule", "mask", "marker-start", "marker-mid", "marker-end",
  "font-family", "font-size", "font-weight", "font-style", "font-variant", "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift",
  "letter-spacing", "word-spacing", "text-decoration", "writing-mode", "direction", "visibility", "display", "overflow", "color", "filter",
  "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits",
  "maskUnits", "maskContentUnits", "dx", "dy", "rotate", "textLength", "lengthAdjust", "startOffset", "method", "spacing", "side",
  "stdDeviation", "in", "in2", "result", "mode", "type", "values", "k1", "k2", "k3", "k4", "operator", "flood-color", "flood-opacity", "tableValues",
  "slope", "intercept", "amplitude", "exponent", "radius", "scale", "xChannelSelector", "yChannelSelector", "baseFrequency", "numOctaves", "seed",
  "stitchTiles", "color-interpolation-filters", "lighting-color", "shape-rendering", "text-rendering", "vector-effect", "paint-order", "version",
  "xmlns", "xmlns:xlink", "xml:space", "href", "xlink:href",
]);

const MAX_BYTES = 2_000_000;
const MAX_ELEMENTS = 50_000;
const MAX_DEPTH = 100;
const MAX_ATTRIBUTE = 500_000;

export type SvgResult = { ok: true; svg: string; width: number | null; height: number | null } | { ok: false; error: string };

/** Allowed in a value: no script, no data, and `url()` only to something in the same document. */
function safeValue(value: string): boolean {
  if (value.length > MAX_ATTRIBUTE) return false;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
  if (/(?:java|vb)script:|data:|&#|\\/i.test(value)) return false;
  for (const m of value.matchAll(/url\s*\(\s*(['"]?)\s*([^)]*)/gi)) if (!m[2]!.startsWith("#")) return false;
  return true;
}

/** CSS in a `style` attribute or element. Anything that can fetch something, or hide a keyword behind an escape, is refused. */
function safeCss(css: string): boolean {
  return safeValue(css) && !/@import|@font-face|expression\s*\(|behaviou?r\s*:|-moz-binding|<|>/i.test(css);
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function lengthOf(value: string | undefined): number | null {
  const m = value ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value) : null;
  return m ? Number(m[1]) : null;
}

export function sanitizeSvg(input: string | Uint8Array): SvgResult {
  const source = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
  if (source.length > MAX_BYTES) return { ok: false, error: "The SVG is too large." };

  const out: string[] = [];
  const stack: { name: string; kept: boolean }[] = [];
  let skipDepth = 0; // inside a dropped element: everything below it is dropped too
  let elements = 0;
  let roots = 0;
  let rootAttrs: Record<string, string> = {};
  let failure: string | null = null;
  let styleText = "";

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (failure) return;
        if (stack.length >= MAX_DEPTH) failure = "The SVG is nested too deeply.";
        if (++elements > MAX_ELEMENTS) failure = "The SVG has too many elements.";
        if (failure) return;

        const isRoot = stack.length === 0;
        if (isRoot) {
          roots++;
          if (name !== "svg") {
            failure = "This is not an SVG file.";
            return;
          }
          rootAttrs = attribs;
        }

        // Nothing may sit inside a <style>; a stylesheet's content is its text, and only its text.
        const insideStyle = stack.at(-1)?.name === "style";
        const keep = skipDepth === 0 && ELEMENTS.has(name) && !insideStyle && (isRoot || stack.some((s) => s.kept));
        stack.push({ name, kept: keep });
        if (!keep) {
          skipDepth++;
          return;
        }

        // A <use> may only point inside its own document.
        if (name === "use") {
          const ref = attribs["href"] ?? attribs["xlink:href"];
          if (!ref || !ref.startsWith("#") || !safeValue(ref)) {
            stack[stack.length - 1]!.kept = false;
            skipDepth++;
            return;
          }
        }

        // A stylesheet is written whole when it closes, once its text has been checked; no attributes are kept on it.
        if (name === "style") return;

        const attrs: string[] = [];
        for (const [key, value] of Object.entries(attribs)) {
          if (!ATTRIBUTES.has(key)) continue;
          if (key === "xmlns" || key === "xmlns:xlink") continue; // written once, below, with known values
          if (key === "href" || key === "xlink:href") {
            if (!value.startsWith("#") || !safeValue(value)) continue;
          } else if (key === "style") {
            if (!safeCss(value)) continue;
          } else if (!safeValue(value)) continue;
          attrs.push(`${key}="${escapeAttr(value)}"`);
        }
        if (isRoot) {
          attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
          // xlink is always declared, so `xlink:href` on a <use> parses; declaring it when it is not used is harmless.
          attrs.splice(1, 0, 'xmlns:xlink="http://www.w3.org/1999/xlink"');
        }
        out.push(`<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
      },
      ontext(data) {
        if (failure || skipDepth > 0 || stack.length === 0) return;
        const top = stack[stack.length - 1]!;
        if (!top.kept || !TEXT_ELEMENTS.has(top.name)) return;
        if (top.name === "style") {
          styleText += data;
          return;
        }
        out.push(escapeText(data));
      },
      onclosetag(name) {
        if (failure) return;
        const top = stack.pop();
        if (!top) return;
        if (!top.kept) {
          skipDepth = Math.max(0, skipDepth - 1);
          return;
        }
        if (top.name === "style") {
          const css = styleText;
          styleText = "";
          // A stylesheet is all or nothing: a rule that cannot be checked is not kept.
          if (safeCss(css) && css.trim()) out.push(`<style>${escapeText(css)}</style>`);
          return;
        }
        out.push(`</${top.name}>`);
      },
      onerror(error) {
        failure ??= `The SVG could not be read: ${error.message}`;
      },
    },
    { xmlMode: true, decodeEntities: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
  );

  try {
    parser.write(source);
    parser.end();
  } catch (error) {
    return { ok: false, error: `The SVG could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (failure) return { ok: false, error: failure };
  if (roots !== 1) return { ok: false, error: roots === 0 ? "This is not an SVG file." : "An SVG has one root element." };
  // An element left open would be closed by the parser at the end of input; check we did close what we wrote.
  if (stack.length !== 0) return { ok: false, error: "The SVG is not well formed." };

  let width = lengthOf(rootAttrs["width"]);
  let height = lengthOf(rootAttrs["height"]);
  if ((width === null || height === null) && rootAttrs["viewBox"]) {
    const box = rootAttrs["viewBox"].trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite)) {
      width ??= box[2]!;
      height ??= box[3]!;
    }
  }
  return { ok: true, svg: out.join(""), width, height };
}
