/**
 * Spec 149 §8 — `ensureOpsEvidence()`：视图、连接块、内容根复制、项目根镜像、
 * 就绪状态。
 * Spec 20261104 §4.2 — 重排：先落资产并镜像，再按 Manifest 收敛 enabled_tables。
 *
 * 幂等：块已一致且戳与摘要相同 → `readiness = current`；否则 `reload_required`。
 * **不**启动 KTX，**不**提交 Spec 191 的重载请求，**不**写 `access.yaml`。
 *
 * 执行顺序（Spec 20261104 §4.2）：
 *
 * 1. 重建视图
 * 2. 检查连接块（driver / 路径 / readonly）—— 冲突则整段中止，**此步不写 enabled**
 * 3. 放置内容根资产（官方历史版本自愈为 `upgraded`）
 * 4. 镜像到项目根 —— 失败则 `not_ready`
 * 5. 按项目根 Manifest 收敛 `enabled_tables`
 * 6. 就绪判定
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
  inspectOpsEvidenceBlock,
  readOpsEvidenceBlock,
  readOpsEvidenceManifestPhysicalTables,
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
  /** 官方历史版本被自愈升级为当前模板的资产。 */
  assetUpgrades: OpsEvidenceAssetResult[];
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
 * 顺序见文件头：视图 → 检查连接块 → 放置资产 → 镜像 → 收敛 enabled_tables →
 * 就绪判定。
 */
export async function ensureOpsEvidence(
  options: EnsureOpsEvidenceOptions = {}
): Promise<OpsEvidenceEnsureResult> {
  const projectRoot = options.projectRoot ?? (await resolveProjectRoot());
  const auditDbPath = options.auditDbPath ?? (await resolveOpsEvidenceAuditDbPath(projectRoot));
  const contentPaths = options.contentPaths ?? (await resolveContentPaths(projectRoot));

  // 1) 视图：每次确保都 DROP VIEW 后重建，绝不 DROP 基表。
  let viewsRecreated = false;
  if (options.recreateViews !== false) {
    await recreateOpsEvidenceViews();
    viewsRecreated = true;
  }

  // 2) 连接块检查：只看 driver / 路径 / readonly，冲突则整段中止。
  //    这一步**不写** enabled_tables —— 启用范围必须等 Manifest 落定后才知道。
  const existingBlock = await readOpsEvidenceBlock(projectRoot);
  const inspected = inspectOpsEvidenceBlock(existingBlock, auditDbPath, projectRoot);
  if (inspected.write === "conflict") {
    console.warn(
      `[ops-evidence] ${OPS_EVIDENCE_CONNECTION_ID}: ${inspected.conflictReason ?? "配置不一致，未改写"}` +
        `（字段：${inspected.conflictField ?? "unknown"}）`
    );
    recordOpsEvidenceEnsureState({
      connectionWrite: "conflict",
      readiness: "conflict",
      detail: inspected.conflictReason
    });
    return {
      projectRoot,
      auditDbPath,
      connectionWrite: "conflict",
      readiness: "conflict",
      detail: inspected.conflictReason,
      assets: [],
      assetConflicts: [],
      assetUpgrades: [],
      mirror: { copied: 0, skipped: 0, failed: 0 },
      viewsRecreated
    };
  }

  // 3) 内容根资产：缺失则复制，字节相同则跳过，官方历史版本升级为当前模板，
  //    其余字节不同则保留并记冲突。
  const assets: OpsEvidenceAssetResult[] = [];
  for (const spec of opsEvidenceAssetSpecs()) {
    assets.push(await placeOpsEvidenceAsset(spec, contentPaths));
  }
  const assetConflicts = assets.filter((asset) => asset.outcome === "conflict");
  const assetUpgrades = assets.filter((asset) => asset.outcome === "upgraded");
  for (const conflict of assetConflicts) {
    console.warn(
      `[ops-evidence] ${OPS_EVIDENCE_ASSET_CONFLICT}: ${conflict.destPath} 与模板字节不同，未改写`
    );
  }
  for (const upgrade of assetUpgrades) {
    console.log(`[ops-evidence] 资产已升级到当前模板：${upgrade.destPath}`);
  }

  // 4) 项目根镜像：失败时状态保持未就绪，不把内容根的文件当成执行层已看见。
  const mirror = await syncContentToProjectRoot(projectRoot, contentPaths);
  if (mirror.failed > 0) {
    recordOpsEvidenceEnsureState({
      connectionWrite: "unchanged",
      readiness: "not_ready",
      detail: `内容根镜像有 ${mirror.failed} 个文件失败`
    });
    return {
      projectRoot,
      auditDbPath,
      connectionWrite: "unchanged",
      readiness: "not_ready",
      detail: `内容根镜像有 ${mirror.failed} 个文件失败`,
      assets,
      assetConflicts,
      assetUpgrades,
      mirror,
      viewsRecreated
    };
  }

  // 5) 按项目根 Manifest 收敛 enabled_tables（冻结集合 ∩ Manifest 物理表）。
  const manifestPhysicalTables = await readOpsEvidenceManifestPhysicalTables(
    projectRoot,
    contentPaths
  );
  const blockState = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
    manifestPhysicalTables
  });
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
      assets,
      assetConflicts,
      assetUpgrades,
      mirror,
      viewsRecreated
    };
  }

  // 6) 就绪判定（readinessAfterEnsure）。
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
    assetUpgrades,
    mirror,
    viewsRecreated
  };
}
