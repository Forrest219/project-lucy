import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { safeWrite } from "../fs-safe.js";
import { resolveProjectRoot } from "../project.js";
import type { LicensePayload, LicenseRecord, StoredEntitlement } from "./types.js";
import { activationCodeFingerprint } from "./codec.js";

const LICENSE_YAML_REL = ".ktx-ui/license.yaml";

let cachedRecord: LicenseRecord | null | undefined;

export function resetLicenseCache(): void {
  cachedRecord = undefined;
}

function toStoredEntitlement(payload: LicensePayload): StoredEntitlement {
  return {
    customer_id: payload.customer_id,
    tier: payload.tier,
    max_agents: payload.max_agents,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    features: payload.features ?? []
  };
}

function parseLicenseRecord(raw: unknown): LicenseRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== "1") return null;
  if (typeof obj.activated_at !== "string" || Number.isNaN(Date.parse(obj.activated_at))) return null;
  if (typeof obj.activation_code_fingerprint !== "string" || !obj.activation_code_fingerprint.startsWith("sha256:")) {
    return null;
  }
  const entitlementRaw = obj.entitlement;
  if (!entitlementRaw || typeof entitlementRaw !== "object") return null;
  const ent = entitlementRaw as Record<string, unknown>;
  if (typeof ent.customer_id !== "string" || !ent.customer_id.trim()) return null;
  if (ent.tier !== "trial" && ent.tier !== "standard" && ent.tier !== "enterprise") return null;
  if (!Number.isInteger(ent.max_agents) || (ent.max_agents as number) < 1) return null;
  if (typeof ent.issued_at !== "string" || Number.isNaN(Date.parse(ent.issued_at))) return null;
  if (ent.expires_at !== null) {
    if (typeof ent.expires_at !== "string" || Number.isNaN(Date.parse(ent.expires_at))) return null;
  }
  const features =
    Array.isArray(ent.features) && ent.features.every((item) => typeof item === "string")
      ? (ent.features as string[])
      : [];
  return {
    version: "1",
    activated_at: obj.activated_at,
    activation_code_fingerprint: obj.activation_code_fingerprint,
    entitlement: {
      customer_id: ent.customer_id.trim(),
      tier: ent.tier,
      max_agents: ent.max_agents as number,
      issued_at: ent.issued_at,
      expires_at: ent.expires_at as string | null,
      features
    }
  };
}

export async function readLicenseRecord(projectRoot?: string): Promise<LicenseRecord | null> {
  if (cachedRecord !== undefined) return cachedRecord;
  const root = projectRoot ?? (await resolveProjectRoot());
  const filePath = path.join(root, LICENSE_YAML_REL);
  let rawText: string;
  try {
    rawText = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      cachedRecord = null;
      return null;
    }
    throw error;
  }
  const parsed = parse(rawText);
  cachedRecord = parseLicenseRecord(parsed);
  return cachedRecord;
}

export async function writeLicenseRecord(input: {
  payload: LicensePayload;
  normalizedActivationCode: string;
  activatedAt?: string;
}): Promise<LicenseRecord> {
  const projectRoot = await resolveProjectRoot();
  const record: LicenseRecord = {
    version: "1",
    activated_at: input.activatedAt ?? new Date().toISOString(),
    activation_code_fingerprint: activationCodeFingerprint(input.normalizedActivationCode),
    entitlement: toStoredEntitlement(input.payload)
  };
  const yaml = stringify(record);
  await safeWrite(projectRoot, LICENSE_YAML_REL, yaml);
  cachedRecord = record;
  return record;
}

export function licenseYamlRelPath(): string {
  return LICENSE_YAML_REL;
}
