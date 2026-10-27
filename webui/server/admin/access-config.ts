import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { beginConfigAuditIntent, auditedWriteFile, completeConfigAuditTerminal } from "./config-audit-write.js";
import {
  registerInFlightAccessConfigIntent,
  releaseInFlightAccessConfigIntent
} from "./config-audit-intents.js";
import { withPublishCoordinator, type PublishEntryKind } from "../publish-coordinator.js";
import { safeRemove, safeWriteAtomic } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import {
  AccessRecoveryRequiredError,
  assertAccessWritesAllowed,
  markAccessRecoveryRequired,
  readAccessRecoveryState,
  setInMemoryRecoveryRequiredSync
} from "../access-recovery.js";
import type { ConfigAuditAssetKind, ConfigAuditActorType } from "./audit.js";
import { withDisplayWriteBarrier } from "../display-generation.js";
import { narrowAuthorization, narrowingScopeForWrite } from "../proxy/authorization-barrier.js";
import type { PolicyRuntimeStatus } from "../proxy/acl.js";

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

/**
 * Spec §14.3.2 — the three terminal states of an access-configuration write.
 *
 * They must never be mixed:
 *  - `committed`         — the candidate IS the current effective configuration,
 *  - `rolled_back`       — the old configuration AND the old policy were verified
 *                          back; the candidate was NOT saved,
 *  - `recovery_required` — the affected reads and the subsequent writes are
 *                          blocked; the state could not be proven either way.
 */
export type AccessWriteStatus = "committed" | "rolled_back" | "recovery_required";

export interface AccessConfigWriteResult {
  /** The terminal state. */
  status: AccessWriteStatus;
  /**
   * Whether the candidate has been confirmed as the CURRENT effective
   * configuration. Only `committed` may report `true`.
   *
   * Spec §14.3.2: `written:false` does NOT prove that the disk never changed —
   * whether a partial write happened is disclosed separately.
   */
  written: boolean;
  /** The runtime confirmed the candidate. Only `committed` may report `true`. */
  runtimeAck: boolean;
  /** The gate is closed: reads and further writes are blocked. */
  recoveryRequired: boolean;
  auditId?: number;
  policyVersion: string;
  policyRuntimeAck: boolean;
  /** The digest of the candidate that was the TARGET of this write. */
  candidateDigest?: string;
  /** The digest the runtime actually serves after the operation. */
  effectiveDigest?: string;
  /** Whether the durable recovery marker could be persisted. */
  recoveryMarker?: "persisted" | "unconfirmed";
  /**
   * The terminal audit fact.
   *
   * Spec §14.3.2: a `rolled_back` outcome reports `rolled_back`（终结审计已写入）
   * or `unconfirmed`（补写失败，不得声称终结审计已完成）; a `recovery_required`
   * outcome reports `persisted` or `unconfirmed`.
   */
  terminalAudit?: "persisted" | "rolled_back" | "unconfirmed";
  /** The failure that caused a non-committed outcome. */
  failureReason?: string;
  /** The recovery failure, when the outcome is `recovery_required`. */
  recoveryFailureReason?: string;
  /** Historical alias: true for `rolled_back`. */
  rolledBack?: boolean;
}

/**
 * Spec §14.2.2 — run a role / row-policy save inside the shared publish window.
 *
 * The window covers: the permission and recovery re-check, the access and
 * compile-input baseline re-read, the candidate rebuild, the final preview and
 * the confirmation comparison, the durable intent, the configuration write, the
 * runtime swap, the terminal audit and the failure recovery.
 *
 * A read-only preview, an independent validation and a report query stay
 * OUTSIDE the window and may run in parallel.
 */
export async function runInAccessPublishWindow<T>(
  kind: PublishEntryKind,
  projectRoot: string,
  fn: () => Promise<T>
): Promise<T> {
  return withPublishCoordinator(kind, fn, { projectRoot });
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
    // The intent is in flight: it is legitimately `pending` until the terminal
    // record is written, so the recovery gate must not read it as an
    // unresolved recovery (spec §14.3.1).
    registerInFlightAccessConfigIntent(intentId);
  }

  /**
   * Spec §14.3.1 — the recovery point.
   *
   * It captures the exact bytes on disk AND the digest of the policy that was
   * effective before the attempt, so a rollback can be VERIFIED against both.
   */
  const recoveryPoint = {
    raw: previousRaw,
    accessConfigDigest: previousRaw === undefined
      ? ""
      : computeAccessConfigDigest(parse(previousRaw) as Parameters<typeof computeAccessConfigDigest>[0])
  };

  /**
   * Spec §14.3.1 — `closeForRecovery`.
   *
   * The FIRST step must not await: the in-memory latch is set synchronously so
   * the affected data plane and every subsequent access write are blocked
   * immediately. Only then are the durable steps attempted, and each of them may
   * fail on its own — a failure is COLLECTED, never rethrown in a way that
   * bypasses the `RECOVERY_REQUIRED` result.
   */
  const closeForRecovery = async (
    originalFailure: unknown,
    recoveryFailure: unknown
  ): Promise<AccessConfigWriteResult> => {
    const originalReason = originalFailure instanceof Error ? originalFailure.message : String(originalFailure);
    const recoveryReason = recoveryFailure instanceof Error ? recoveryFailure.message : String(recoveryFailure);

    // ── step 1: the synchronous in-memory latch (no await) ──────────────────
    const latch = setInMemoryRecoveryRequiredSync({
      reason: `recovery_failed:${originalReason}:${recoveryReason}`,
      operationId: intentId === undefined ? undefined : String(intentId)
    });

    // ── step 2: the durable marker (atomic; its failure is collected) ──────
    let recoveryMarker: "persisted" | "unconfirmed" = "unconfirmed";
    try {
      await markAccessRecoveryRequired(projectRoot, {
        reason: latch.reason ?? "recovery_required",
        operationId: latch.operationId
      });
      recoveryMarker = "persisted";
    } catch {
      // The marker could not be written. The in-memory latch stays closed.
      recoveryMarker = "unconfirmed";
    }

    // ── step 3: the runtime degrade (its rejection is collected) ───────────
    let degradeState: "persisted" | "unconfirmed" = "unconfirmed";
    try {
      await commitEffectivePolicy();
      degradeState = "persisted";
    } catch {
      degradeState = "unconfirmed";
    }

    // ── step 4: the terminal audit (its failure is collected) ─────────────
    let terminalAudit: "persisted" | "unconfirmed" = "unconfirmed";
    try {
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "failed",
        errorReason: `recovery_required:${originalReason}:${recoveryReason}`
      });
      terminalAudit = "persisted";
    } catch {
      terminalAudit = "unconfirmed";
    } finally {
      releaseInFlightAccessConfigIntent(intentId);
    }

    return {
      status: "recovery_required",
      written: false,
      runtimeAck: false,
      recoveryRequired: true,
      auditId: intentId,
      policyVersion: "",
      policyRuntimeAck: false,
      candidateDigest: expectedDigest,
      effectiveDigest: undefined,
      recoveryMarker,
      terminalAudit,
      failureReason: originalReason,
      recoveryFailureReason: recoveryReason
    };
  };

  /**
   * Spec §14.3.1 — `rollbackOrClose`.
   *
   * The rollback restores the previous bytes and re-commits the previous policy,
   * and then VERIFIES that the runtime really serves the recovery point. A
   * rollback that cannot be verified is not a rollback — it escalates to
   * `closeForRecovery`.
   */
  const rollbackOrClose = async (
    originalFailure: unknown
  ): Promise<AccessConfigWriteResult> => {
    const originalReason = originalFailure instanceof Error ? originalFailure.message : String(originalFailure);
    try {
      if (recoveryPoint.raw !== undefined) {
        await safeWriteAtomic(paths, projectRoot, relPath, recoveryPoint.raw);
      } else {
        await safeRemove(paths, projectRoot, relPath);
      }
    } catch (restoreError) {
      return closeForRecovery(originalFailure, restoreError);
    }

    let rollbackStatus: PolicyRuntimeStatus;
    try {
      rollbackStatus = await commitEffectivePolicy();
    } catch (commitError) {
      return closeForRecovery(originalFailure, commitError);
    }

    // Verification is a direct fact — the runtime now reflects the restored bytes.
    // It must NOT reuse `evaluateRuntimeAck`, whose policy is "the caller may not be
    // acked", and which would turn a successful rollback into a false recovery alarm.
    const rollbackVerified =
      recoveryPoint.raw === undefined
        ? true
        : rollbackStatus.accessConfigDigest === recoveryPoint.accessConfigDigest;
    if (!rollbackVerified) {
      return closeForRecovery(
        originalFailure,
        new Error(
          `rollback_unverified:expected=${recoveryPoint.accessConfigDigest}:actual=${rollbackStatus.accessConfigDigest}`
        )
      );
    }

    // The rolled_back terminal may itself fail — that is disclosed, never faked.
    let terminalAudit: "rolled_back" | "unconfirmed" = "unconfirmed";
    try {
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "rolled_back",
        errorReason: originalReason
      });
      terminalAudit = "rolled_back";
    } catch {
      terminalAudit = "unconfirmed";
    } finally {
      releaseInFlightAccessConfigIntent(intentId);
    }

    return {
      status: "rolled_back",
      written: false,
      runtimeAck: false,
      recoveryRequired: false,
      auditId: intentId,
      policyVersion: rollbackStatus.policyVersion,
      policyRuntimeAck: false,
      candidateDigest: expectedDigest,
      effectiveDigest: rollbackStatus.accessConfigDigest,
      recoveryMarker: undefined,
      terminalAudit,
      failureReason: originalReason,
      rolledBack: true
    };
  };

  /**
   * Spec §14.3.1 — `writeCommitTerminalOrRecover`.
   *
   * The write, the FIRST runtime commit and the committed terminal are all
   * inside one protected region: `commitEffectivePolicy` is a rejectable async
   * call and must never sit on an unprotected call site.
   */
  let committedStatus: PolicyRuntimeStatus | undefined;
  try {
    await auditedWriteFile(
      projectRoot,
      relPath,
      content,
      audit
        ? {
            // The audit flag is the CALLER's flag. Hard-coding `true` here used
            // to create a SECOND intent (the one the block above already
            // persisted) whose terminal was never written — an unterminated
            // intent that the recovery gate correctly reads as an unresolved
            // write (spec §14.3.1).
            enabled: audit.enabled,
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

    // Spec 98 §8.2 — commit after write; ack only when runtime digest matches this write.
    const status = await commitEffectivePolicy();
    const runtimeAck = evaluateRuntimeAck(status, expectedDigest);

    // Spec 98 §8.2 step 4 — runtime switch/compile failure → roll disk back; never ack stale widen.
    if (!runtimeAck) {
      return rollbackOrClose(new Error("runtime_ack_failed: 运行态策略未确认本次写入"));
    }

    await completeConfigAuditTerminal(intentId, {
      writeStatus: "committed",
      diff: audit?.diff,
      oldSummary: audit?.oldSummary,
      newSummary: audit?.newSummary
    });
    releaseInFlightAccessConfigIntent(intentId);
    committedStatus = status;
  } catch (error) {
    // The write, the first commit or the committed terminal failed. The candidate
    // must not stay in place without a valid terminal record: revert and
    // re-commit the old policy, or close the gate.
    return rollbackOrClose(error);
  }

  // T04-3 / Spec §3.3 — narrower authority is persisted and committed above;
  // cancel in-flight work and clear caches before this write reports success.
  await options.onCommitted?.(previousRaw);

  return {
    status: "committed",
    written: true,
    runtimeAck: true,
    recoveryRequired: false,
    auditId: intentId,
    policyVersion: committedStatus?.policyVersion ?? "",
    policyRuntimeAck: true,
    candidateDigest: expectedDigest,
    effectiveDigest: committedStatus?.accessConfigDigest,
    recoveryMarker: undefined,
    terminalAudit: "persisted"
  };
}

/**
 * Spec §14.3.2 — the three terminal states as an API result.
 *
 * The three states must never be mixed:
 *
 * | state              | HTTP | `ok`    | `written` | `runtimeAck` | `recoveryRequired` |
 * |--------------------|------|---------|-----------|--------------|--------------------|
 * | `committed`        | 200  | `true`  | `true`    | `true`       | `false`            |
 * | `rolled_back`      | 500  | `false` | `false`   | `false`      | `false`            |
 * | `recovery_required`| 503  | `false` | `false`   | `false`      | `true`             |
 *
 * `written` only means 「the candidate has been confirmed as the CURRENT
 * effective configuration」. It does NOT mean that nothing was ever written:
 * whether a partial write happened is disclosed by `attemptedWrite` and the
 * actual digest that is in effect.
 */
export function accessWriteStatusHttpCode(status: AccessWriteStatus): number {
  switch (status) {
    case "committed":
      return 200;
    case "rolled_back":
      return 500;
    case "recovery_required":
      return 503;
  }
}

export function accessWriteStatusErrorCode(
  status: AccessWriteStatus
): string | undefined {
  switch (status) {
    case "committed":
      return undefined;
    case "rolled_back":
      return "ROW_POLICY_SAVE_ROLLED_BACK";
    case "recovery_required":
      return "ACCESS_RECOVERY_REQUIRED";
  }
}

export function accessWriteStatusMessage(status: AccessWriteStatus): string {
  switch (status) {
    case "committed":
      return "保存成功：新配置已生效。";
    case "rolled_back":
      return "保存未生效：新变更已回滚，旧配置与旧策略已核验恢复。";
    case "recovery_required":
      return "保存中断：受影响读取与后续写入已阻断，需要人工核验恢复。";
  }
}

/**
 * Build the API envelope for an access-configuration write.
 *
 * The UI must not derive success from the HTTP status alone, from
 * `runtimeAck` alone, or from the local draft state: only `committed` is a
 * success.
 */
export function accessWriteResponseBody(
  result: AccessConfigWriteResult,
  extra: Record<string, unknown> = {}
): { statusCode: number; body: Record<string, unknown> } {
  const errorCode = accessWriteStatusErrorCode(result.status);
  const base = {
    status: result.status,
    written: result.written,
    runtimeAck: result.runtimeAck,
    recoveryRequired: result.recoveryRequired,
    ...extra
  };
  if (!errorCode) {
    return { statusCode: 200, body: { ok: true, data: base } };
  }
  return {
    statusCode: accessWriteStatusHttpCode(result.status),
    body: {
      ok: false,
      written: result.written,
      runtimeAck: result.runtimeAck,
      recoveryRequired: result.recoveryRequired,
      error: {
        code: errorCode,
        message: accessWriteStatusMessage(result.status),
        detail: {
          status: result.status,
          auditId: result.auditId,
          candidateDigest: result.candidateDigest,
          effectiveDigest: result.effectiveDigest,
          failureReason: result.failureReason,
          recoveryFailureReason: result.recoveryFailureReason,
          recoveryMarker: result.recoveryMarker ?? "unconfirmed",
          terminalAudit: result.terminalAudit ?? "unconfirmed"
        }
      },
      data: base
    }
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
