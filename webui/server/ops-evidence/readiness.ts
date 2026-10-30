/**
 * Spec 149 §8 — 连接就绪状态与摘要戳。
 *
 * 就绪判定（`readinessAfterEnsure`）：
 *
 * ```text
 * if readiness is already conflict or not_ready: keep it
 * else if stamp exists and stamp == digest(ktx.yaml) and connectionWrite == unchanged:
 *   readiness = current
 * else:
 *   readiness = reload_required      # 不调用 Spec 191 的重载控制器
 * ```
 *
 * 摘要戳落在 `<projectRoot>/.lucy-seed/ops-evidence-ktx-digest`，**只有**
 * entrypoint 在 `supervise_ktx` 之前写它。WebUI 侧只读。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readKtxYamlDigest } from "../mcp-runtime-state.js";
import {
  OPS_EVIDENCE_DIGEST_STAMP_REL,
  type OpsEvidenceReadiness
} from "./contract.js";
import {
  inspectOpsEvidenceBlock,
  readOpsEvidenceBlock,
  resolveOpsEvidenceAuditDbPath,
  type OpsEvidenceConnectionWrite
} from "./connection-block.js";

export interface OpsEvidenceReadinessState {
  readiness: OpsEvidenceReadiness;
  /** 冲突或未就绪的原因（面向管理员）。 */
  detail?: string;
  /** 最近一次确保的连接块写入结果。 */
  connectionWrite?: OpsEvidenceConnectionWrite;
}

/** 本进程内最近一次确保的结果。 */
interface EnsureMemoryState {
  connectionWrite: OpsEvidenceConnectionWrite;
  readiness: OpsEvidenceReadiness;
  detail?: string;
}

let ensureMemory: EnsureMemoryState | null = null;

/** 记录本进程最近一次确保的结果（供就绪判定使用）。 */
export function recordOpsEvidenceEnsureState(state: EnsureMemoryState): void {
  ensureMemory = { ...state };
}

/** 供测试重置进程内状态。 */
export function resetOpsEvidenceEnsureState(): void {
  ensureMemory = null;
}

/** 摘要戳的绝对路径。 */
export function opsEvidenceDigestStampPath(projectRoot: string): string {
  return path.join(projectRoot, OPS_EVIDENCE_DIGEST_STAMP_REL);
}

/** 读摘要戳；不存在返回 `null`。 */
export async function readOpsEvidenceDigestStamp(projectRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(opsEvidenceDigestStampPath(projectRoot), "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * 写摘要戳 = 当前 `ktx.yaml` 的 sha256。
 *
 * 只在 entrypoint 的 `supervise_ktx` 之前调用。
 */
export async function writeOpsEvidenceDigestStamp(projectRoot: string): Promise<string> {
  const digest = await readKtxYamlDigest(projectRoot);
  const stampPath = opsEvidenceDigestStampPath(projectRoot);
  await mkdir(path.dirname(stampPath), { recursive: true });
  await writeFile(stampPath, `${digest}\n`, "utf8");
  return digest;
}

/**
 * 读当前就绪状态。
 *
 * 磁盘事实（连接块是否一致、摘要戳是否匹配）＋ 本进程内最近一次确保的结果。
 */
export async function readOpsEvidenceReadiness(
  options: { projectRoot?: string; auditDbPath?: string } = {}
): Promise<OpsEvidenceReadinessState> {
  const projectRoot = options.projectRoot ?? (await resolveProjectRootSafe());
  const auditDbPath = options.auditDbPath ?? (await resolveOpsEvidenceAuditDbPath(projectRoot));

  const block = await readOpsEvidenceBlock(projectRoot);
  const inspected = inspectOpsEvidenceBlock(block, auditDbPath, projectRoot);
  if (inspected.write === "conflict") {
    return {
      readiness: "conflict",
      detail: inspected.conflictReason,
      connectionWrite: "conflict"
    };
  }

  // 镜像失败 → 状态保持未就绪（执行层可能仍看见旧目录）。
  if (ensureMemory?.readiness === "not_ready") {
    return {
      readiness: "not_ready",
      detail: ensureMemory.detail,
      connectionWrite: ensureMemory.connectionWrite
    };
  }

  if (inspected.write === "inserted") {
    // 连接块还没有：确保尚未写入，状态不可能是 current。
    return { readiness: "reload_required", connectionWrite: "inserted" };
  }

  const stamp = await readOpsEvidenceDigestStamp(projectRoot);
  const digest = await readKtxYamlDigest(projectRoot).catch(() => undefined);
  const insertedThisProcess = ensureMemory?.connectionWrite === "inserted";
  if (stamp && digest && stamp === digest && !insertedThisProcess) {
    return { readiness: "current", connectionWrite: ensureMemory?.connectionWrite ?? "unchanged" };
  }

  return { readiness: "reload_required", connectionWrite: ensureMemory?.connectionWrite ?? "unchanged" };
}

/** `resolveProjectRoot` 的软失败版本：项目根不可用时返回 cwd。 */
async function resolveProjectRootSafe(): Promise<string> {
  try {
    const { resolveProjectRoot } = await import("../project.js");
    return await resolveProjectRoot();
  } catch {
    return process.cwd();
  }
}
