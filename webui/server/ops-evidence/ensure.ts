/**
 * Spec 149 §8 — `ensureOpsEvidence()`：视图、连接块、内容根复制、项目根镜像、
 * 就绪状态。
 *
 * 幂等：块已一致且戳与摘要相同 → `readiness = current`；否则 `reload_required`。
 * **不**启动 KTX，**不**提交 Spec 191 的重载请求，**不**写 `access.yaml`。
 */

import {
  assertOpsEvidenceViewsSafe,
  recreateOpsEvidenceViews
} from "../proxy/audit.js";
import { syncContentToProjectRoot, type ContentMirrorResult } from "../content-mirror.js";
import { resolveContentPaths, type ContentPaths } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import {
  OPS_EVIDENCE_ASSET_CONFLICT,
  OPS_EVIDENCE_CONNECTION_ID,
  type OpsEvidenceReadiness
} from "./contract.js";
import {
  ensureOpsEvidenceConnectionBlock,
  resolveOpsEvidenceAuditDbPath,
  type OpsEvidenceConnectionWrite
} from "./connection-block.js";
import {
  opsEvidenceAssetSpecs,
  placeOpsEvidenceAsset,
  type OpsEvidenceAssetResult
} from "./assets.js";
import { recordOpsEvidenceEnsureState } from "./readiness.js";

export interface OpsEvidenceEnsureResult {
  projectRoot: string;
  auditDbPath: string;
  /** 连接块写入结果。 */
  connectionWrite: OpsEvidenceConnectionWrite;
  /** 就绪状态。 */
  readiness: OpsEvidenceReadiness;
  /** 冲突或未就绪的原因。 */
  detail?: string;
  /** 资产复制结果。 */
  assets: OpsEvidenceAssetResult[];
  /** 字节不同、未改写的资产。 */
  assetConflicts: OpsEvidenceAssetResult[];
  /** 项目根镜像结果。 */
  mirror: ContentMirrorResult;
  /** 视图是否已重建。 */
  viewsRecreated: boolean;
}

export interface EnsureOpsEvidenceOptions {
  projectRoot?: string;
  auditDbPath?: string;
  contentPaths?: ContentPaths;
  /** 是否重建视图（默认 true）。 */
  recreateViews?: boolean;
}

/**
 * 执行一次确保。
 *
 * 顺序与 Spec 149 §8 的伪代码一致：
 * 视图 → 连接块 → 内容根复制 → 项目根镜像 → 就绪判定。
 */
export async function ensureOpsEvidence(
  options: EnsureOpsEvidenceOptions = {}
): Promise<OpsEvidenceEnsureResult> {
  const projectRoot = options.projectRoot ?? (await resolveProjectRoot());
  const auditDbPath = options.auditDbPath ?? (await resolveOpsEvidenceAuditDbPath(projectRoot));

  // 1) 视图：每次确保都 DROP VIEW 后重建，绝不 DROP 基表。
  let viewsRecreated = false;
  if (options.recreateViews !== false) {
    await recreateOpsEvidenceViews();
    viewsRecreated = true;
  }

  // 2) 连接块。
  const blockState = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath);
  if (blockState.write === "conflict") {
    console.warn(
      `[ops-evidence] ${OPS_EVIDENCE_CONNECTION_ID}: ${blockState.conflictReason ?? "配置不一致，未改写"}` +
        `（字段：${blockState.conflictField ?? "unknown"}）`
    );
    recordOpsEvidenceEnsureState({
      connectionWrite: "conflict",
      readiness: "conflict",
      detail: blockState.conflictReason
    });
    return {
      projectRoot,
      auditDbPath,
      connectionWrite: "conflict",
      readiness: "conflict",
      detail: blockState.conflictReason,
      assets: [],
      assetConflicts: [],
      mirror: { copied: 0, skipped: 0, failed: 0 },
      viewsRecreated
    };
  }

  // 3) 内容根资产：缺失则复制，字节相同则跳过，字节不同则保留并记冲突。
  const contentPaths = options.contentPaths ?? (await resolveContentPaths(projectRoot));
  const assets: OpsEvidenceAssetResult[] = [];
  for (const spec of opsEvidenceAssetSpecs()) {
    assets.push(await placeOpsEvidenceAsset(spec, contentPaths));
  }
  const assetConflicts = assets.filter((asset) => asset.outcome === "conflict");
  for (const conflict of assetConflicts) {
    console.warn(
      `[ops-evidence] ${OPS_EVIDENCE_ASSET_CONFLICT}: ${conflict.destPath} 与模板字节不同，未改写`
    );
  }

  // 4) 项目根镜像：失败时状态保持未就绪，不把内容根的文件当成执行层已看见。
  const mirror = await syncContentToProjectRoot(projectRoot, contentPaths);
  if (mirror.failed > 0) {
    recordOpsEvidenceEnsureState({
      connectionWrite: blockState.write,
      readiness: "not_ready",
      detail: `内容根镜像有 ${mirror.failed} 个文件失败`
    });
    return {
      projectRoot,
      auditDbPath,
      connectionWrite: blockState.write,
      readiness: "not_ready",
      detail: `内容根镜像有 ${mirror.failed} 个文件失败`,
      assets,
      assetConflicts,
      mirror,
      viewsRecreated
    };
  }

  // 5) 就绪判定（readinessAfterEnsure）。
  const { readOpsEvidenceReadiness } = await import("./readiness.js");
  recordOpsEvidenceEnsureState({
    connectionWrite: blockState.write,
    readiness: "reload_required",
    detail: undefined
  });
  const readinessState = await readOpsEvidenceReadiness({ projectRoot, auditDbPath });
  recordOpsEvidenceEnsureState({
    connectionWrite: blockState.write,
    readiness: readinessState.readiness,
    detail: readinessState.detail
  });

  return {
    projectRoot,
    auditDbPath,
    connectionWrite: blockState.write,
    readiness: readinessState.readiness,
    detail: readinessState.detail,
    assets,
    assetConflicts,
    mirror,
    viewsRecreated
  };
}
