import { describe, expect, it } from "vitest";
import { parseRepositoryInput, parseRootDir, validBranch, validOwner, validRepo } from "./input";

describe("parseRepositoryInput", () => {
  it.each([
    ["acme/docs", { owner: "acme", repo: "docs" }],
    ["  acme/docs  ", { owner: "acme", repo: "docs" }],
    ["https://github.com/acme/docs", { owner: "acme", repo: "docs" }],
    ["https://github.com/acme/docs/", { owner: "acme", repo: "docs" }],
    ["https://github.com/acme/docs.git", { owner: "acme", repo: "docs" }],
    ["http://GitHub.com/Acme/Docs?tab=readme#top", { owner: "Acme", repo: "Docs" }],
    ["git@github.com:acme/docs.git", { owner: "acme", repo: "docs" }],
    ["ssh://git@github.com/acme/docs.git", { owner: "acme", repo: "docs" }],
    ["acme/my.docs_v2", { owner: "acme", repo: "my.docs_v2" }],
    ["https://github.com/acme/docs/tree/main", { owner: "acme", repo: "docs", branch: "main" }],
    ["https://github.com/acme/docs/tree/main/site/content", { owner: "acme", repo: "docs", branch: "main", rootDir: "site/content" }],
    ["https://github.com/acme/docs/tree/release%2F1.0", { owner: "acme", repo: "docs", branch: "release/1.0" }],
  ])("reads %s", (input, expected) => {
    expect(parseRepositoryInput(input)).toEqual({ ok: true, value: expected });
  });

  it("reads a Server's host when told it", () => {
    expect(parseRepositoryInput("https://ghe.example.com/acme/docs", "ghe.example.com")).toEqual({ ok: true, value: { owner: "acme", repo: "docs" } });
    expect(parseRepositoryInput("https://github.com/acme/docs", "ghe.example.com")).toMatchObject({ ok: false });
  });

  it.each([
    "",
    "   ",
    "docs",
    "acme/",
    "/docs",
    "https://gitlab.com/acme/docs",
    "https://evil.example/acme/docs",
    "https://github.com/acme",
    "https://github.com/acme/docs/blob/main/README.md",
    "https://github.com/acme/docs/issues/4",
    "acme/docs/extra",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "-acme/docs",
    "ac me/docs",
    "acme/do cs",
    "acme/../docs",
    "acme/..",
    "https://github.com/acme/docs/tree/ma..in",
    "https://github.com/acme/docs/tree/main/../../x",
    "x".repeat(600),
  ])("refuses %j", (input) => {
    expect(parseRepositoryInput(input)).toMatchObject({ ok: false });
  });

  it("explains itself", () => {
    expect(parseRepositoryInput("https://gitlab.com/acme/docs")).toEqual({ ok: false, error: "Only repositories on github.com can be connected." });
  });
});

describe("names", () => {
  it.each(["a", "acme", "Acme-Corp", "a1", "x".repeat(39)])("accepts the owner %s", (o) => expect(validOwner(o)).toBe(true));
  it.each(["", "-a", "a-", "a--b", "a_b", "a.b", "a b", "x".repeat(40), "a/b"])("refuses the owner %j", (o) => expect(validOwner(o)).toBe(false));
  it.each(["docs", "my.docs", "a_b-c", ".github", "x".repeat(100)])("accepts the repository %s", (r) => expect(validRepo(r)).toBe(true));
  it.each(["", ".", "..", "a b", "a/b", "docs.git", "x".repeat(101), "a?b", "a#b"])("refuses the repository %j", (r) => expect(validRepo(r)).toBe(false));
  it.each(["main", "release/1.0", "feature/x_y-z", "v1.2.3", "a"])("accepts the branch %s", (b) => expect(validBranch(b)).toBe(true));
  it.each(["", "-x", "/x", "x/", "x.", "x.lock", "a..b", "a//b", "a/.b", "a@{b", "a b", "a~b", "a^b", "a:b", "a\\b", "a?b", "x".repeat(201), "ü"])("refuses the branch %j", (b) => expect(validBranch(b)).toBe(false));
});

describe("parseRootDir", () => {
  it.each([
    ["", ""],
    ["  ", ""],
    [".", ""],
    ["./", ""],
    ["/", ""],
    ["docs", "docs"],
    ["./docs/", "docs"],
    ["/site/content/", "site/content"],
  ])("%j → %j", (input, expected) => expect(parseRootDir(input)).toEqual({ ok: true, value: expected }));

  it.each(["..", "../x", "a/../../b", "a\\b", "docs/\u0000", "x".repeat(301)])("refuses %j", (input) => expect(parseRootDir(input)).toMatchObject({ ok: false }));
});
