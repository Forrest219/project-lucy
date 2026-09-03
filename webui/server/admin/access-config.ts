import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { auditedWriteFile } from "./config-audit-write.js";
import type { ConfigAuditAssetKind, ConfigAuditActorType } from "./audit.js";

export const ACCESS_YAML_REL = "webui/config/access.yaml";

export const ROLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
}

export interface YamlUser {
  id: string;
  name: string;
  note?: string;
  enabled?: boolean;
  role?: string;
  tokens: YamlToken[];
  allow?: {
    tables: string[];
    tools: string[];
    connections?: string[];
  };
}

/** Spec 98 §7 — Role generation; Admin writes always persist `2`. */
export type YamlPermissionModelVersion = 1 | 2;

/** Spec 98 §7 / Spec 99 — `all` or `scoped` (+ row_policy). */
export type YamlRowAccess = "all" | "scoped";

export interface YamlRowPolicy {
  predicates: Array<{
    field: string;
    op: "eq" | "in";
    value?: string | number | boolean;
    values?: Array<string | number | boolean>;
  }>;
}

export type YamlTableSelector =
  | { connection?: string; schema: string; names: string[]; row_access?: YamlRowAccess; row_policy?: YamlRowPolicy }
  | { connection?: string; schema: string; prefix: string; row_access?: YamlRowAccess; row_policy?: YamlRowPolicy };

export interface YamlRole {
  description?: string;
  permission_model_version?: YamlPermissionModelVersion;
  allow?: {
    connections?: string[];
    source_scope?: "catalog_bound";
    tableSelectors?: YamlTableSelector[];
    tools?: string[];
  };
}

export interface YamlAccessConfig {
  roles?: Record<string, YamlRole>;
  users: YamlUser[];
  defaults?: {
    deny_tools?: string[];
    known_tools?: string[];
    table_touching_tools?: string[];
    sensitive_metadata_tools?: string[];
    sensitive_table_prefixes?: string[];
  };
}

export interface AccessFile {
  config: YamlAccessConfig;
  raw: string;
  version: string;
  /** access.yaml mtime from the single stat inside readAccessYaml */
  mtimeMs: number;
}

function computeVersion(raw: string, mtimeMs: number): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${mtimeMs.toFixed(0)}-${hash}`;
}

export async function readAccessYaml(projectRoot: string): Promise<AccessFile> {
  const filePath = path.join(projectRoot, ACCESS_YAML_REL);
  const raw = await readFile(filePath, "utf-8");
  const s = await stat(filePath);
  const config = parse(raw) as YamlAccessConfig;
  if (!config.users) config.users = [];
  return { config, raw, version: computeVersion(raw, s.mtimeMs), mtimeMs: s.mtimeMs };
}

export async function readAccessYamlVersion(projectRoot: string): Promise<{ raw: string; version: string }> {
  const filePath = path.join(projectRoot, ACCESS_YAML_REL);
  const raw = await readFile(filePath, "utf-8");
  const s = await stat(filePath);
  return { raw, version: computeVersion(raw, s.mtimeMs) };
}

export async function writeAccessYaml(
  projectRoot: string,
  config: YamlAccessConfig,
  audit?: {
    enabled: boolean;
    changeType: string;
    targetId?: string;
    oldSummary?: unknown;
    newSummary?: unknown;
    diff?: string;
    requestId?: string;
    source?: string;
    actorType?: ConfigAuditActorType;
    actor?: string;
    idempotencyKey?: string;
    operation?: string;
    assetKind?: ConfigAuditAssetKind;
  }
): Promise<{ auditId?: number; policyVersion: string; runtimeAck: boolean }> {
  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let previousRaw: string | undefined;
  try {
    previousRaw = await readFile(accessPath, "utf-8");
  } catch {
    previousRaw = undefined;
  }

  const toWrite: YamlAccessConfig = {
    ...config,
    users: config.users.map((u) => ({
      ...u,
      tokens: u.tokens.map(({ ...t }) => t)
    }))
  };
  const content = stringify(toWrite, { lineWidth: 0 });
  const {
    commitEffectivePolicy,
    computeAccessConfigDigest,
    evaluateRuntimeAck
  } = await import("../proxy/acl.js");
  // Digest of the exact YAML bytes we are about to persist (post-stringify parse).
  const expectedDigest = computeAccessConfigDigest(parse(content) as Parameters<typeof computeAccessConfigDigest>[0]);

  const writeResult = await auditedWriteFile(projectRoot, ACCESS_YAML_REL, content, audit ? {
    enabled: audit.enabled,
    changeType: audit.changeType,
    assetKind: audit.assetKind ?? "governance",
    operation: audit.operation,
    actor: audit.actor,
    actorType: audit.actorType ?? "ui_admin",
    source: audit.source ?? "admin_access_config_api",
    targetId: audit.targetId,
    oldSummary: audit.oldSummary,
    newSummary: audit.newSummary,
    diff: audit.diff,
    requestId: audit.requestId,
    idempotencyKey: audit.idempotencyKey
  } : undefined);

  // Spec 98 §8.2 — commit after write; ack only when runtime digest matches this write.
  let status = await commitEffectivePolicy();
  let runtimeAck = evaluateRuntimeAck(status, expectedDigest);

  // Spec 98 §8.2 step 4 — runtime switch/compile failure → roll disk back; never ack stale widen.
  if (!runtimeAck && previousRaw !== undefined) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(accessPath, previousRaw, "utf8");
    status = await commitEffectivePolicy();
    runtimeAck = false;
  }

  return {
    ...writeResult,
    policyVersion: status.policyVersion,
    runtimeAck
  };
}

export function makeDiff(oldYaml: string, newYaml: string): string {
  const oldLines = oldYaml.split("\n");
  const newLines = newYaml.split("\n");
  const lines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i += 1) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) {
      lines.push(`+${n}`);
    } else if (n === undefined) {
      lines.push(`-${o}`);
    } else if (o !== n) {
      lines.push(`-${o}`);
      lines.push(`+${n}`);
    } else {
      lines.push(` ${o}`);
    }
  }
  return lines.join("\n");
}
