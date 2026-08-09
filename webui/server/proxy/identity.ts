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
}

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

/** WP-I5: drop TTL cache so the next load re-reads access.yaml. */
export function invalidateAccessConfigCache(): void {
  configCache = null;
  configLoadedAt = 0;
}

/** WP-I5: pin a successfully parsed config after EffectivePolicy commit. */
export function primeAccessConfigCache(config: AccessConfig, configPath?: string): void {
  configCache = config;
  if (configPath) configCachePath = configPath;
  configLoadedAt = Date.now();
}

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

// session/user/token -> client name (populated from MCP initialize handshake)
const sessionClients = new Map<string, { clientName: string; lastSeen: number }>();

function sessionClientKey(sessionId: string, userId: string, tokenLabel: string): string {
  return `${sessionId}:${userId}:${tokenLabel}`;
}

function purgeExpiredSessionClients(now = Date.now()): void {
  for (const [key, value] of sessionClients.entries()) {
    if (now - value.lastSeen > SESSION_CLIENT_TTL) sessionClients.delete(key);
  }
}

export function setSessionClient(sessionId: string, userId: string, tokenLabel: string, clientName: string): void {
  const now = Date.now();
  purgeExpiredSessionClients(now);
  sessionClients.set(sessionClientKey(sessionId, userId, tokenLabel), { clientName, lastSeen: now });
}

export function getSessionClient(sessionId: string | undefined, userId: string, tokenLabel: string): string | undefined {
  if (!sessionId) return undefined;
  const now = Date.now();
  purgeExpiredSessionClients(now);
  const key = sessionClientKey(sessionId, userId, tokenLabel);
  const value = sessionClients.get(key);
  if (!value) return undefined;
  value.lastSeen = now;
  return value.clientName;
}

export async function identifyRequest(
  authHeader: string | undefined,
  sessionId?: string
): Promise<Identity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  if (await isTokenRevoked(tokenHash)) return null;

  const config = await loadConfig();
  for (const user of config.users) {
    for (const t of user.tokens) {
      if (t.hash === tokenHash) {
        return {
          userId: user.id,
          tokenLabel: t.label,
          tokenHashPrefix: tokenHash.slice(0, 19),
          client: getSessionClient(sessionId, user.id, t.label),
        };
      }
    }
  }
  return null;
}
