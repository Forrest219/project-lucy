import { readFile } from "node:fs/promises";
import { assertReadable, safeRemove, safeWriteAtomic } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import { auditDiffForContent } from "../security/redaction.js";
import {
  recordConfigChange,
  updateConfigChangeStatus,
  type ConfigAuditActorType,
  type ConfigAuditAssetKind,
  type ConfigAuditWriteStatus
} from "./audit.js";

/**
 * Lucy v0.25 — durable configuration-audit intent / terminal primitives.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §3.4/§5.3/§7
 * and docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §7.2/§7.3.
 *
 * Contract:
 * - The intent record is persisted BEFORE any configuration is written, and its id is
 *   returned to the caller at that point. A caller that never receives an intent id must
 *   not write configuration.
 * - The terminal record is persisted AFTER the write and (where applicable) after the
 *   runtime policy swap. If the terminal record cannot be persisted, the caller must
 *   roll the configuration back and re-commit the previous policy.
 * - Both records live in the existing `config_change_log` table. No new storage.
 * - `write_status` values: pending (intent), committed (terminal success),
 *   failed (terminal failure), rolled_back (write succeeded and was reverted).
 */

export type AuditIntent = {
  enabled: boolean;
  changeType: string;
  assetKind: ConfigAuditAssetKind;
  operation?: string;
  actor?: string;
  actorType?: ConfigAuditActorType;
  actorIp?: string;
  source?: string;
  targetId?: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
  requestId?: string;
  sessionId?: string | null;
  idempotencyKey?: string;
};

async function readTextIfExists(projectRoot: string, relPath: string): Promise<string> {
  try {
    const paths = await loadContentPaths();
    const abs = await assertReadable(paths, projectRoot, relPath);
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

/**
 * Persist the durable intent record. Returns the intent id so the caller can later
 * write the terminal record for exactly this attempt.
 *
 * `options.newText` is the content that is about to be written. It is required for
 * content asset kinds (wiki / skill): their diff is derived from the frontmatter and
 * body digests, not from a caller-provided diff string.
 */
export async function beginConfigAuditIntent(
  projectRoot: string,
  relPath: string,
  auditIntent?: AuditIntent,
  options: { newText?: string } = {}
): Promise<{ intentId: number | undefined }> {
  if (!auditIntent?.enabled) return { intentId: undefined };

  const oldText = await readTextIfExists(projectRoot, relPath);
  const diff = auditDiffForContent({
    assetKind: auditIntent.assetKind,
    relPath,
    oldText,
    newText: options.newText ?? "",
    provided: auditIntent.diff
  });

  const intentId = await recordConfigChange({
    filePath: relPath,
    changeType: auditIntent.changeType,
    actor: auditIntent.actor,
    actorType: auditIntent.actorType ?? "ui_admin",
    actorIp: auditIntent.actorIp,
    source: auditIntent.source,
    assetKind: auditIntent.assetKind,
    operation: auditIntent.operation,
    targetId: auditIntent.targetId,
    oldSummary: auditIntent.oldSummary,
    newSummary: auditIntent.newSummary,
    diff,
    requestId: auditIntent.requestId,
    sessionId: auditIntent.sessionId,
    idempotencyKey: auditIntent.idempotencyKey,
    writeStatus: "pending"
  });

  return { intentId };
}

/**
 * Persist the durable terminal record for a previously written intent.
 *
 * A missing intent id is a no-op: nothing was audited, so nothing can be terminated.
 */
export async function completeConfigAuditTerminal(
  intentId: number | undefined,
  input: {
    writeStatus: ConfigAuditWriteStatus;
    errorReason?: string;
    diff?: string | null;
    oldSummary?: unknown;
    newSummary?: unknown;
  }
): Promise<void> {
  if (intentId === undefined) return;
  await updateConfigChangeStatus({
    id: intentId,
    writeStatus: input.writeStatus,
    errorReason: input.errorReason,
    diff: input.diff,
    oldSummary: input.oldSummary,
    newSummary: input.newSummary
  });
}

/**
 * Options for the write helpers.
 *
 * `intentId` — a durable intent that was already persisted for this write. The helper
 * will not create a second one.
 * `deferTerminal` — the caller owns the terminal record. Used by the access-config
 * closure, where the terminal may only be written after the runtime policy swap.
 */
export interface AuditedWriteOptions {
  intentId?: number;
  deferTerminal?: boolean;
}

export async function auditedWriteFile(
  projectRoot: string,
  relPath: string,
  content: string,
  auditIntent?: AuditIntent,
  options: AuditedWriteOptions = {}
): Promise<{ auditId?: number }> {
  if (!auditIntent?.enabled && options.intentId === undefined) {
    const paths = await loadContentPaths();
    await safeWriteAtomic(paths, projectRoot, relPath, content);
    return {};
  }

  const oldText = await readTextIfExists(projectRoot, relPath);
  const diff = auditDiffForContent({
    assetKind: auditIntent?.assetKind,
    relPath,
    oldText,
    newText: content,
    provided: auditIntent?.diff
  });

  const intentId =
    options.intentId ??
    (
      await beginConfigAuditIntent(
        projectRoot,
        relPath,
        { ...(auditIntent as AuditIntent), diff },
        { newText: content }
      )
    ).intentId;

  try {
    const paths = await loadContentPaths();
    await safeWriteAtomic(paths, projectRoot, relPath, content);
  } catch (error) {
    if (!options.deferTerminal) {
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "failed",
        errorReason: error instanceof Error ? error.message : String(error),
        diff
      }).catch(() => undefined);
    }
    throw error;
  }

  if (!options.deferTerminal) {
    await completeConfigAuditTerminal(intentId, {
      writeStatus: "committed",
      diff,
      oldSummary: auditIntent?.oldSummary,
      newSummary: auditIntent?.newSummary
    });
  }

  return { auditId: intentId };
}

export async function auditedRemoveFile(
  projectRoot: string,
  relPath: string,
  auditIntent?: AuditIntent,
  options: AuditedWriteOptions = {}
): Promise<{ auditId?: number }> {
  if (!auditIntent?.enabled && options.intentId === undefined) {
    const paths = await loadContentPaths();
    await safeRemove(paths, projectRoot, relPath);
    return {};
  }

  const oldText = await readTextIfExists(projectRoot, relPath);
  const diff = auditDiffForContent({
    assetKind: auditIntent?.assetKind,
    relPath,
    oldText,
    newText: "",
    provided: auditIntent?.diff
  });

  const intentId =
    options.intentId ??
    (
      await beginConfigAuditIntent(
        projectRoot,
        relPath,
        { ...(auditIntent as AuditIntent), diff },
        { newText: "" }
      )
    ).intentId;

  try {
    const paths = await loadContentPaths();
    await safeRemove(paths, projectRoot, relPath);
  } catch (error) {
    if (!options.deferTerminal) {
      await completeConfigAuditTerminal(intentId, {
        writeStatus: "failed",
        errorReason: error instanceof Error ? error.message : String(error),
        diff
      }).catch(() => undefined);
    }
    throw error;
  }

  if (!options.deferTerminal) {
    await completeConfigAuditTerminal(intentId, { writeStatus: "committed", diff });
  }

  return { auditId: intentId };
}
