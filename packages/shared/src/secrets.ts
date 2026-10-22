import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for the credentials a source needs (a GitHub token, an App installation secret).
 *
 * AES-256-GCM with a fresh random 96-bit IV for every message. The blob is self-contained —
 * `version | iv | tag | ciphertext` — and the row stores only the blob and a `keyId`. The key id is the first
 * eight hex digits of the SHA-256 of the key, so keys need no names, a rotated key is recognised by what it is,
 * and the id says nothing useful about the key.
 *
 * Each message is bound to a context string (the credential's id, say) as additional authenticated data, so a
 * ciphertext copied into another row does not decrypt there.
 *
 * Rotation: put the new key in GIT_SYNC_ENCRYPTION_KEY and keep the old one in GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS
 * (comma-separated). Old rows still open; `needsRotation` says which to re-encrypt.
 */

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Thrown for anything wrong with a secret. Deliberately says little: no key, plaintext or ciphertext in the message. */
export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

const HOW_TO_MAKE_A_KEY = "Generate one with: openssl rand -base64 32";

function parseKey(value: string, name: string): Buffer {
  const trimmed = value.trim();
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) ? Buffer.from(trimmed, "base64") : /^[A-Za-z0-9_-]+$/.test(trimmed) ? Buffer.from(trimmed, "base64url") : null;
  if (!key || key.length !== KEY_BYTES) throw new SecretError(`${name} must be 32 random bytes, base64 encoded. ${HOW_TO_MAKE_A_KEY}`);
  return key;
}

const keyIdOf = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

export interface SealedSecret {
  data: Buffer;
  keyId: string;
}

export class SecretBox {
  readonly keyId: string;
  private readonly keys = new Map<string, Buffer>();
  private readonly current: Buffer;

  constructor(current: Buffer, previous: readonly Buffer[] = []) {
    if (current.length !== KEY_BYTES) throw new SecretError(`The encryption key must be ${KEY_BYTES} bytes.`);
    this.current = current;
    this.keyId = keyIdOf(current);
    this.keys.set(this.keyId, current);
    for (const key of previous) {
      if (key.length !== KEY_BYTES) throw new SecretError(`Every previous encryption key must be ${KEY_BYTES} bytes.`);
      this.keys.set(keyIdOf(key), key);
    }
  }

  /** From the environment, or null when no key is set (Git Sync is then simply unavailable). A malformed key throws. */
  static fromEnv(env: Record<string, string | undefined> = process.env): SecretBox | null {
    const current = env.GIT_SYNC_ENCRYPTION_KEY?.trim();
    if (!current) return null;
    const previous = (env.GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseKey(s, "GIT_SYNC_ENCRYPTION_KEYS_PREVIOUS"));
    return new SecretBox(parseKey(current, "GIT_SYNC_ENCRYPTION_KEY"), previous);
  }

  /** `context` is bound into the message: the same string must be given to `open`. */
  seal(plaintext: string, context: string): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.current, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { data: Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]), keyId: this.keyId };
  }

  open(data: Uint8Array, keyId: string, context: string): string {
    const key = this.keys.get(keyId);
    if (!key) throw new SecretError("The key that encrypted this secret is no longer configured.");
    const buf = Buffer.from(data);
    if (buf.length < 1 + IV_BYTES + TAG_BYTES || buf[0] !== VERSION) throw new SecretError("The stored secret is not in a format this version can read.");
    const iv = buf.subarray(1, 1 + IV_BYTES);
    const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const body = buf.subarray(1 + IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // The library's message says nothing a caller can use, and what it could say is better left unsaid.
      throw new SecretError("The stored secret could not be decrypted (wrong key, wrong context, or it was altered).");
    }
  }

  /** True for a secret sealed with a key other than the current one: re-seal it. */
  needsRotation(keyId: string): boolean {
    return keyId !== this.keyId;
  }
}

/**
 * Replaces every occurrence of each secret in `text` before it is logged or stored. A defence for the places
 * where an error message or a response body might carry a token back out.
 */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
    // The same token percent-encoded or base64 encoded (HTTP basic auth) is still the token.
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
    out = out.split(Buffer.from(secret).toString("base64")).join("[redacted]");
  }
  return out;
}
