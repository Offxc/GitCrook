import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePushEvent, verifyGitHubSignature } from "./webhook";

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const bytes = (s: string) => new TextEncoder().encode(s);

describe("verifyGitHubSignature", () => {
  const secret = "s3cret-value";
  const body = '{"zen":"Keep it logically awesome."}';

  it("accepts the right signature", () => {
    expect(verifyGitHubSignature(secret, bytes(body), sign(secret, body))).toBe(true);
  });

  it("accepts the hex in either case and ignores surrounding whitespace", () => {
    expect(verifyGitHubSignature(secret, bytes(body), ` ${sign(secret, body).toUpperCase().replace("SHA256", "sha256")} `)).toBe(true);
  });

  it("rejects a body that was changed by a single byte", () => {
    expect(verifyGitHubSignature(secret, bytes(`${body} `), sign(secret, body))).toBe(false);
  });

  it("rejects another secret, and an empty one", () => {
    expect(verifyGitHubSignature("other", bytes(body), sign(secret, body))).toBe(false);
    expect(verifyGitHubSignature("", bytes(body), sign("", body))).toBe(false);
  });

  it.each([null, undefined, "", "sha256=", "sha256=abc", `sha1=${"a".repeat(40)}`, `sha256=${"g".repeat(64)}`, `sha256=${"a".repeat(63)}`, `sha256=${"a".repeat(65)}`, "garbage"])("rejects the header %j", (header) => {
    expect(verifyGitHubSignature(secret, bytes(body), header)).toBe(false);
  });

  it("covers the raw bytes, not a re-serialisation of them", () => {
    const spaced = '{ "a" : 1 }';
    expect(verifyGitHubSignature(secret, bytes(spaced), sign(secret, '{"a":1}'))).toBe(false);
    expect(verifyGitHubSignature(secret, bytes(spaced), sign(secret, spaced))).toBe(true);
  });
});

describe("parsePushEvent", () => {
  const push = (over: Record<string, unknown> = {}) => ({ ref: "refs/heads/main", after: "a".repeat(40), deleted: false, repository: { name: "docs", owner: { login: "acme" } }, ...over });

  it("reads a push to a branch", () => {
    expect(parsePushEvent(push())).toEqual({ owner: "acme", repo: "docs", branch: "main", after: "a".repeat(40), deleted: false });
  });

  it("keeps slashes in a branch name", () => {
    expect(parsePushEvent(push({ ref: "refs/heads/release/1.0" }))!.branch).toBe("release/1.0");
  });

  it("reads the owner from `name` for organisation-less payloads", () => {
    expect(parsePushEvent(push({ repository: { name: "docs", owner: { name: "acme" } } }))!.owner).toBe("acme");
  });

  it("notes a deleted branch", () => {
    expect(parsePushEvent(push({ deleted: true, after: "0".repeat(40) }))).toMatchObject({ deleted: true });
  });

  it("drops a commit id that is not one", () => {
    expect(parsePushEvent(push({ after: "not-a-sha" }))!.after).toBe("");
  });

  it.each([null, undefined, "x", 4, [], {}, push({ ref: "refs/tags/v1" }), push({ ref: 5 }), push({ repository: null }), push({ repository: { name: "docs" } }), push({ repository: { owner: { login: "acme" } } })])("returns null for %j", (value) => {
    expect(parsePushEvent(value)).toBeNull();
  });
});
