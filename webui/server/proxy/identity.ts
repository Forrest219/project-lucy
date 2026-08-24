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

interface TableSelector {
  connection?: string;
  schema: string;
  prefix?: string;
  names?: string[];
}

interface RoleAllow {
  connections?: string[];
  tableSelectors?: TableSelector[];
  tools?: string[];
}

interface RoleConfig {
  description?: string;
  allow?: RoleAllow;
}

interface UserConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  role?: string;
  tokens: UserToken[];
  allow?: UserAllow;
}

interface Defaults {
  deny_tools?: string[];
  known_tools?: string[];
  table_touching_tools?: string[];
  sensitive_metadata_tools?: string[];
  sensitive_table_prefixes?: string[];
}

interface AccessConfig {
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
  configCache = parse(content) as AccessConfig;
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

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms <= Date.now();
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
      if (isExpired(t.expires_at)) {
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
