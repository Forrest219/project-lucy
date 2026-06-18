import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";

interface UserToken {
  value: string; // Phase 1: plaintext; Phase 2: sha256 hash
  label: string;
}

interface UserConfig {
  id: string;
  name?: string;
  tokens: UserToken[];
}

interface AccessConfig {
  users: UserConfig[];
}

export interface Identity {
  userId: string;
  tokenLabel: string;
  client?: string;
}

let configCache: AccessConfig | null = null;
let configLoadedAt = 0;
const CACHE_TTL = 30_000;

async function loadConfig(): Promise<AccessConfig> {
  const now = Date.now();
  if (configCache && now - configLoadedAt < CACHE_TTL) return configCache;
  const projectRoot = await resolveProjectRoot();
  const configPath = path.join(projectRoot, "webui", "config", "access.yaml");
  const content = await readFile(configPath, "utf-8");
  configCache = parse(content) as AccessConfig;
  configLoadedAt = now;
  return configCache;
}

// session id -> client name (populated from MCP initialize handshake)
const sessionClients = new Map<string, string>();

export function setSessionClient(sessionId: string, clientName: string): void {
  sessionClients.set(sessionId, clientName);
}

export function getSessionClient(sessionId: string | undefined): string | undefined {
  return sessionId ? sessionClients.get(sessionId) : undefined;
}

export async function identifyRequest(
  authHeader: string | undefined,
  sessionId?: string
): Promise<Identity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const config = await loadConfig();
  for (const user of config.users) {
    for (const t of user.tokens) {
      if (t.value === token) {
        return {
          userId: user.id,
          tokenLabel: t.label,
          client: getSessionClient(sessionId),
        };
      }
    }
  }
  return null;
}
