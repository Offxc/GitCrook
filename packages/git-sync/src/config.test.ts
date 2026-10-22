import { describe, expect, it } from "vitest";
import { editUrl, hostConfigFromEnv } from "./config";

describe("hostConfigFromEnv", () => {
  it("defaults to github.com", () => {
    expect(hostConfigFromEnv({})).toEqual({ apiBase: "https://api.github.com", allowedHosts: ["api.github.com"], webBase: "https://github.com" });
  });

  it("follows a GitHub Enterprise Server", () => {
    expect(hostConfigFromEnv({ GITHUB_API_URL: "https://ghe.example.com/api/v3/" })).toEqual({ apiBase: "https://ghe.example.com/api/v3", allowedHosts: ["ghe.example.com"], webBase: "https://ghe.example.com" });
  });

  it("lets the operator widen the list of hosts, and nobody else", () => {
    expect(hostConfigFromEnv({ GIT_SYNC_ALLOWED_HOSTS: " api.github.com , uploads.example.com ," }).allowedHosts).toEqual(["api.github.com", "uploads.example.com"]);
  });

  it("refuses an API address that is not a URL", () => {
    expect(() => hostConfigFromEnv({ GITHUB_API_URL: "not a url" })).toThrow();
  });
});

describe("editUrl", () => {
  const source = { owner: "acme", repo: "docs", branch: "main", rootDir: "" };

  it("points at the file on the branch", () => {
    expect(editUrl("https://github.com", source, "guides/install.md")).toBe("https://github.com/acme/docs/edit/main/guides/install.md");
  });

  it("includes the docs directory", () => {
    expect(editUrl("https://github.com", { ...source, rootDir: "site/docs" }, "a.md")).toBe("https://github.com/acme/docs/edit/main/site/docs/a.md");
  });

  it("encodes what needs it, and keeps slashes in a branch name", () => {
    expect(editUrl("https://github.com", { ...source, branch: "release/1.0" }, "my page #1.md")).toBe("https://github.com/acme/docs/edit/release/1.0/my%20page%20%231.md");
  });

  it("returns nothing for an owner, repository or path that could change the address", () => {
    expect(editUrl("https://github.com", { ...source, owner: "a/b" }, "a.md")).toBeNull();
    expect(editUrl("https://github.com", { ...source, repo: "x?y" }, "a.md")).toBeNull();
    expect(editUrl("https://github.com", source, "../../secret.md")).toBeNull();
  });
});
