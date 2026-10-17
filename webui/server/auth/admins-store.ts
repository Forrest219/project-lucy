import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { auditedWriteFile } from "../admin/config-audit-write.js";
import { resolveDeploymentMode } from "./deployment-mode.js";

export const ADMINS_YAML_REL = "webui/config/admins.yaml";

export type WebuiAdminRole = "owner" | "operator";

/** Thrown when admins.yaml is unreadable or structurally invalid; auth then fails closed. */
export class AdminsConfigError extends Error {
  readonly code = "ADMINS_CONFIG_INVALID";
}

/**
 * Accept legacy `admin` as alias of `operator` when reading YAML.
 * Unknown or missing roles are rejected (Spec §3.1 item 7): never default to owner.
 */
export function normalizeWebuiAdminRole(raw: unknown): WebuiAdminRole {
  if (raw === "owner") return "owner";
  if (raw === "operator" || raw === "admin") return "operator";
  throw new AdminsConfigError(`unknown admin role: ${JSON.stringify(raw) ?? String(raw)}`);
}

export function webuiAdminRoleLabel(role: WebuiAdminRole): string {
  return role === "owner" ? "所有者" : "运维";
}

export type WebuiAdminRecord = {
  id: string;
  /** Immutable account identity (Spec §2). Absent only on legacy rows until their first login migrates them. */
  account_uid?: string;
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

/** `unavailable`: admins.yaml is unreadable/corrupt; everything except public recovery info is refused. */
export type AuthMode = "open" | "bootstrap" | "required" | "unavailable";

export const ADMIN_ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;

let cache: { path: string; loadedAt: number; config: AdminsConfig } | null = null;
const CACHE_TTL_MS = 5_000;

export function resetAdminsCache(): void {
  cache = null;
}

function emptyConfig(): AdminsConfig {
  return { version: "1", admins: [] };
}

function normalizeConfig(raw: unknown): AdminsConfig {
  // An empty file is "no admins"; anything that is present but malformed is rejected.
  if (raw === null || raw === undefined) return emptyConfig();
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AdminsConfigError("admins.yaml must be a mapping");
  }
  const doc = raw as Record<string, unknown>;
  if (doc.admins !== undefined && doc.admins !== null && !Array.isArray(doc.admins)) {
    throw new AdminsConfigError("admins.yaml `admins` must be a list");
  }
  const admins: WebuiAdminRecord[] = [];
  const seenUids = new Set<string>();
  for (const item of (doc.admins as unknown[] | null | undefined) ?? []) {
    if (!item || typeof item !== "object") throw new AdminsConfigError("admins.yaml entry must be a mapping");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) throw new AdminsConfigError("admins.yaml entry has no id");
    if (typeof row.password_hash !== "string" || !row.password_hash) {
      throw new AdminsConfigError(`admins.yaml entry '${row.id}' has no password_hash`);
    }
    const role = normalizeWebuiAdminRole(row.role);
    let accountUid: string | undefined;
    if (row.account_uid !== undefined && row.account_uid !== null) {
      if (typeof row.account_uid !== "string" || !row.account_uid.trim()) {
        throw new AdminsConfigError(`admins.yaml entry '${row.id}' has an invalid account_uid`);
      }
      accountUid = row.account_uid.trim();
      if (seenUids.has(accountUid)) throw new AdminsConfigError("admins.yaml has a duplicate account_uid");
      seenUids.add(accountUid);
    }
    admins.push({
      id: row.id.trim(),
      ...(accountUid ? { account_uid: accountUid } : {}),
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
    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch (error) {
      throw new AdminsConfigError(error instanceof Error ? error.message : "admins.yaml is not valid YAML");
    }
    const config = normalizeConfig(parsed);
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
  const customer = resolveDeploymentMode() === "customer";
  const flag = (process.env.LUCY_WEBUI_AUTH ?? "").trim().toLowerCase();
  // Spec §3.1: `off` is honored only in development; customer never resolves to open.
  if (flag === "off" && !customer) return "open";
  let config: AdminsConfig;
  try {
    config = await loadAdminsConfig();
  } catch {
    // Spec §3.1 item 1: a corrupt/unreadable config is `unavailable`, never open.
    return "unavailable";
  }
  const enabled = enabledAdmins(config);
  if (enabled.length > 0) return "required";
  if (customer || flag === "required") return "bootstrap";
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
        ...(a.account_uid ? { account_uid: a.account_uid } : {}),
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

export function findAdminByUid(config: AdminsConfig, accountUid: string): WebuiAdminRecord | undefined {
  return config.admins.find((a) => a.account_uid === accountUid);
}

export function countEnabledOwners(config: AdminsConfig): number {
  return config.admins.filter((a) => a.enabled && a.role === "owner").length;
}
