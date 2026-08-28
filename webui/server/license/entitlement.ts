import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import type {
  LicenseEnforcementDecision,
  LicenseMode,
  LicenseSnapshot,
  LicenseStatusCode,
  StoredEntitlement
} from "./types.js";
import { readLicenseRecord } from "./store.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";

function resolveLicenseMode(env: NodeJS.ProcessEnv = process.env): LicenseMode {
  const raw = env.LUCY_LICENSE_MODE?.trim().toLowerCase();
  if (raw === "enforce" || raw === "warn") return raw;
  return "off";
}

export function resolveVerifySecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.LUCY_LICENSE_VERIFY_SECRET?.trim() ?? "";
}

function entitlementExpired(entitlement: StoredEntitlement, nowMs = Date.now()): boolean {
  if (entitlement.expires_at === null) return false;
  return Date.parse(entitlement.expires_at) <= nowMs;
}

function computeDaysRemaining(expiresAt: string | null, nowMs = Date.now()): number | null {
  if (expiresAt === null) return null;
  const deltaMs = Date.parse(expiresAt) - nowMs;
  return Math.ceil(deltaMs / 86_400_000);
}

async function countEnabledAgents(projectRoot: string): Promise<number> {
  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let rawText: string;
  try {
    rawText = await readFile(accessPath, "utf8");
  } catch {
    return 0;
  }
  const parsed = parse(rawText) as { users?: Array<{ enabled?: boolean }> } | null;
  const users = parsed?.users ?? [];
  return users.filter((user) => user.enabled !== false).length;
}

function resolveStatus(
  mode: LicenseMode,
  record: Awaited<ReturnType<typeof readLicenseRecord>>,
  nowMs = Date.now()
): LicenseStatusCode {
  if (mode === "off") return "inactive";
  if (!record) return "inactive";
  if (entitlementExpired(record.entitlement, nowMs)) return "expired";
  return "active";
}

export async function loadLicenseSnapshot(nowMs = Date.now()): Promise<LicenseSnapshot> {
  const mode = resolveLicenseMode();
  const verifySecretConfigured = resolveVerifySecret().length > 0;
  const projectRoot = await resolveProjectRoot();
  const [record, agents] = await Promise.all([readLicenseRecord(projectRoot), countEnabledAgents(projectRoot)]);
  const status = resolveStatus(mode, record, nowMs);
  const entitlement = record?.entitlement ?? null;
  const expiresAt = entitlement?.expires_at ?? null;
  return {
    mode,
    status,
    activatedAt: record?.activated_at ?? null,
    entitlement,
    usage: {
      agents,
      maxAgents: entitlement?.max_agents ?? null
    },
    expiresAt,
    daysRemaining: computeDaysRemaining(expiresAt, nowMs),
    verifySecretConfigured
  };
}

export function assertLicenseAllowsMcp(snapshot: LicenseSnapshot): LicenseEnforcementDecision {
  if (snapshot.mode !== "enforce") return { allowed: true };
  if (!snapshot.verifySecretConfigured) {
    return {
      allowed: false,
      code: "LICENSE_VERIFY_SECRET_MISSING",
      message: "部署许可校验密钥未配置，无法启用 enforce 模式",
      httpStatus: 403,
      decisionReason: "license_missing"
    };
  }
  if (snapshot.status === "active") return { allowed: true };
  if (snapshot.status === "expired") {
    return {
      allowed: false,
      code: "LICENSE_EXPIRED",
      message: "部署许可已过期，请续费并重新激活",
      httpStatus: 403,
      decisionReason: "license_expired"
    };
  }
  return {
    allowed: false,
    code: "LICENSE_REQUIRED",
    message: "尚未激活部署许可，请在系统设置中输入激活码",
    httpStatus: 403,
    decisionReason: "license_missing"
  };
}

export function assertLicenseAllowsAgentCreate(
  snapshot: LicenseSnapshot,
  nextEnabledAgentCount: number
): LicenseEnforcementDecision {
  const base = assertLicenseAllowsMcp(snapshot);
  if (!base.allowed) return base;
  const maxAgents = snapshot.entitlement?.max_agents;
  if (maxAgents != null && nextEnabledAgentCount > maxAgents) {
    return {
      allowed: false,
      code: "LICENSE_SEAT_LIMIT",
      message: `Agent 席位已达上限（${maxAgents}），请升级部署许可`,
      httpStatus: 403
    };
  }
  return { allowed: true };
}

export function resolveLicenseModeForExport(): LicenseMode {
  return resolveLicenseMode();
}
