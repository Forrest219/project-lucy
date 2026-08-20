import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { auditedWriteFile } from "../admin/config-audit-write.js";

export const ADMINS_YAML_REL = "webui/config/admins.yaml";

export type WebuiAdminRole = "owner" | "admin";

export type WebuiAdminRecord = {
  id: string;
  display_name: string;
  password_hash: string;
  role: WebuiAdminRole;
  enabled: boolean;
  created_at: string;
};

export type AdminsConfig = {
  version: string;
  admins: WebuiAdminRecord[];
};

export type AuthMode = "open" | "bootstrap" | "required";

let cache: { path: string; loadedAt: number; config: AdminsConfig } | null = null;
const CACHE_TTL_MS = 5_000;

export function resetAdminsCache(): void {
  cache = null;
}

function emptyConfig(): AdminsConfig {
  return { version: "1", admins: [] };
}

function normalizeConfig(raw: unknown): AdminsConfig {
  if (!raw || typeof raw !== "object") return emptyConfig();
  const doc = raw as Record<string, unknown>;
  const adminsRaw = Array.isArray(doc.admins) ? doc.admins : [];
  const admins: WebuiAdminRecord[] = [];
  for (const item of adminsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (typeof row.password_hash !== "string" || !row.password_hash) continue;
    const role = row.role === "admin" ? "admin" : "owner";
    admins.push({
      id: row.id.trim(),
      display_name: typeof row.display_name === "string" && row.display_name.trim()
        ? row.display_name.trim()
        : row.id.trim(),
      password_hash: row.password_hash,
      role,
      enabled: row.enabled !== false,
      created_at: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString()
    });
  }
  return {
    version: typeof doc.version === "string" ? doc.version : "1",
    admins
  };
}

export async function resolveAdminsConfigPath(): Promise<string> {
  const override = process.env.LUCY_ADMINS_CONFIG_PATH?.trim();
  if (override) return path.resolve(override);
  const projectRoot = await resolveProjectRoot();
  return path.join(projectRoot, ADMINS_YAML_REL);
}

export async function loadAdminsConfig(options: { fresh?: boolean } = {}): Promise<AdminsConfig> {
  const configPath = await resolveAdminsConfigPath();
  const now = Date.now();
  if (
    !options.fresh &&
    cache &&
    cache.path === configPath &&
    now - cache.loadedAt < CACHE_TTL_MS
  ) {
    return cache.config;
  }
  try {
    const text = await readFile(configPath, "utf8");
    const config = normalizeConfig(parse(text));
    cache = { path: configPath, loadedAt: now, config };
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const config = emptyConfig();
      cache = { path: configPath, loadedAt: now, config };
      return config;
    }
    throw error;
  }
}

export function enabledAdmins(config: AdminsConfig): WebuiAdminRecord[] {
  return config.admins.filter((a) => a.enabled);
}

export async function resolveAuthMode(): Promise<AuthMode> {
  const flag = (process.env.LUCY_WEBUI_AUTH ?? "").trim().toLowerCase();
  if (flag === "off") return "open";
  const config = await loadAdminsConfig();
  const enabled = enabledAdmins(config);
  if (enabled.length > 0) return "required";
  if (flag === "required") return "bootstrap";
  return "open";
}

export function publicAdminView(admin: WebuiAdminRecord): {
  id: string;
  displayName: string;
  role: WebuiAdminRole;
  enabled: boolean;
  createdAt: string;
} {
  return {
    id: admin.id,
    displayName: admin.display_name,
    role: admin.role,
    enabled: admin.enabled,
    createdAt: admin.created_at
  };
}

export async function saveAdminsConfig(
  config: AdminsConfig,
  audit: {
    changeType: string;
    actor: string;
    targetId?: string;
    oldSummary?: unknown;
    newSummary?: unknown;
    requestId?: string;
  }
): Promise<void> {
  const projectRoot = await resolveProjectRoot();
  const content = stringify(
    {
      version: config.version || "1",
      admins: config.admins.map((a) => ({
        id: a.id,
        display_name: a.display_name,
        password_hash: a.password_hash,
        role: a.role,
        enabled: a.enabled,
        created_at: a.created_at
      }))
    },
    { lineWidth: 0 }
  );
  await auditedWriteFile(projectRoot, ADMINS_YAML_REL, content, {
    enabled: true,
    changeType: audit.changeType,
    assetKind: "governance",
    actor: audit.actor,
    actorType: "ui_admin",
    source: "webui_admin_auth",
    targetId: audit.targetId,
    oldSummary: audit.oldSummary,
    newSummary: audit.newSummary,
    requestId: audit.requestId
  });
  resetAdminsCache();
}

export function findAdmin(config: AdminsConfig, adminId: string): WebuiAdminRecord | undefined {
  return config.admins.find((a) => a.id === adminId);
}

export function countEnabledOwners(config: AdminsConfig): number {
  return config.admins.filter((a) => a.enabled && a.role === "owner").length;
}
