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

/**
 * Reserved binding for a future enterprise identity provider.
 * v2.0 stores it and never uses it to sign in.
 */
export type OidcBinding = {
  issuer: string;
  sub: string;
  email: string;
};

export type WebuiAdminRecord = {
  id: string;
  /** Immutable account identity (Spec §2). Absent only on legacy rows until their first login migrates them. */
  account_uid?: string;
  display_name: string;
  /** Absent only when the account is held for a future OIDC binding and has no local password. */
  password_hash?: string;
  role: WebuiAdminRole;
  enabled: boolean;
  created_at: string;
  oidc_bindings?: OidcBinding[];
  /** Keys this build does not interpret. Written back unchanged so a later release can add fields. */
  preserved?: Record<string, unknown>;
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

const KNOWN_ADMIN_KEYS = new Set([
  "id",
  "account_uid",
  "display_name",
  "password_hash",
  "role",
  "enabled",
  "created_at",
  "oidc_bindings"
]);

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOidcBindings(raw: unknown, adminId: string): OidcBinding[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AdminsConfigError(`admins.yaml entry '${adminId}' has an invalid oidc_bindings`);
  }
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AdminsConfigError(`admins.yaml entry '${adminId}' has an invalid oidc_bindings`);
    }
    const binding = item as Record<string, unknown>;
    const issuer = trimmedString(binding.issuer);
    const sub = trimmedString(binding.sub);
    const email = trimmedString(binding.email);
    if (!issuer || !sub || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
      throw new AdminsConfigError(`admins.yaml entry '${adminId}' has an invalid oidc_bindings`);
    }
    return { issuer, sub, email };
  });
}

function preservedFields(row: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!KNOWN_ADMIN_KEYS.has(key)) extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
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
  const seenIds = new Set<string>();
  const seenUids = new Set<string>();
  const seenSubjects = new Set<string>();
  const seenEmails = new Set<string>();
  for (const item of (doc.admins as unknown[] | null | undefined) ?? []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AdminsConfigError("admins.yaml entry must be a mapping");
    }
    const row = item as Record<string, unknown>;
    const id = trimmedString(row.id);
    if (!id) throw new AdminsConfigError("admins.yaml entry has no id");
    // The account id is the login identity: two rows with the same id would make
    // every account lookup (and every OIDC binding resolution) ambiguous.
    if (seenIds.has(id)) throw new AdminsConfigError(`admins.yaml has a duplicate admin id '${id}'`);
    seenIds.add(id);
    const bindings = parseOidcBindings(row.oidc_bindings, id);
    const passwordHash = trimmedString(row.password_hash);
    if (!passwordHash && !bindings?.length) {
      throw new AdminsConfigError(`admins.yaml entry '${id}' has no password_hash`);
    }
    for (const binding of bindings ?? []) {
      const subjectKey = `${binding.issuer}\n${binding.sub}`;
      const emailKey = `${binding.issuer}\n${binding.email.toLowerCase()}`;
      if (seenSubjects.has(subjectKey) || seenEmails.has(emailKey)) {
        throw new AdminsConfigError(`admins.yaml entry '${id}' reuses an oidc binding`);
      }
      seenSubjects.add(subjectKey);
      seenEmails.add(emailKey);
    }
    const role = normalizeWebuiAdminRole(row.role);
    let accountUid: string | undefined;
    if (row.account_uid !== undefined && row.account_uid !== null) {
      if (typeof row.account_uid !== "string" || !row.account_uid.trim()) {
        throw new AdminsConfigError(`admins.yaml entry '${id}' has an invalid account_uid`);
      }
      accountUid = row.account_uid.trim();
      if (seenUids.has(accountUid)) throw new AdminsConfigError("admins.yaml has a duplicate account_uid");
      seenUids.add(accountUid);
    }
    const preserved = preservedFields(row);
    admins.push({
      id,
      ...(accountUid ? { account_uid: accountUid } : {}),
      display_name: trimmedString(row.display_name) || id,
      ...(passwordHash ? { password_hash: passwordHash } : {}),
      role,
      enabled: row.enabled !== false,
      created_at: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
      ...(bindings ? { oidc_bindings: bindings } : {}),
      ...(preserved ? { preserved } : {})
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

/**
 * Owner-facing account view (L25-06 §5.3).
 *
 * The public view never carries bindings: `/api/auth/status` and `/api/auth/me`
 * are reachable without a session, so the identity detail stays behind the owner
 * boundary.
 */
export function ownerAdminView(admin: WebuiAdminRecord): {
  id: string;
  displayName: string;
  role: WebuiAdminRole;
  enabled: boolean;
  createdAt: string;
  loginMethods: ("local" | "oidc")[];
  oidcBindings: OidcBinding[];
} {
  const loginMethods: ("local" | "oidc")[] = [];
  if (admin.password_hash) loginMethods.push("local");
  if (admin.oidc_bindings?.length) loginMethods.push("oidc");
  return {
    ...publicAdminView(admin),
    loginMethods,
    oidcBindings: admin.oidc_bindings ?? []
  };
}

export type OidcBindingMatch = {
  admin: WebuiAdminRecord;
  binding: OidcBinding;
};

/**
 * Exact `(issuer, sub)` match — the only key that authenticates an OIDC subject
 * (L25-06 §3.1). No trailing-slash, case or URL normalization, and no email
 * fallback: an email is contact information, never an identity.
 */
export function findOidcBinding(config: AdminsConfig, issuer: string, sub: string): OidcBindingMatch | undefined {
  for (const admin of config.admins) {
    for (const binding of admin.oidc_bindings ?? []) {
      if (binding.issuer === issuer && binding.sub === sub) return { admin, binding };
    }
  }
  return undefined;
}

/**
 * Owners that are enabled AND still hold a local password.
 *
 * This is the recovery floor of L25-06 D05: Lucy must never depend on an external
 * identity provider alone, so at least one such owner has to survive every
 * narrowing write.
 */
export function countEnabledOwnersWithLocalPassword(config: AdminsConfig): number {
  return config.admins.filter((a) => a.enabled && a.role === "owner" && Boolean(a.password_hash)).length;
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
        ...(a.preserved ?? {}),
        id: a.id,
        ...(a.account_uid ? { account_uid: a.account_uid } : {}),
        display_name: a.display_name,
        ...(a.password_hash ? { password_hash: a.password_hash } : {}),
        role: a.role,
        enabled: a.enabled,
        created_at: a.created_at,
        ...(a.oidc_bindings?.length ? { oidc_bindings: a.oidc_bindings } : {})
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
