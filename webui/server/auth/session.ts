import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { resolveCookieSecure } from "./deployment-mode.js";

export const SESSION_COOKIE = "lucy_admin_session";
/** Spec §3.2 proposal defaults (R3): sliding idle window, never extended past the absolute limit. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_BYTES = 32;
const SECRET_REL = ".ktx-ui/webui-session-secret";

/**
 * v2 session claims (Spec §3.2). Authority lives in the durable session row
 * (keyed by SHA-256 of `jti`) and the account state (`uid`, `ep`), not in the cookie.
 */
export type SessionClaims = {
  v: 2;
  jti: string;
  uid: string;
  ep: number;
  iat: number;
  exp: number;
};

/** The session HMAC key is missing-strength or unreadable; sessions cannot be issued or verified. */
export class SessionKeyError extends Error {
  readonly code = "SESSION_KEY_INVALID";
}

let secretCache: string | null = null;

function enoughEntropy(secret: string): boolean {
  return Buffer.byteLength(secret, "utf8") >= MIN_SECRET_BYTES;
}

async function writeSecretFile(abs: string, secret: string, replace: boolean): Promise<void> {
  await mkdir(path.dirname(abs), { recursive: true });
  if (!replace) {
    await writeFile(abs, `${secret}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return;
  }
  const tmp = `${abs}.${process.pid}.tmp`;
  await writeFile(tmp, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, abs);
}

async function loadOrCreateSecret(): Promise<string> {
  const fromEnv = process.env.LUCY_WEBUI_SESSION_SECRET?.trim();
  if (fromEnv) {
    if (!enoughEntropy(fromEnv)) {
      throw new SessionKeyError(`LUCY_WEBUI_SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
    }
    return fromEnv;
  }
  if (secretCache) return secretCache;

  const projectRoot = await resolveProjectRoot();
  const abs = path.join(projectRoot, SECRET_REL);
  let replace = false;
  try {
    const existing = (await readFile(abs, "utf8")).trim();
    if (enoughEntropy(existing)) {
      secretCache = existing;
      return existing;
    }
    // Spec §3.2: a weak legacy key is rotated. v1 sessions are rejected anyway, so nothing extra is lost.
    replace = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const created = randomBytes(32).toString("hex");
  try {
    await writeSecretFile(abs, created, replace);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = (await readFile(abs, "utf8")).trim();
    if (!enoughEntropy(existing)) throw error;
    secretCache = existing;
    return existing;
  }
  secretCache = created;
  return created;
}

/** Test helper: clear in-memory secret cache. */
export function resetSessionSecretCache(): void {
  secretCache = null;
}

/** Random, unguessable session id (256 bit). */
export function newSessionJti(): string {
  return randomBytes(32).toString("base64url");
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export async function sealSession(claims: SessionClaims): Promise<string> {
  const secret = await loadOrCreateSecret();
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function isClaims(value: unknown): value is SessionClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    c.v === 2 &&
    typeof c.jti === "string" &&
    c.jti.length > 0 &&
    typeof c.uid === "string" &&
    c.uid.length > 0 &&
    Number.isInteger(c.ep) &&
    typeof c.iat === "number" &&
    typeof c.exp === "number"
  );
}

/** Verifies the signature and v2 shape. v1 (stateless, `adminId`) cookies never pass. */
function unseal(token: string, secret: string): SessionClaims | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isClaims(parsed)) return null;
    if (parsed.exp * 1000 <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // Malformed escape: treat the cookie as absent rather than failing the request.
    }
  }
  return out;
}

/**
 * Signature-verified claims from the request cookie, or null. Throws `SessionKeyError`
 * when the HMAC key itself is unusable (callers must answer 503, not "not logged in").
 */
export async function readSessionClaims(request: FastifyRequest): Promise<SessionClaims | null> {
  const raw = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;
  const secret = await loadOrCreateSecret();
  return unseal(raw, secret);
}

export function setSessionCookie(reply: FastifyReply, token: string, exp: number): void {
  const maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000));
  const secure = resolveCookieSecure().secure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = resolveCookieSecure().secure ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}
