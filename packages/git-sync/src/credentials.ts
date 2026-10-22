import { prisma } from "@gitcrook/db";
import { redactSecrets, SecretBox, SecretError } from "@gitcrook/shared/server";
import { AuthError } from "./github/errors";

/** The context a credential's secret is sealed to: a ciphertext copied into another row does not open there. */
export const credentialContext = (credentialId: string) => `git-credential:${credentialId}`;

/** Stores an access token for a source to read with. The token is encrypted before it reaches the database. */
export async function createTokenCredential(secrets: SecretBox, input: { organizationId: string; token: string; label?: string; createdById?: string | null }) {
  const token = input.token.trim();
  if (token.length < 8 || token.length > 512 || /\s/.test(token)) throw new SecretError("That does not look like an access token.");
  return prisma.$transaction(async (tx) => {
    const row = await tx.gitCredential.create({ data: { organizationId: input.organizationId, kind: "TOKEN", label: input.label ?? "", keyId: secrets.keyId, createdById: input.createdById ?? null }, select: { id: true } });
    const sealed = secrets.seal(token, credentialContext(row.id));
    await tx.gitCredential.update({ where: { id: row.id }, data: { secretCiphertext: new Uint8Array(sealed.data), keyId: sealed.keyId } });
    return { id: row.id };
  });
}

/** Replaces a credential's token, or re-encrypts it under the current key (pass no token). */
export async function updateCredential(secrets: SecretBox, credentialId: string, token?: string) {
  const row = await prisma.gitCredential.findUnique({ where: { id: credentialId }, select: { secretCiphertext: true, keyId: true } });
  if (!row) return;
  const plain = token ?? (row.secretCiphertext ? secrets.open(row.secretCiphertext, row.keyId, credentialContext(credentialId)) : null);
  if (plain === null) return;
  const sealed = secrets.seal(plain, credentialContext(credentialId));
  await prisma.gitCredential.update({ where: { id: credentialId }, data: { secretCiphertext: new Uint8Array(sealed.data), keyId: sealed.keyId } });
}

export interface ResolvedCredential {
  /** Called for every request. */
  getToken: () => string | null;
  /** The secrets to scrub from anything that is logged or stored. */
  secrets: string[];
}

/** The token a source reads with, decrypted for this run only. A public repository needs none. */
export async function resolveCredential(credentialId: string | null, secrets: SecretBox | null): Promise<ResolvedCredential> {
  if (!credentialId) return { getToken: () => null, secrets: [] };
  if (!secrets) throw new AuthError("This source has a credential, but GIT_SYNC_ENCRYPTION_KEY is not set, so it cannot be decrypted.");
  const row = await prisma.gitCredential.findUnique({ where: { id: credentialId }, select: { kind: true, secretCiphertext: true, keyId: true } });
  if (!row?.secretCiphertext) throw new AuthError("This source's credential has no stored token.");
  if (row.kind !== "TOKEN") throw new AuthError(`Credentials of kind ${row.kind} are not supported yet.`);
  let token: string;
  try {
    token = secrets.open(row.secretCiphertext, row.keyId, credentialContext(credentialId));
  } catch (error) {
    throw new AuthError(error instanceof SecretError ? error.message : "The stored credential could not be decrypted.");
  }
  return { getToken: () => token, secrets: [token] };
}

export { redactSecrets };
