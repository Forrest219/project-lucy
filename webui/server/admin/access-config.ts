import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { beginConfigAuditIntent, auditedWriteFile, completeConfigAuditTerminal } from "./config-audit-write.js";
import { withPublishCoordinator, type PublishEntryKind } from "../publish-coordinator.js";
import { safeRemove, safeWriteAtomic } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import {
  AccessRecoveryRequiredError,
  assertAccessWritesAllowed,
  markAccessRecoveryRequired,
  readAccessRecoveryState
} from "../access-recovery.js";
import type { ConfigAuditAssetKind, ConfigAuditActorType } from "./audit.js";
import { withDisplayWriteBarrier } from "../display-generation.js";
import { narrowAuthorization, narrowingScopeForWrite } from "../proxy/authorization-barrier.js";

export const ACCESS_YAML_REL = "webui/config/access.yaml";

export class AccessVersionConflictError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly statusCode = 409;

  constructor() {
    super("yaml has been modified by another source, please refresh");
    this.name = "AccessVersionConflictError";
  }
}

export const ROLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
  actor_id?: string | null;
  actor_kind?: "person" | "automation" | null;
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
  /**
   * Lucy v0.25 P1-1 §3.1 — 行策略模板引用。
   *
   * 引用存在时，模板谓词与内联谓词在**同一条选择器内 AND**；模板名只作溯源，不改变
   * 展开后的语义。引用形态在写入配置时保留，运行时在行策略编译器之前展开
   * （`proxy/acl.ts` 的模板展开钩子），所以配置文件里不会留下展开后的产物。
   */
  template?: string;
  /**
   * 内联谓词。引用模板时可缺省（此时模板谓词单独生效）；不引用模板时必须非空。
   */
  predicates?: Array<{
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

/**
 * Spec 174 §3.2 — the display barrier covers persist → policy commit/ack →
 * optional direct rollback, so no intermediate access version is published.
 */
export async function writeAccessYaml(
  ...args: Parameters<typeof writeAccessYamlInBarrier>
): ReturnType<typeof writeAccessYamlInBarrier> {
  return withDisplayWriteBarrier(["P"], () => writeAccessYamlInBarrier(...args));
}

export interface AccessConfigAuditIntent {
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
  actorIp?: string;
  sessionId?: string | null;
  idempotencyKey?: string;
  operation?: string;
  assetKind?: ConfigAuditAssetKind;
  /** Optional optimistic-concurrency token captured by the read/ preview path. */
  expectedVersion?: string;
}

export interface AccessConfigWriteResult {
  auditId?: number;
  policyVersion: string;
  policyRuntimeAck: boolean;
  runtimeAck: boolean;
  /** true when the write was reverted and the previous policy was re-committed. */
  rolledBack?: boolean;
}

async function writeAccessYamlInBarrier(
  projectRoot: string,
  config: YamlAccessConfig,
  audit?: AccessConfigAuditIntent
): Promise<AccessConfigWriteResult> {
  const toWrite: YamlAccessConfig = {
    ...config,
    users: config.users.map((u) => ({
      ...u,
      tokens: u.tokens.map(({ ...t }) => t)
    }))
  };
  const content = stringify(toWrite, { lineWidth: 0 });
  return writeAccessConfigFileWithAuditClosure(projectRoot, ACCESS_YAML_REL, content, audit, {
    source: audit?.source ?? "admin_access_config_api",
    expectedVersion: audit?.expectedVersion,
    onCommitted: async (previousRaw) => {
      // T04-3 / Spec §3.3 — narrower authority is persisted and committed above;
      // cancel in-flight work and clear caches before this write reports success.
      const narrowed = narrowingScopeForWrite(previousRaw, toWrite);
      if (narrowed) await narrowAuthorization(narrowed);
    }
  });
}

/**
 * Lucy v0.25 (L25-14 §3.4/§5.3, L25-11 §7.2) — the shared access-configuration write
 * closure. Both the Role / row-policy writer and the Agent writer go through it, so
 * there is exactly one durable-audit contract for `access.yaml`:
 *
 *   durable intent → atomic write → runtime commit/ack → durable terminal
 *
 * - The intent is persisted BEFORE any configuration is written. No intent ⇒ no write.
 * - The terminal is persisted AFTER the write and the runtime swap. A terminal that
 *   cannot be persisted reverts the configuration and re-commits the previous policy.
 * - A revert that cannot be verified leaves the recovery gate closed: the runtime
 *   degrades globally and further writes are rejected.
 */
export async function writeAccessConfigFileWithAuditClosure(
  projectRoot: string,
  relPath: string,
  content: string,
  audit: AccessConfigAuditIntent | undefined,
  options: {
    source: string;
    assetKind?: ConfigAuditAssetKind;
    /** Which publish-window entry class this write belongs to. */
    kind?: PublishEntryKind;
    expectedVersion?: string;
    onCommitted?: (previousRaw: string | undefined) => Promise<void>;
  }
): Promise<AccessConfigWriteResult> {
  // ── shared publish window (L25-11 D4 / L25-14 D6) ────────────────────────
  // The whole write → commit → terminal sequence runs inside the publish window, so a
  // role / row-policy save can never interleave with a semantic-asset publish or a
  // manual reindex.
  return withPublishCoordinator(
    options.kind ?? "role_policy_save",
    () => writeAccessConfigFileWithAuditClosureInner(projectRoot, relPath, content, audit, options),
    { projectRoot }
  );
}

async function writeAccessConfigFileWithAuditClosureInner(
  projectRoot: string,
  relPath: string,
  content: string,
  audit: AccessConfigAuditIntent | undefined,
  options: {
    source: string;
    assetKind?: ConfigAuditAssetKind;
    kind?: PublishEntryKind;
    expectedVersion?: string;
    onCommitted?: (previousRaw: string | undefined) => Promise<void>;
  }
): Promise<AccessConfigWriteResult> {
  // Lucy v0.25 (L25-14 §5.3) — an unresolved recovery blocks every further write.
  assertAccessWritesAllowed(await readAccessRecoveryState(projectRoot));

  // D-21: compare the preview token after entering the shared publish window.
  // A stale candidate can no longer overwrite a newer Role or Agent save.
  if (options.expectedVersion !== undefined) {
    const current = await readAccessYamlVersion(projectRoot);
    if (current.version !== options.expectedVersion) throw new AccessVersionConflictError();
  }

  const paths = await loadContentPaths();
  const accessPath = path.join(projectRoot, relPath);
  let previousRaw: string | undefined;
  try {
    previousRaw = await readFile(accessPath, "utf-8");
  } catch {
    previousRaw = undefined;
  }

  const {
    commitEffectivePolicy,
    computeAccessConfigDigest,
    evaluateRuntimeAck
  } = await import("../proxy/acl.js");
  // Digest of the exact YAML bytes we are about to persist (post-stringify parse).
  const expectedDigest = computeAccessConfigDigest(parse(content) as Parameters<typeof computeAccessConfigDigest>[0]);

  // ── durable intent: persisted BEFORE any configuration is written ──────────
  let intentId: number | undefined;
  if (audit?.enabled) {
    const intent = await beginConfigAuditIntent(
      projectRoot,
      relPath,
      {
        enabled: true,
        changeType: audit.changeType,
        assetKind: audit.assetKind ?? options.assetKind ?? "governance",
        operation: audit.operation,
        actor: audit.actor,
        actorType: audit.actorType ?? "ui_admin",
        actorIp: audit.actorIp,
        sessionId: audit.sessionId,
        source: audit.source ?? options.source,
        targetId: audit.targetId,
        oldSummary: audit.oldSummary,
        newSummary: audit.newSummary,
        diff: audit.diff,
        requestId: audit.requestId,
        idempotencyKey: audit.idempotencyKey
      },
      { newText: content }
    );
    intentId = intent.intentId;
    if (intentId === undefined) {
      // No durable intent ⇒ no configuration write at all.
      throw new Error("audit_intent_unavailable: 配置审计意图未持久化，本次未写入任何配置");
    }
  }

  /**
   * Restore the previous configuration and re-commit the previous policy. When the
   * restore cannot be verified, Lucy must not keep serving permissions from an unknown
   * state: the recovery gate degrades the runtime and blocks further writes.
   */
  const rollbackAndVerify = async (failure: unknown): Promise<AccessConfigWriteResult> => {
    const reason = failure instanceof Error ? failure.message : String(failure);
    try {
      if (previousRaw !== undefined) {
        await safeWriteAtomic(paths, projectRoot, relPath, previousRaw);
      } else {
        await safeRemove(paths, projectRoot, relPath);
      }
    } catch (restoreError) {
      const restoreReason = restoreError instanceof Error ? restoreError.message : String(restoreError);
      await markAccessRecoveryRequired(projectRoot, {
        reason: `restore_failed:${restoreReason}`,
        operationId: intentId === undefined ? undefined : String(intentId)
      });
      await commitEffectivePolicy();
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "failed",
        errorReason: `recovery_required:${restoreReason}`
      }).catch(() => undefined);
      throw new AccessRecoveryRequiredError({
        required: true,
        reason: `restore_failed:${restoreReason}`
      });
    }

    const rollbackStatus = await commitEffectivePolicy();
    const previousDigest =
      previousRaw === undefined ? "" : computeAccessConfigDigest(parse(previousRaw) as Parameters<typeof computeAccessConfigDigest>[0]);
    // Verification is a direct fact — the runtime now reflects the restored bytes.
    // It must NOT reuse `evaluateRuntimeAck`, whose policy is "the caller may not be
    // acked", and which would turn a successful rollback into a false recovery alarm.
    const rollbackVerified =
      previousRaw === undefined ? true : rollbackStatus.accessConfigDigest === previousDigest;

    if (!rollbackVerified) {
      await markAccessRecoveryRequired(projectRoot, {
        reason: `rollback_unverified:${reason}`,
        operationId: intentId === undefined ? undefined : String(intentId)
      });
      // The recovery gate makes the runtime degrade globally: the data plane denies
      // instead of serving rows under an unverified policy.
      await commitEffectivePolicy();
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "failed",
        errorReason: `recovery_required:${reason}`
      }).catch(() => undefined);
      throw new AccessRecoveryRequiredError({
        required: true,
        reason: `rollback_unverified:${reason}`
      });
    }

    await completeConfigAuditTerminal(intentId, {
      writeStatus: "rolled_back",
      errorReason: reason
    }).catch(() => undefined);

    return {
      auditId: intentId,
      policyVersion: rollbackStatus.policyVersion,
      policyRuntimeAck: false,
      runtimeAck: false,
      rolledBack: true
    };
  };

  try {
    await auditedWriteFile(
      projectRoot,
      relPath,
      content,
      audit
        ? {
            enabled: true,
            changeType: audit.changeType,
            assetKind: audit.assetKind ?? options.assetKind ?? "governance",
            operation: audit.operation,
            actor: audit.actor,
            actorType: audit.actorType ?? "ui_admin",
            actorIp: audit.actorIp,
            sessionId: audit.sessionId,
            source: audit.source ?? options.source,
            targetId: audit.targetId,
            oldSummary: audit.oldSummary,
            newSummary: audit.newSummary,
            diff: audit.diff,
            requestId: audit.requestId,
            idempotencyKey: audit.idempotencyKey
          }
        : undefined,
      { intentId, deferTerminal: true }
    );
  } catch (error) {
    await completeConfigAuditTerminal(intentId, {
      writeStatus: "failed",
      errorReason: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }

  // Spec 98 §8.2 — commit after write; ack only when runtime digest matches this write.
  const status = await commitEffectivePolicy();
  const runtimeAck = evaluateRuntimeAck(status, expectedDigest);

  // Spec 98 §8.2 step 4 — runtime switch/compile failure → roll disk back; never ack stale widen.
  if (!runtimeAck) {
    return rollbackAndVerify(new Error("runtime_ack_failed: 运行态策略未确认本次写入"));
  }

  try {
    await completeConfigAuditTerminal(intentId, {
      writeStatus: "committed",
      diff: audit?.diff,
      oldSummary: audit?.oldSummary,
      newSummary: audit?.newSummary
    });
  } catch (error) {
    // The terminal audit could not be persisted. The configuration must not stay in
    // place without a valid terminal record: revert and re-commit the old policy.
    return rollbackAndVerify(error);
  }

  // T04-3 / Spec §3.3 — narrower authority is persisted and committed above;
  // cancel in-flight work and clear caches before this write reports success.
  await options.onCommitted?.(previousRaw);

  return {
    auditId: intentId,
    policyVersion: status.policyVersion,
    policyRuntimeAck: runtimeAck,
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
