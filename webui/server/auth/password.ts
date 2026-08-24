import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;
const MIN_PASSWORD_LENGTH = 10;

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
    (err as Error & { code?: string; statusCode?: number }).code = "PASSWORD_TOO_SHORT";
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [algo, salt, hashHex] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hashHex) return false;
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
