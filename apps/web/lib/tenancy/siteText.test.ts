import { describe, expect, it } from "vitest";
import { markdownUrl, renderLlmsFull, renderLlmsIndex, renderPageMarkdown } from "./siteText";

describe("renderLlmsIndex", () => {
  it("is the site name, a summary, and links grouped under headings", () => {
    const text = renderLlmsIndex({
      siteName: "Acme Docs",
      summary: "Everything about Acme.",
      sections: [
        {
          heading: "Guides",
          entries: [
            { title: "Install", description: "Get it running.", url: "https://x.test/acme/guides/install.md", children: [] },
            {
              title: "Setup",
              description: null,
              url: null,
              children: [{ title: "Configure", description: null, url: "https://x.test/acme/guides/setup/configure.md", children: [] }],
            },
          ],
        },
        { heading: "API", entries: [{ title: "Auth", description: null, url: "https://x.test/acme/api/auth.md", children: [] }] },
      ],
    });
    expect(text).toBe(
      [
        "# Acme Docs",
        "",
        "> Everything about Acme.",
        "",
        "## Guides",
        "",
        "- [Install](https://x.test/acme/guides/install.md): Get it running.",
        "- Setup",
        "  - [Configure](https://x.test/acme/guides/setup/configure.md)",
        "",
        "## API",
        "",
        "- [Auth](https://x.test/acme/api/auth.md)",
        "",
      ].join("\n"),
    );
  });

  it("uses a neutral heading when the site has no sections to name, and skips empty ones", () => {
    const text = renderLlmsIndex({
      siteName: "Docs",
      sections: [
        { heading: null, entries: [{ title: "Home", description: null, url: "https://x.test/d/home.md", children: [] }] },
        { heading: "Empty", entries: [] },
      ],
    });
    expect(text).toContain("## Pages");
    expect(text).not.toContain("Empty");
    expect(text).not.toContain("> ");
  });

  it("cannot be broken out of by a title or description", () => {
    const text = renderLlmsIndex({
      siteName: "A\n# injected",
      sections: [{ heading: "H\n## two", entries: [{ title: "Bad ]( evil ) [x", description: "line one\n\n- [fake](http://evil.test)", url: "https://x.test/p.md", children: [] }] }],
    });
    // Only the one H1 and one H2, and the title's brackets are escaped.
    expect(text.match(/^# /gm)).toHaveLength(1);
    expect(text.match(/^## /gm)).toHaveLength(1);
    expect(text).toContain("[Bad \\]( evil ) \\[x](https://x.test/p.md)");
    expect(text.split("\n").filter((l) => l.startsWith("- ["))).toHaveLength(1);
  });
});

describe("renderPageMarkdown", () => {
  it("puts the title and description above the body", () => {
    expect(renderPageMarkdown({ title: "Install", description: "Get going.", body: "Some **text**." })).toBe("# Install\n\n> Get going.\n\nSome **text**.\n");
  });

  it("does not repeat a title the body already opens with", () => {
    expect(renderPageMarkdown({ title: "Install", body: "# Install\n\nText." })).toBe("# Install\n\nText.\n");
    expect(renderPageMarkdown({ title: "C++ (v2)", body: "# C++ (v2)\n\nText." })).toBe("# C++ (v2)\n\nText.\n");
  });

  it("still adds the title when the body opens with a different heading or a longer one", () => {
    expect(renderPageMarkdown({ title: "Install", body: "# Installing on Linux\n\nText." })).toBe("# Install\n\n# Installing on Linux\n\nText.\n");
  });

  it("copes with an empty body", () => {
    expect(renderPageMarkdown({ title: "Empty", body: "  " })).toBe("# Empty\n");
  });
});

describe("renderLlmsFull", () => {
  const pages = [
    { title: "A", url: "https://x.test/a.md", markdown: "# A\n\nalpha" },
    { title: "B", url: "https://x.test/b.md", markdown: "# B\n\nbeta" },
    { title: "C", url: "https://x.test/c.md", markdown: "# C\n\ngamma" },
  ];

  it("concatenates the pages with their sources", () => {
    const text = renderLlmsFull({ siteName: "Docs", pages, maxChars: 10_000, indexUrl: "https://x.test/llms.txt" });
    expect(text.startsWith("# Docs\n")).toBe(true);
    expect(text).toContain("Source: https://x.test/a.md\n\n# A\n\nalpha");
    expect(text).toContain("Source: https://x.test/c.md\n\n# C\n\ngamma");
    expect(text).not.toContain("stops after");
  });

  it("stops between pages when it runs out of room, and says so", () => {
    const text = renderLlmsFull({ siteName: "Docs", pages, maxChars: 70, indexUrl: "https://x.test/llms.txt" });
    expect(text).toContain("alpha");
    expect(text).not.toContain("gamma");
    expect(text).toMatch(/stops after 1 of 3 pages/);
    expect(text).toContain("https://x.test/llms.txt");
  });

  it("reports the real total when the caller stopped reading pages early", () => {
    const text = renderLlmsFull({ siteName: "Docs", pages: pages.slice(0, 1), totalPages: 40, maxChars: 10_000, indexUrl: "https://x.test/llms.txt" });
    expect(text).toMatch(/stops after 1 of 40 pages/);
  });

  it("always includes the first page, however large", () => {
    const text = renderLlmsFull({ siteName: "Docs", pages: [{ title: "A", url: "https://x.test/a.md", markdown: "x".repeat(500) }], maxChars: 10, indexUrl: "u" });
    expect(text).toContain("x".repeat(500));
  });
});

describe("markdownUrl", () => {
  it("appends .md to the page path and encodes each segment", () => {
    expect(markdownUrl("https://x.test/acme", ["guides", "install"])).toBe("https://x.test/acme/guides/install.md");
    expect(markdownUrl("https://x.test", ["a b", "c"])).toBe("https://x.test/a%20b/c.md");
  });
});
