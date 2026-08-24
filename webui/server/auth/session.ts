import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveProjectRoot } from "../project.js";

export const SESSION_COOKIE = "lucy_admin_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SECRET_REL = ".ktx-ui/webui-session-secret";

export type AdminSession = {
  adminId: string;
  iat: number;
  exp: number;
};

let secretCache: string | null = null;

async function loadOrCreateSecret(): Promise<string> {
  const fromEnv = process.env.LUCY_WEBUI_SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (secretCache) return secretCache;

  const projectRoot = await resolveProjectRoot();
  const abs = path.join(projectRoot, SECRET_REL);
  try {
    const existing = (await readFile(abs, "utf8")).trim();
    if (existing.length >= 16) {
      secretCache = existing;
      return existing;
    }
  } catch {
    // create below
  }

  const created = randomBytes(32).toString("hex");
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, created, { encoding: "utf8", mode: 0o600 });
  secretCache = created;
  return created;
}

/** Test helper: clear in-memory secret cache. */
export function resetSessionSecretCache(): void {
  secretCache = null;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function seal(payload: AdminSession, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function unseal(token: string, secret: string): AdminSession | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSession;
    if (!parsed?.adminId || typeof parsed.exp !== "number") return null;
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
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export async function createAdminSession(adminId: string): Promise<{ token: string; exp: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const payload: AdminSession = { adminId, iat: now, exp };
  const secret = await loadOrCreateSecret();
  return { token: seal(payload, secret), exp };
}

export async function readAdminSession(request: FastifyRequest): Promise<AdminSession | null> {
  const cookies = parseCookieHeader(request.headers.cookie);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const secret = await loadOrCreateSecret();
  return unseal(raw, secret);
}

export function setSessionCookie(reply: FastifyReply, token: string, exp: number): void {
  const maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000));
  const secure = process.env.LUCY_WEBUI_COOKIE_SECURE === "1" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = process.env.LUCY_WEBUI_COOKIE_SECURE === "1" ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}
