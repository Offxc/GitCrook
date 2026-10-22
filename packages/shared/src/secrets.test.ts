import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretBox, SecretError, redactSecrets } from "./secrets";

const key = () => randomBytes(32);

describe("SecretBox", () => {
  it("opens what it sealed", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("ghp_exampleToken123", "credential:1");
    expect(box.open(sealed.data, sealed.keyId, "credential:1")).toBe("ghp_exampleToken123");
  });

  it("handles empty text and any Unicode", () => {
    const box = new SecretBox(key());
    for (const text of ["", "ключ 🔑 密码", "a".repeat(10_000)]) {
      const sealed = box.seal(text, "c");
      expect(box.open(sealed.data, sealed.keyId, "c")).toBe(text);
    }
  });

  it("never reveals the plaintext in what it stores", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("ghp_visibleSecretValue", "c");
    expect(sealed.data.toString("utf8")).not.toContain("visibleSecretValue");
    expect(sealed.data.toString("latin1")).not.toContain("visibleSecretValue");
  });

  it("uses a new IV every time, so equal secrets look different", () => {
    const box = new SecretBox(key());
    const blobs = new Set(Array.from({ length: 500 }, () => box.seal("same", "c").data.toString("hex")));
    expect(blobs.size).toBe(500);
    const ivs = new Set([...blobs].map((b) => b.slice(2, 26)));
    expect(ivs.size).toBe(500);
  });

  it("refuses a ciphertext moved to another context", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("secret", "credential:A");
    expect(() => box.open(sealed.data, sealed.keyId, "credential:B")).toThrow(SecretError);
  });

  it("refuses a message altered anywhere: version, IV, tag or body", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("secret value", "c");
    for (let i = 0; i < sealed.data.length; i++) {
      const copy = Buffer.from(sealed.data);
      copy[i] = copy[i]! ^ 0x01;
      expect(() => box.open(copy, sealed.keyId, "c"), `byte ${i}`).toThrow(SecretError);
    }
  });

  it("refuses truncated or empty data", () => {
    const box = new SecretBox(key());
    const sealed = box.seal("secret", "c");
    for (const length of [0, 1, 12, 28, sealed.data.length - 1]) {
      expect(() => box.open(sealed.data.subarray(0, length), sealed.keyId, "c")).toThrow(SecretError);
    }
  });

  it("refuses a different key", () => {
    const sealed = new SecretBox(key()).seal("secret", "c");
    expect(() => new SecretBox(key()).open(sealed.data, sealed.keyId, "c")).toThrow(SecretError);
  });

  it("says nothing about the secret or the key when it fails", () => {
    const a = key();
    const sealed = new SecretBox(a).seal("ghp_hiddenInTheError", "c");
    try {
      new SecretBox(key()).open(sealed.data, sealed.keyId, "c");
      expect.unreachable();
    } catch (error) {
      const text = String((error as Error).message) + String((error as Error).stack);
      expect(text).not.toContain("hiddenInTheError");
      expect(text).not.toContain(a.toString("base64"));
      expect(text).not.toContain(a.toString("hex"));
    }
  });

  describe("rotation", () => {
    it("opens old secrets with a previous key, and says which need re-sealing", () => {
      const oldKey = key();
      const oldBox = new SecretBox(oldKey);
      const old = oldBox.seal("old secret", "c");

      const box = new SecretBox(key(), [oldKey]);
      expect(box.keyId).not.toBe(old.keyId);
      expect(box.open(old.data, old.keyId, "c")).toBe("old secret");
      expect(box.needsRotation(old.keyId)).toBe(true);

      const fresh = box.seal(box.open(old.data, old.keyId, "c"), "c");
      expect(box.needsRotation(fresh.keyId)).toBe(false);
      expect(box.open(fresh.data, fresh.keyId, "c")).toBe("old secret");
    });

    it("cannot open a secret whose key was removed", () => {
      const old = new SecretBox(key()).seal("x", "c");
      expect(() => new SecretBox(key()).open(old.data, old.keyId, "c")).toThrow(/no longer configured/);
    });

    it("gives a key an id that is stable and says nothing about it", () => {
      const k = key();
      expect(new SecretBox(k).keyId).toBe(new SecretBox(Buffer.from(k)).keyId);
      expect(new SecretBox(k).keyId).toMatch(/^[0-9a-f]{8}$/);
      expect(k.toString("hex")).not.toContain(new SecretBox(k).keyId);
    });
  });

  describe("fromEnv", () => {
    it("is null when no key is set, so the feature can be off", () => {
      expect(SecretBox.fromEnv({})).toBeNull();
      expect(SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: "  " })).toBeNull();
    });

    it("reads a base64 or base64url key", () => {
      const k = key();
      expect(SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: k.toString("base64") })!.keyId).toBe(new SecretBox(k).keyId);
      expect(SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: k.toString("base64url") })!.keyId).toBe(new SecretBox(k).keyId);
    });

    it("reads previous keys", () => {
      const [current, a, b] = [key(), key(), key()];
      const box = SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: current.toString("base64"), GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS: `${a.toString("base64")}, ${b.toString("base64")}` })!;
      const sealed = new SecretBox(b).seal("x", "c");
      expect(box.open(sealed.data, sealed.keyId, "c")).toBe("x");
    });

    it.each(["short", "!!!notbase64!!!", randomBytes(16).toString("base64"), randomBytes(33).toString("base64")])("rejects a key that is not 32 bytes (%s)", (bad) => {
      expect(() => SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: bad })).toThrow(/32 random bytes/);
    });

    it("explains how to make a key without printing the one given", () => {
      try {
        SecretBox.fromEnv({ GIT_SYNC_ENCRYPTION_KEY: "my-secret-but-wrong" });
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain("openssl rand -base64 32");
        expect((error as Error).message).not.toContain("my-secret-but-wrong");
      }
    });
  });
});

describe("redactSecrets", () => {
  it("removes a token wherever it appears, including encoded forms", () => {
    const token = "ghp_AbCdEf1234567890";
    const basic = Buffer.from(token).toString("base64");
    const text = `failed: ${token} / ${encodeURIComponent(token)} / Authorization: Basic ${basic} / ${token}`;
    const out = redactSecrets(text, [token]);
    expect(out).not.toContain(token);
    expect(out).not.toContain(basic);
    expect(out.match(/\[redacted\]/g)).toHaveLength(4);
  });

  it("ignores empty and tiny values rather than mangling the text", () => {
    expect(redactSecrets("a b c", ["", null, undefined, "a"])).toBe("a b c");
  });
});
