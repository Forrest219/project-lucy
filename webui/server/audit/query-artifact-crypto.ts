import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_ENV = "LUCY_AUDIT_QUERY_KEY";
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

export type QueryArtifactKind = "raw_sql" | "generated_sql" | "semantic_query";

export function resolveQueryArtifactKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env[KEY_ENV]?.trim();
  if (!raw) return null;
  return normalizeKeyMaterial(raw);
}

function normalizeKeyMaterial(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {
    // fall through
  }
  const utf = Buffer.from(raw, "utf8");
  if (utf.length === 32) return utf;
  // Derive a stable 32-byte key from arbitrary secret material (ops convenience).
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptQueryArtifactPayload(
  plaintext: string,
  key: Buffer
): { nonceB64: string; ciphertextB64: string; tagB64: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonceB64: iv.toString("base64"),
    ciphertextB64: encrypted.toString("base64"),
    tagB64: tag.toString("base64")
  };
}

export function decryptQueryArtifactPayload(
  parts: { nonceB64: string; ciphertextB64: string; tagB64: string },
  key: Buffer
): string {
  const iv = Buffer.from(parts.nonceB64, "base64");
  const ciphertext = Buffer.from(parts.ciphertextB64, "base64");
  const tag = Buffer.from(parts.tagB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isQueryArtifactEncryptionAvailable(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveQueryArtifactKey(env) !== null;
}
