import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitizeSvg";

const ok = (svg: string) => {
  const r = sanitizeSvg(svg);
  if (!r.ok) throw new Error(r.error);
  return r.svg;
};
const wrap = (inner: string, attrs = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe("what is kept", () => {
  it("keeps an ordinary drawing", () => {
    const svg = ok(wrap('<g transform="translate(1 2)"><rect x="1" y="2" width="3" height="4" fill="#f00" stroke="black" stroke-width="2"/><circle cx="5" cy="5" r="2"/><path d="M0 0L10 10"/></g>'));
    expect(svg).toContain('<rect x="1" y="2" width="3" height="4" fill="#f00" stroke="black" stroke-width="2"></rect>');
    expect(svg).toContain('<path d="M0 0L10 10"></path>');
    expect(svg).toContain('<g transform="translate(1 2)">');
  });

  it("keeps text, gradients, markers, clip paths and local references", () => {
    const svg = ok(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath><marker id="m" markerWidth="2" markerHeight="2"><path d="M0 0"/></marker></defs>' +
          '<rect fill="url(#g)" clip-path="url(#c)" marker-end="url(#m)" width="9" height="9"/><text x="1" y="2">Hello <tspan font-weight="bold">there</tspan></text><use href="#c"/>',
      ),
    );
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain("Hello <tspan");
    expect(svg).toContain('<use href="#c">');
  });

  it("keeps a plain stylesheet", () => {
    const svg = ok(wrap(".a { fill: red; stroke: #000 } .b { opacity: .5 }<rect class=\"a\" width=\"1\" height=\"1\"/>".replace(/^(.*?)<rect/, "<style>$1</style><rect")));
    expect(svg).toContain("<style>.a { fill: red; stroke: #000 } .b { opacity: .5 }</style>");
  });

  it("always declares the SVG namespace, whatever the input said", () => {
    expect(ok('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>')).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
  });

  it("reads the size from width and height, or from the viewBox", () => {
    expect(sanitizeSvg(wrap("", 'width="24" height="12px"'))).toMatchObject({ ok: true, width: 24, height: 12 });
    expect(sanitizeSvg(wrap("", 'viewBox="0 0 100 50"'))).toMatchObject({ ok: true, width: 100, height: 50 });
    expect(sanitizeSvg(wrap("", 'width="50%"'))).toMatchObject({ ok: true, width: null, height: null });
  });

  it("accepts an XML declaration, comments and a processing instruction before the root", () => {
    expect(sanitizeSvg(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by a tool -->\n${wrap('<rect width="1" height="1"/>')}`).ok).toBe(true);
  });

  it("accepts bytes", () => {
    expect(sanitizeSvg(new TextEncoder().encode(wrap('<rect width="1" height="1"/>'))).ok).toBe(true);
  });

  it("escapes text and attribute values on the way out", () => {
    const svg = ok(wrap('<text id="a&quot;b">1 &lt; 2 &amp; 3</text>'));
    expect(svg).toContain('id="a&quot;b"');
    expect(svg).toContain("1 &lt; 2 &amp; 3");
  });
});

describe("what is removed", () => {
  const without = (input: string, ...banned: RegExp[]) => {
    const svg = ok(input);
    for (const b of banned) expect(svg).not.toMatch(b);
    return svg;
  };

  it("scripts, in any case and with any namespace prefix", () => {
    without(wrap('<script>alert(1)</script><SCRIPT>alert(2)</SCRIPT><sCrIpT>alert(3)</sCrIpT><svg:script>alert(4)</svg:script><rect width="1" height="1"/>'), /script/i, /alert/);
  });

  it("event handler attributes", () => {
    const svg = without(wrap('<rect width="1" height="1" onclick="alert(1)" onmouseover="x()" onload="y()"/>', 'viewBox="0 0 1 1" onload="alert(1)"'), /on\w+=/i, /alert/);
    expect(svg).toContain("<rect");
  });

  it("foreignObject and the HTML inside it, even when it contains an SVG", () => {
    without(wrap('<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"/></body><svg><script>x()</script></svg></foreignObject>'), /foreignObject/i, /iframe/i, /script/i, /body/i);
  });

  it("everything inside an element that is dropped, even allowed elements", () => {
    const svg = without(wrap('<foreignObject><rect id="inside" width="1" height="1"/></foreignObject><rect id="outside" width="1" height="1"/>'), /inside/);
    expect(svg).toContain("outside");
  });

  it("animation that can set an attribute to a script URL", () => {
    without(wrap('<a><animate attributeName="href" values="javascript:alert(1)"/></a><set attributeName="href" to="javascript:alert(1)"/><animateTransform/><animateMotion/><rect width="1" height="1"/>'), /animate/i, /set/i, /javascript/i);
  });

  it("links: <a> and <image> are not kept, whatever they point at", () => {
    without(wrap('<a href="javascript:alert(1)"><text>click</text></a><a xlink:href="https://evil.example"><rect width="1" height="1"/></a><image href="https://evil.example/x.png" width="1" height="1"/><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'), /<a[ >]/, /<image/, /evil/, /javascript/);
  });

  it("<use> that points outside the document, and every external reference", () => {
    const svg = without(
      wrap('<use href="https://evil.example/x.svg#a"/><use xlink:href="//evil.example/x.svg#a"/><use href="data:image/svg+xml,&lt;svg/&gt;"/><use/><use href="#local"/>'),
      /evil/,
      /data:/,
    );
    expect(svg).toContain('<use href="#local">');
    expect(svg.match(/<use/g)).toHaveLength(1);
  });

  it("url() that is not a local reference, in attributes and in styles", () => {
    without(wrap('<rect fill="url(https://evil.example/x)" width="1" height="1" style="fill:url(http://evil.example)"/><rect style="background:url(javascript:alert(1))" width="1" height="1"/>'), /evil/, /javascript/);
  });

  it("@import, expressions, escapes and other ways a stylesheet can fetch or hide something", () => {
    for (const css of ["@import url(//evil.example/x.css);", "a{background:url(//evil.example)}", "a{width:expression(alert(1))}", "a{behavior:url(x.htc)}", "a{-moz-binding:url(x)}", "a{c\\6frlor:red}", "a{}</style><script>alert(1)</script>"]) {
      const svg = ok(wrap(`<style>${css.replace(/</g, "&lt;")}</style><rect width="1" height="1"/>`));
      expect(svg, css).not.toContain("<style>");
      expect(svg).not.toMatch(/evil|expression|moz-binding|behavior/);
    }
    const attr = ok(wrap('<rect width="1" height="1" style="fill:red;behavior:url(x.htc)"/>'));
    expect(attr).not.toContain("behavior");
  });

  it("javascript:, vbscript: and data: wherever they are written, including with escapes and odd case", () => {
    for (const bad of ["JaVaScRiPt:alert(1)", "java&#x73;cript:alert(1)", "&#106;avascript:alert(1)", "vbscript:x", "data:text/html,x"]) {
      const svg = ok(wrap(`<rect width="1" height="1" fill="${bad}" id="${bad}"/>`));
      expect(svg, bad).not.toMatch(/script|data:|&#/i);
    }
  });

  it("DTDs and entity declarations, and does not expand them", () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaaaaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&c;&c;&c;&c;</text></svg>';
    const svg = ok(bomb);
    expect(svg.length).toBeLessThan(500);
    expect(svg).not.toContain("DOCTYPE");
    expect(svg).not.toContain("ENTITY");
    const xxe = ok('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>');
    expect(xxe).not.toContain("root:");
  });

  it("unknown elements, and attributes that are not on the list", () => {
    const svg = without(wrap('<metadata><x/></metadata><mystery foo="1"/><rect width="1" height="1" data-x="1" aria-label="a" tabindex="0" xml:base="http://evil.example/"/>'), /metadata/, /mystery/, /data-x/, /tabindex/, /evil/);
    expect(svg).toContain("<rect");
  });

  it("drops filter settings that would make a browser do unbounded work, and keeps sensible ones", () => {
    const heavy = without(wrap('<filter id="f"><feGaussianBlur stdDeviation="100000"/><feMorphology radius="9999"/><feTurbulence numOctaves="500" baseFrequency="0.05"/></filter>'), /100000/, /9999/, /500/);
    expect(heavy).toContain("<feGaussianBlur");
    const fine = wrap('<filter id="f"><feGaussianBlur stdDeviation="4 6"/><feMorphology radius="3"/><feTurbulence numOctaves="3" baseFrequency="0.05"/></filter>');
    const result = sanitizeSvg(Buffer.from(fine));
    expect(result.ok && result.svg).toContain('stdDeviation="4 6"');
    expect(result.ok && result.svg).toContain('radius="3"');
    expect(result.ok && result.svg).toContain('numOctaves="3"');
  });

  it("filters that could load an image", () => {
    without(wrap('<filter id="f"><feImage href="https://evil.example/x.png"/><feGaussianBlur stdDeviation="2"/></filter>'), /feImage/, /evil/);
  });
});

describe("what is refused outright", () => {
  const fails = (input: string, pattern: RegExp) => {
    const r = sanitizeSvg(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(pattern);
  };

  it("something that is not an SVG", () => {
    fails("<html><body>hi</body></html>", /not an SVG/);
    fails("hello", /not an SVG/);
    fails("", /not an SVG/);
    fails("<rect width='1'/>", /not an SVG/);
  });

  it("two roots", () => {
    fails(`${wrap("")}${wrap("")}`, /one root/);
  });

  it("a document that is too big, too deep or has too many elements", () => {
    fails(wrap(`<g>${" ".repeat(2_100_000)}</g>`), /too large/);
    fails(wrap("<g>".repeat(150) + "</g>".repeat(150)), /too deeply/);
    fails(wrap('<g/>'.repeat(60_000)), /too many/);
  });

  it("a huge attribute is dropped rather than copied", () => {
    const svg = ok(wrap(`<path d="${"M0 0 ".repeat(120_000)}" id="p"/>`));
    expect(svg).toContain('id="p"');
    expect(svg).not.toContain("M0 0");
  });
});

describe("whatever the input is", () => {
  it("the output never contains anything the allow-list does not name", () => {
    const hostile = [
      '<svg onload="alert(1)"><script>alert(1)</script></svg>',
      '<svg><a href="javascript:alert(1)">x</a></svg>',
      '<svg><g onclick="x"><foreignObject><div>hi</div></foreignObject></g></svg>',
      '<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="http://evil/x.svg#a"/></svg>',
      '<svg><![CDATA[<script>alert(1)</script>]]></svg>',
      '<svg><text><![CDATA[<script>alert(1)</script>]]></text></svg>',
      "<svg><style><![CDATA[@import 'x';]]></style></svg>",
    ];
    for (const input of hostile) {
      const r = sanitizeSvg(input);
      if (!r.ok) continue;
      expect(r.svg, input).not.toMatch(/<script|<a[ >]|foreignObject|onload|onclick|javascript|evil|@import/i);
      // And what comes out is itself stable under sanitising.
      const again = sanitizeSvg(r.svg);
      expect(again.ok && again.svg, input).toBe(r.svg);
    }
  });

  it("never leaves an element open or closed that it did not write", () => {
    for (const css of ["@import url(//evil.example/x.css);", "a{c\\6frlor:red}"]) {
      const r = sanitizeSvg(wrap(`<style>${css}</style><rect width="1" height="1"/>`));
      expect(r.ok && r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><rect width="1" height="1"></rect></svg>');
    }
    const nested = sanitizeSvg(wrap('<style>a{fill:red}<rect id="smuggled" width="1" height="1"/></style>'));
    expect(nested.ok && nested.svg).not.toContain("smuggled");
  });

  it("text that looks like markup stays text", () => {
    const r = sanitizeSvg(wrap("<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>"));
    expect(r.ok && r.svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.ok && r.svg).not.toContain("<script");
  });

  it("never throws on garbage", () => {
    for (const junk of ["<", "<svg", "<svg>", "</svg>", "<svg><g></svg>", "\u0000", "<svg>\u0000</svg>", "<<svg>>", "<svg a=>", `<svg a="${"x".repeat(10)}`]) {
      expect(() => sanitizeSvg(junk)).not.toThrow();
    }
  });
});

describe("fuzzing", async () => {
  const fc = (await import("fast-check")).default;
  const allowedTags = new Set(["svg", "g", "defs", "symbol", "use", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker", "style", "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feMerge", "feMergeNode", "feDropShadow", "feMorphology", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feFuncA", "feTurbulence", "feDisplacementMap"]);

  const pieces = [
    "<svg>", "</svg>", "<svg viewBox='0 0 1 1' onload='x()'>", "<g>", "</g>", "<rect width='1' height='1'/>", "<script>alert(1)</script>", "<SCRIPT>", "</script>",
    "<a href='javascript:alert(1)'>", "</a>", "<use href='#a'/>", "<use href='http://e/x.svg#a'/>", "<image href='http://e/x.png'/>", "<foreignObject>", "</foreignObject>",
    "<style>", "</style>", "a{fill:red}", "@import 'x';", "url(http://e)", "url(#a)", "<text>", "</text>", "hello", "&lt;", "&amp;", "&#x6a;avascript:", "&c;", "]]>", "<![CDATA[", "<!--", "-->",
    "<!DOCTYPE svg [<!ENTITY x 'y'>]>", "<?xml version='1.0'?>", "<animate attributeName='href' values='javascript:x'/>", "<set to='x'/>", " onclick='x()' ", "<g onclick='x'>", "'", '"', "<", ">", "=", "\u0000", "\\",
  ];
  const soup = fc.array(fc.constantFrom(...pieces), { maxLength: 40 }).map((p) => p.join(""));

  it("always produces either an error or a document made only of allowed things", () => {
    fc.assert(
      fc.property(soup, (input) => {
        const r = sanitizeSvg(input);
        if (!r.ok) return;
        // Tags and stylesheets are checked strictly. Text content is only text: it may say anything, but it is escaped.
        const tags = [...r.svg.matchAll(/<[^>]*>/g)].map((m) => m[0]);
        for (const tag of tags) {
          const name = /^<\/?([A-Za-z][\w:-]*)/.exec(tag)?.[1];
          expect(name !== undefined && allowedTags.has(name), `${tag} in ${r.svg}`).toBe(true);
          expect(tag).not.toMatch(/\bon[a-z]+\s*=/i);
          expect(tag).not.toMatch(/javascript:|vbscript:|data:|&#/i);
          for (const m of tag.matchAll(/url\(([^)]*)\)/gi)) expect(m[1]!.trim().replace(/^['"]/, "").startsWith("#"), tag).toBe(true);
        }
        for (const m of r.svg.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
          expect(m[1]).not.toMatch(/@import|javascript:|expression|\\|<|data:/i);
          for (const u of m[1]!.matchAll(/url\(([^)]*)\)/gi)) expect(u[1]!.trim().replace(/^['"]/, "").startsWith("#")).toBe(true);
        }
        const text = r.svg.replace(/<[^>]*>/g, "");
        expect(text).not.toMatch(/[<]/);
        expect(r.svg).not.toMatch(/<script|<!\[CDATA|<!DOCTYPE|<!ENTITY|<\?xml/i);
        // Running it again changes nothing: what was written is something it would write.
        const again = sanitizeSvg(r.svg);
        expect(again.ok && again.svg).toBe(r.svg);
      }),
      { numRuns: Number(process.env.FC_RUNS) || 600 },
    );
  });
});
