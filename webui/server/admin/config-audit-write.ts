import { readFile } from "node:fs/promises";
import { previewDiff } from "../diff.js";
import { assertReadable, safeRemove, safeWrite } from "../fs-safe.js";
import {
  recordConfigChange,
  updateConfigChangeStatus,
  type ConfigAuditActorType,
  type ConfigAuditAssetKind
} from "./audit.js";

type AuditIntent = {
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
    const abs = await assertReadable(projectRoot, relPath);
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

export async function auditedWriteFile(
  projectRoot: string,
  relPath: string,
  content: string,
  auditIntent?: AuditIntent
): Promise<{ auditId?: number }> {
  if (!auditIntent?.enabled) {
    await safeWrite(projectRoot, relPath, content);
    return {};
  }
  const oldText = await readTextIfExists(projectRoot, relPath);
  const diff = auditIntent.diff ?? previewDiff(oldText, content, relPath);
  const auditId = await recordConfigChange({
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
  try {
    await safeWrite(projectRoot, relPath, content);
    if (auditId) {
      await updateConfigChangeStatus({
        id: auditId,
        writeStatus: "committed",
        diff,
        oldSummary: auditIntent.oldSummary,
        newSummary: auditIntent.newSummary
      });
    }
    return { auditId };
  } catch (error) {
    if (auditId) {
      await updateConfigChangeStatus({
        id: auditId,
        writeStatus: "failed",
        errorReason: error instanceof Error ? error.message : String(error),
        diff,
        oldSummary: auditIntent.oldSummary,
        newSummary: auditIntent.newSummary
      });
    }
    throw error;
  }
}

export async function auditedRemoveFile(
  projectRoot: string,
  relPath: string,
  auditIntent?: AuditIntent
): Promise<{ auditId?: number }> {
  if (!auditIntent?.enabled) {
    await safeRemove(projectRoot, relPath);
    return {};
  }
  const oldText = await readTextIfExists(projectRoot, relPath);
  const auditId = await recordConfigChange({
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
    diff: auditIntent.diff ?? previewDiff(oldText, "", relPath),
    requestId: auditIntent.requestId,
    sessionId: auditIntent.sessionId,
    idempotencyKey: auditIntent.idempotencyKey,
    writeStatus: "pending"
  });
  try {
    await safeRemove(projectRoot, relPath);
    if (auditId) await updateConfigChangeStatus({ id: auditId, writeStatus: "committed" });
    return { auditId };
  } catch (error) {
    if (auditId) {
      await updateConfigChangeStatus({
        id: auditId,
        writeStatus: "failed",
        errorReason: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}
