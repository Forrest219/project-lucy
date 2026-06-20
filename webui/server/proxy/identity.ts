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
  tables?: string[];
  tools?: string[];
}

interface UserConfig {
  id: string;
  name?: string;
  enabled?: boolean;
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
  users: UserConfig[];
  defaults?: Defaults;
}

export interface Identity {
  userId: string;
  tokenLabel: string;
  client?: string;
}

let configCache: AccessConfig | null = null;
let configLoadedAt = 0;
const CACHE_TTL = 30_000;
const SESSION_CLIENT_TTL = 24 * 60 * 60 * 1000;

async function loadConfig(options: { fresh?: boolean } = {}): Promise<AccessConfig> {
  const now = Date.now();
  if (!options.fresh && configCache && now - configLoadedAt < CACHE_TTL) return configCache;
  const projectRoot = await resolveProjectRoot();
  const configPath = path.join(projectRoot, "webui", "config", "access.yaml");
  const content = await readFile(configPath, "utf-8");
  configCache = parse(content) as AccessConfig;
  configLoadedAt = now;
  return configCache;
}

export async function getAccessConfig(options: { fresh?: boolean } = {}): Promise<AccessConfig> {
  return loadConfig(options);
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
          client: getSessionClient(sessionId, user.id, t.label),
        };
      }
    }
  }
  return null;
}
