import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { isTokenRevoked } from "./audit.js";

interface UserToken {
  hash: string; // format: "sha256:<hex>"
  label: string;
  created?: string;
  expires_at?: string | null;
  device_name?: string | null;
}

interface UserAllow {
  connections?: string[];
  tables?: string[];
  tools?: string[];
}

/** Spec 98 §7 — Role generation: 1 = legacy, 2 = explicit row access. */
export type PermissionModelVersion = 1 | 2;

/** Spec 98 §7 / Spec 99 — `all` or `scoped` (+ row_policy). */
export type RowAccess = "all" | "scoped";

interface TableSelector {
  connection?: string;
  schema: string;
  prefix?: string;
  names?: string[];
  row_access?: RowAccess;
  row_policy?: unknown;
}

interface RoleAllow {
  connections?: string[];
  tableSelectors?: TableSelector[];
  tools?: string[];
}

interface RoleConfig {
  description?: string;
  permission_model_version?: PermissionModelVersion;
  allow?: RoleAllow;
}

interface UserConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  role?: string;
  roles?: string[];
  tokens: UserToken[];
  allow?: UserAllow;
  /** Spec 100 — Agent Constraints (compiled in acl; Role must not have this field). */
  constraints?: unknown;
}

interface Defaults {
  deny_tools?: string[];
  known_tools?: string[];
  table_touching_tools?: string[];
  sensitive_metadata_tools?: string[];
  sensitive_table_prefixes?: string[];
}

export interface AccessConfig {
  roles?: Record<string, RoleConfig>;
  users: UserConfig[];
  defaults?: Defaults;
}

export interface Identity {
  userId: string;
  tokenLabel: string;
  tokenHashPrefix: string;
  client?: string;
  clientVersion?: string;
  deviceName?: string;
}

export type IdentifyFailureReason =
  | "missing_bearer"
  | "token_unrecognized"
  | "token_revoked"
  | "token_expired";

export type IdentifyResult =
  | { ok: true; identity: Identity }
  | {
      ok: false;
      reason: IdentifyFailureReason;
      tokenHashPrefix?: string;
      userId?: string;
      tokenLabel?: string;
    };

let configCache: AccessConfig | null = null;
let configCachePath = "";
let configLoadedAt = 0;
const CACHE_TTL = 30_000;
const SESSION_CLIENT_TTL = 24 * 60 * 60 * 1000;

export async function resolveAccessConfigPath(): Promise<string> {
  const override = process.env.LUCY_ACCESS_CONFIG_PATH?.trim();
  if (override) return path.resolve(override);
  const projectRoot = await resolveProjectRoot();
  return path.join(projectRoot, "webui", "config", "access.yaml");
}

async function loadConfig(options: { fresh?: boolean } = {}): Promise<AccessConfig> {
  const now = Date.now();
  const configPath = await resolveAccessConfigPath();
  if (!options.fresh && configCache && configCachePath === configPath && now - configLoadedAt < CACHE_TTL) {
    return configCache;
  }
  const content = await readFile(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (err) {
    configCache = null;
    configLoadedAt = 0;
    throw err;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AccessConfig).users)) {
    configCache = null;
    configLoadedAt = 0;
    throw new Error("invalid_access_config_shape");
  }
  configCache = parsed as AccessConfig;
  configCachePath = configPath;
  configLoadedAt = now;
  return configCache;
}

export async function getAccessConfig(options: { fresh?: boolean } = {}): Promise<AccessConfig> {
  return loadConfig(options);
}

/** Drop in-memory access.yaml cache so revoke / create take effect immediately. */
export function invalidateAccessConfigCache(): void {
  configCache = null;
  configCachePath = "";
  configLoadedAt = 0;
}

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

/**
 * Token expiry enforcement (WO-202608-62 / Spec 07 `token_expired`).
 * - null/empty → never expires
 * - unparseable → fail-closed (treat as expired)
 * - date-only `YYYY-MM-DD` → end of that UTC day
 */
export function isTokenExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (expiresAt == null || expiresAt === "") return false;
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59.999Z` : expiresAt;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return true;
  return ts <= nowMs;
}

/** Normalize create-token input to ISO-8601 or null. Throws on invalid non-empty values. */
export function normalizeExpiresAtInput(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T23:59:59.999Z`;
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    const err = new Error("expires_at must be a valid ISO-8601 timestamp or YYYY-MM-DD date");
    (err as Error & { code?: string; statusCode?: number }).code = "EXPIRES_AT_INVALID";
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  return new Date(ts).toISOString();
}

type SessionClientInfo = {
  clientName: string;
  clientVersion?: string;
  lastSeen: number;
};

// session/user/token -> client info (populated from MCP initialize handshake)
const sessionClients = new Map<string, SessionClientInfo>();

function sessionClientKey(sessionId: string, userId: string, tokenLabel: string): string {
  return `${sessionId}:${userId}:${tokenLabel}`;
}

function purgeExpiredSessionClients(now = Date.now()): void {
  for (const [key, value] of sessionClients.entries()) {
    if (now - value.lastSeen > SESSION_CLIENT_TTL) sessionClients.delete(key);
  }
}

export function setSessionClient(
  sessionId: string,
  userId: string,
  tokenLabel: string,
  clientName: string,
  clientVersion?: string
): void {
  const now = Date.now();
  purgeExpiredSessionClients(now);
  sessionClients.set(sessionClientKey(sessionId, userId, tokenLabel), {
    clientName,
    clientVersion: clientVersion || undefined,
    lastSeen: now
  });
}

export function getSessionClient(
  sessionId: string | undefined,
  userId: string,
  tokenLabel: string
): SessionClientInfo | undefined {
  if (!sessionId) return undefined;
  const now = Date.now();
  purgeExpiredSessionClients(now);
  const key = sessionClientKey(sessionId, userId, tokenLabel);
  const value = sessionClients.get(key);
  if (!value) return undefined;
  value.lastSeen = now;
  return value;
}

export async function identifyRequestDetailed(
  authHeader: string | undefined,
  sessionId?: string
): Promise<IdentifyResult> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, reason: "missing_bearer" };
  }
  const token = authHeader.slice(7);
  if (!token) {
    return { ok: false, reason: "missing_bearer" };
  }
  const tokenHash = hashToken(token);
  const tokenHashPrefix = tokenHash.slice(0, 19);

  if (await isTokenRevoked(tokenHash)) {
    return { ok: false, reason: "token_revoked", tokenHashPrefix };
  }

  const config = await loadConfig();
  for (const user of config.users) {
    for (const t of user.tokens) {
      if (t.hash !== tokenHash) continue;
      if (isTokenExpired(t.expires_at)) {
        return {
          ok: false,
          reason: "token_expired",
          tokenHashPrefix,
          userId: user.id,
          tokenLabel: t.label
        };
      }
      const sessionClient = getSessionClient(sessionId, user.id, t.label);
      return {
        ok: true,
        identity: {
          userId: user.id,
          tokenLabel: t.label,
          tokenHashPrefix,
          client: sessionClient?.clientName,
          clientVersion: sessionClient?.clientVersion,
          deviceName: t.device_name ?? undefined
        }
      };
    }
  }
  return { ok: false, reason: "token_unrecognized", tokenHashPrefix };
}

export async function identifyRequest(
  authHeader: string | undefined,
  sessionId?: string
): Promise<Identity | null> {
  const result = await identifyRequestDetailed(authHeader, sessionId);
  return result.ok ? result.identity : null;
}
