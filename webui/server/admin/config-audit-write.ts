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
/**
 * Thrown when the written content was restored after a failed terminal record.
 * The change did NOT take effect; the caller reports a failed write, not a
 * success, and the ledger keeps the `rolled_back` evidence.
 */
export class AuditedWriteRolledBackError extends Error {
  readonly code = "config_audit_rolled_back";
  constructor(message: string) {
    super(message);
    this.name = "AuditedWriteRolledBackError";
  }
}

/**
 * Thrown when the written content could NOT be restored after the terminal
 * record failed to persist. The evidence stays in the ledger as `pending`, and
 * the caller must surface a repair request instead of claiming success.
 */
export class AuditedWriteRollbackError extends Error {
  readonly code = "config_audit_rollback_failed";
  constructor(message: string) {
    super(message);
    this.name = "AuditedWriteRollbackError";
  }
}

/**
 * Thrown when the durable audit intent could not be persisted. The content is
 * NOT written in that case: a change that nobody recorded must not reach disk.
 */
export class AuditedWriteIntentError extends Error {
  readonly code = "config_audit_intent_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "AuditedWriteIntentError";
  }
}

export interface AuditedWriteOptions {
  intentId?: number;
  deferTerminal?: boolean;
  /**
   * When the audit is enabled but the intent record cannot be persisted, nothing
   * is written at all. The helper's own contract says a caller that never
   * receives an intent id must not write configuration (Spec §4.2 / SKO-12).
   */
  requireIntent?: boolean;
  /**
   * L25-04 / F-03: when the committed terminal record cannot be persisted, the
   * written content is restored to its previous bytes and the attempt is recorded
   * as `rolled_back`. Without this, content that was written but never audited
   * stays on disk while the ledger still says `pending`.
   */
  rollbackOnTerminalFailure?: boolean;
}

type ExistingContent = { text: string; existed: boolean };

/** Read the current content AND whether it existed — a rollback needs both. */
async function readExistingContent(projectRoot: string, relPath: string): Promise<ExistingContent> {
  try {
    const paths = await loadContentPaths();
    const abs = await assertReadable(paths, projectRoot, relPath);
    return { text: await readFile(abs, "utf8"), existed: true };
  } catch {
    return { text: "", existed: false };
  }
}

/** Restore the previous bytes; a file that did not exist is removed again. */
async function restorePreviousContent(
  projectRoot: string,
  relPath: string,
  previous: ExistingContent
): Promise<boolean> {
  try {
    const paths = await loadContentPaths();
    if (previous.existed) {
      await safeWriteAtomic(paths, projectRoot, relPath, previous.text);
    } else {
      await safeRemove(paths, projectRoot, relPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared terminal-commit path: persist `committed`, and on failure either roll the
 * content back (opt-in) or surface the original error.
 */
async function commitTerminalOrRollback(
  intentId: number | undefined,
  projectRoot: string,
  relPath: string,
  previous: ExistingContent,
  terminalInput: {
    writeStatus: ConfigAuditWriteStatus;
    diff?: string | null;
    oldSummary?: unknown;
    newSummary?: unknown;
  },
  options: AuditedWriteOptions
): Promise<void> {
  try {
    await completeConfigAuditTerminal(intentId, terminalInput);
    return;
  } catch (terminalError) {
    if (!options.rollbackOnTerminalFailure) {
      throw terminalError;
    }
    const reason = terminalError instanceof Error ? terminalError.message : String(terminalError);
    const restored = await restorePreviousContent(projectRoot, relPath, previous);
    if (!restored) {
      // The content is still on disk and the ledger still says pending. Do not
      // claim a rollback that did not happen.
      throw new AuditedWriteRollbackError(
        `config audit terminal failed (${reason}) and the previous content could not be restored`
      );
    }
    await completeConfigAuditTerminal(intentId, {
      writeStatus: "rolled_back",
      errorReason: reason,
      diff: terminalInput.diff
    }).catch(() => undefined);
    throw new AuditedWriteRolledBackError(
      `config audit terminal failed (${reason}); the previous content was restored`
    );
  }
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

  const previous = await readExistingContent(projectRoot, relPath);
  const oldText = previous.text;
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

  if (options.requireIntent && intentId === undefined) {
    throw new AuditedWriteIntentError(
      `the config audit intent for ${relPath} could not be persisted; nothing was written`
    );
  }

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
    await commitTerminalOrRollback(
      intentId,
      projectRoot,
      relPath,
      previous,
      {
        writeStatus: "committed",
        diff,
        oldSummary: auditIntent?.oldSummary,
        newSummary: auditIntent?.newSummary
      },
      options
    );
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

  const previous = await readExistingContent(projectRoot, relPath);
  const oldText = previous.text;
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

  if (options.requireIntent && intentId === undefined) {
    throw new AuditedWriteIntentError(
      `the config audit intent for ${relPath} could not be persisted; nothing was removed`
    );
  }

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
    await commitTerminalOrRollback(intentId, projectRoot, relPath, previous, { writeStatus: "committed", diff }, options);
  }

  return { auditId: intentId };
}
