/**
 * P1-91 F-a — per-table overlay 只读发现与受控删除生命周期。
 *
 * 客户现场缺口：误发的 standalone overlay（含 `table:`／`sql:`）落盘后既无 API
 * 可见也无 API 可删，只能 SSH 清理。本模块提供：
 * - `listPerTableOverlays`：扫描 `semantic-layer/<conn>/<name>.yaml`（排除 `_schema/`
 *   等子目录），按文件内容区分 standalone 与业务合并型 overlay（merge_overlay），
 *   并标注是否遮蔽同名 Manifest 表；
 * - `deletePerTableOverlay`：受控删除——业务合并型 overlay 须显式
 *   `confirmBusinessOverlayDelete=true`（防误删 WebUI/PUT/import 维护的业务口径）；
 *   正式删除复用 L25-16 管线（ktx.yaml 写锁 → 展示写屏障 → 发布窗口 →
 *   release ＋ recovery journal → auditedRemoveFile → closeContentBatch）。
 * 响应信封对齐 P1-89 D8（deleted／noChanges／deletedFiles／data.nextSteps）。
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { previewDiff } from "./diff";
import { loadContentPaths } from "./paths";
import { withKtxYamlWriteLock } from "./ktx-yaml-write-lock";
import { withPublishCoordinator } from "./publish-coordinator.js";
import { openPromotingContentRelease, closeContentBatch, failContentBatch } from "./semantic-assets.js";
import { readOrCreateSemanticInstanceId } from "./semantic-release-snapshots.js";
import { createRecoveryJournal, markRecoveryJournalFilesSaved } from "./semantic-recovery-journal.js";
import { expandDisplayWrite, withDisplayWriteBarrier } from "./display-generation";
import { auditedRemoveFile } from "./admin/config-audit-write.js";
import { auditActorFields, type TrustedActor } from "./security/request-actor.js";
import { assertAllowedKeys } from "./request-body";
import { assertSafeSegment, scopesForSourceFiles } from "./semantic-layer";
import { ForbiddenPathError } from "./fs-safe";

/** 与删除/写管线同树（content root）解析 relPath；relPath 由模块内白名单段构造，无穿越面。 */
function resolveContentPath(contentPaths: { semanticLayer: string }, relPath: string): string {
  const prefix = "semantic-layer/";
  if (!relPath.startsWith(prefix)) {
    throw new OverlayDeleteForbiddenError(`非 per-table 语义层路径：${relPath}`);
  }
  return path.join(contentPaths.semanticLayer, relPath.slice(prefix.length));
}

/** 路径段校验：非法段／路径穿越 → 400 OVERLAY_DELETE_FORBIDDEN（P1-91 OQ-6 冻结错误码）。 */
function assertSafeOverlaySegment(value: string, label: string): void {
  try {
    assertSafeSegment(value, label);
  } catch (error) {
    if (error instanceof ForbiddenPathError) {
      throw new OverlayDeleteForbiddenError(`${label} 段非法：${value}`);
    }
    throw error;
  }
}

export type PerTableOverlayKind = "standalone" | "merge_overlay";

export type PerTableOverlayInfo = {
  connectionId: string;
  sourceName: string;
  filePath: string;
  kind: PerTableOverlayKind;
  /** standalone 时为文件 `table:` 原值（可能两段或三段）。 */
  physicalTable: string | null;
  /** sourceName 命中该连接任一 Schema Manifest 的 tables 键。 */
  shadowsManifest: boolean;
  /** 遮蔽时命中的 Manifest 相对路径。 */
  manifestPath?: string;
};

export class OverlayNotFoundError extends Error {
  code = "OVERLAY_NOT_FOUND";
  statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "OverlayNotFoundError";
  }
}

export class OverlayDeleteForbiddenError extends Error {
  code = "OVERLAY_DELETE_FORBIDDEN";
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "OverlayDeleteForbiddenError";
  }
}

export class OverlayBusinessEnrichmentProtectedError extends Error {
  code = "OVERLAY_BUSINESS_ENRICHMENT_PROTECTED";
  statusCode = 409;
  data: { kind: PerTableOverlayKind; nextSteps: string[] };

  constructor(message: string, kind: PerTableOverlayKind, nextSteps: string[]) {
    super(message);
    this.name = "OverlayBusinessEnrichmentProtectedError";
    this.data = { kind, nextSteps };
  }
}

/** 解析 per-table 文件：顶层含 `table:` 或 `sql:` 即 standalone（F3 的运行时替换形态）。 */
function classifyPerTableYaml(text: string): { kind: PerTableOverlayKind; physicalTable: string | null } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    // 非法 YAML 的存量文件按 standalone 上报（含未知内容，删除需谨慎展示），
    // physicalTable 置 null；不为盘点端点引入阻断。
    return { kind: "standalone", physicalTable: null };
  }
  const root = doc.toJSON();
  const record =
    root && typeof root === "object" && !Array.isArray(root) ? (root as Record<string, unknown>) : {};
  const physicalTable = typeof record.table === "string" ? record.table : null;
  const kind: PerTableOverlayKind = "table" in record || "sql" in record ? "standalone" : "merge_overlay";
  return { kind, physicalTable };
}

/** 某连接全部 Schema Manifest 的 `tables` 键 → 表名到 Manifest 相对路径的映射。 */
async function manifestTablePathsForConnection(
  paths: { semanticLayer: string },
  connectionId: string
): Promise<Map<string, string>> {
  const byTable = new Map<string, string>();
  const schemaDir = path.join(paths.semanticLayer, connectionId, "_schema");
  let entries;
  try {
    entries = await readdir(schemaDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[lucy-semantic] overlay manifest scan failed for ${connectionId}: ${(error as Error).message}`);
    }
    return byTable;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    try {
      const text = await readFile(path.join(schemaDir, entry.name), "utf8");
      const root = parseDocument(text).toJSON() as Record<string, unknown> | null;
      const tables = root?.tables;
      if (tables && typeof tables === "object" && !Array.isArray(tables)) {
        for (const key of Object.keys(tables as Record<string, unknown>)) {
          byTable.set(key, path.posix.join("semantic-layer", connectionId, "_schema", entry.name));
        }
      }
    } catch {
      // 单文件失败不阻断盘点。
    }
  }
  return byTable;
}

export async function listPerTableOverlays(
  projectRoot: string,
  connectionId?: string
): Promise<PerTableOverlayInfo[]> {
  const paths = await loadContentPaths();
  const conns = connectionId ? [connectionId] : [];
  if (!connectionId) {
    let entries;
    try {
      entries = await readdir(paths.semanticLayer, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      conns.push(entry.name);
    }
  }
  const items: PerTableOverlayInfo[] = [];
  for (const conn of conns) {
    assertSafeOverlaySegment(conn, "connection");
    const connDir = path.join(paths.semanticLayer, conn);
    let entries;
    try {
      entries = await readdir(connDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const manifestTables = await manifestTablePathsForConnection(paths, conn);
    for (const entry of entries) {
      // 只看 per-table 顶层文件；排除 _schema/ 等子目录与隐藏文件。
      if (!entry.isFile() || !entry.name.endsWith(".yaml") || entry.name.startsWith(".")) continue;
      const sourceName = entry.name.replace(/\.yaml$/, "");
      const relPath = path.posix.join("semantic-layer", conn, entry.name);
      let text: string;
      try {
        text = await readFile(path.join(connDir, entry.name), "utf8");
      } catch {
        continue;
      }
      const { kind, physicalTable } = classifyPerTableYaml(text);
      const manifestPath = manifestTables.get(sourceName);
      items.push({
        connectionId: conn,
        sourceName,
        filePath: relPath,
        kind,
        physicalTable,
        shadowsManifest: manifestPath !== undefined,
        ...(manifestPath ? { manifestPath } : {})
      });
    }
  }
  items.sort((a, b) =>
    `${a.connectionId}/${a.sourceName}`.localeCompare(`${b.connectionId}/${b.sourceName}`)
  );
  return items;
}

export type OverlayDeleteOutcome = {
  relPath: string;
  kind: PerTableOverlayKind;
  diff: string;
};

/** dryRun 预览删除（不落盘）：返回将被删除文件的 diff 与分类。 */
export async function previewPerTableOverlayDelete(
  projectRoot: string,
  conn: string,
  sourceName: string
): Promise<OverlayDeleteOutcome> {
  assertSafeOverlaySegment(conn, "connection");
  assertSafeOverlaySegment(sourceName, "sourceName");
  const relPath = path.posix.join("semantic-layer", conn, `${sourceName}.yaml`);
  const paths = await loadContentPaths();
  let text: string;
  try {
    text = await readFile(path.join(paths.semanticLayer, conn, `${sourceName}.yaml`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new OverlayNotFoundError(`per-table overlay 不存在：${relPath}`);
    }
    throw error;
  }
  const { kind } = classifyPerTableYaml(text);
  const diff = previewDiff(text, "", relPath);
  return { relPath, kind, diff };
}

/**
 * 正式删除：复用 L25-16 管线；调用方（路由层）在删除成功后执行 reloadCatalog。
 */
export async function deletePerTableOverlay(
  projectRoot: string,
  conn: string,
  sourceName: string,
  outcome: OverlayDeleteOutcome,
  actor?: TrustedActor
): Promise<void> {
  const { relPath } = outcome;
  await withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["D"], async (token) => {
      // Spec 195 §4 — Manifest 读屏障 scope 与写路径同一规则集；删除 per-table
      // overlay 只影响 D（展示缓存），直接复用 scopesForSourceFiles。
      expandDisplayWrite(token, await scopesForSourceFiles(projectRoot, [{ filePath: relPath }]));
      await withPublishCoordinator(
        "semantic_overlay_delete",
        async () => {
          // TOCTOU 复验（review CHANGE）：kind 判定来自窗口外预览；若并发写在
          // 预览后改写了目标（如 WebUI 把 standalone 改写成业务合并型 overlay），
          // 基于过期字节的确认无效，须让调用方重新发起删除。须在
          // openPromotingContentRelease 之前完成，避免留下未结 release。
          {
            const contentPaths = await loadContentPaths();
            const current = classifyPerTableYaml(
              await readFile(resolveContentPath(contentPaths, relPath), "utf8")
            );
            if (current.kind !== outcome.kind) {
              throw new OverlayBusinessEnrichmentProtectedError(
                "目标文件内容在预览后已变化，本次删除确认失效；请重新发起删除。",
                current.kind,
                ["重新调用 DELETE /api/semantic-assets/overlay/<conn>/<sourceName> 预览并确认"]
              );
            }
          }
          const opened = await openPromotingContentRelease({
            projectRoot,
            actor: actor?.actorId ?? "local-admin",
            targets: [
              {
                targetPath: relPath,
                expectedNewDigest: null,
                assetKind: "overlay",
                identity: { connectionId: conn, schema: "", table: sourceName }
              }
            ]
          });
          const journal = await createRecoveryJournal(projectRoot, {
            releaseId: opened.releaseId,
            operationId: opened.releaseId,
            actor: actor?.actorId ?? "local-admin",
            instanceId: await readOrCreateSemanticInstanceId(projectRoot),
            targets: [
              {
                targetPath: relPath,
                identity: { connectionId: conn, schema: "", table: sourceName },
                // 修复 review BLOCK：删除目标在 recovery journal 的合同标记是
                // newContent: null（expectedNewDigest 为 absent），与既有删除
                // 场景一致；"" 会被启动恢复误判为 conflict 而锁死写路径。
                newContent: null
              }
            ]
          });
          try {
            await auditedRemoveFile(
              projectRoot,
              relPath,
              {
                enabled: true,
                changeType: "semantic_overlay_delete",
                assetKind: "semantic",
                ...auditActorFields(actor),
                source: "semantic_overlay_lifecycle_api",
                targetId: `${conn}:${sourceName}`,
                diff: outcome.diff,
                operation: "delete"
              },
              { requireIntent: true }
            );
            await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
            await closeContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              attemptId: opened.attemptId,
              actor: actor?.actorId ?? "local-admin",
              journalId: journal.journalId,
              changeType: "semantic_overlay_delete_terminal",
              source: "semantic_overlay_lifecycle_api",
              targetId: `${conn}:${sourceName}`,
              operation: "delete_terminal",
              newSummary: { connectionId: conn, sourceName, fileCount: 1 }
            });
          } catch (error) {
            await failContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              journalId: journal.journalId,
              keepLandedWrites: true
            });
            throw error;
          }
        },
        { projectRoot }
      );
    })
  );
}
