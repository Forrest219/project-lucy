/**
 * L25-16 — `lucy_ops_source_import` 的批量服务（Spec §3.3 / §4.3 / §6.3，S4）。
 *
 * **原子性：组内全成或全败，组间部分成功可重放**。
 *
 * - 组的身份由**实际写集交集**决定（`ops-manifest-groups.ts`）：
 *   Manifest 按连接 + Schema 共享；Overlay 路径**不含 Schema**，故同连接不同 Schema 的
 *   同名表也写同一文件，必须合组。
 * - 同组目标合并为**单次文件写入**（一个 Manifest 只写一次）。
 * - **全局历史索引是共享元数据**：不参与分组，但写入与内容文件串行、撤销按条目隔离。
 * - **版本裁剪延后到组终结之后**（F5-05 / G27）——组内后续成员失败时，被裁剪的旧快照
 *   必须仍然可读。
 * - **restore 走 import 写服务**（R14）：读版本候选 → 预检 → 调 import 写服务落盘，
 *   并透传 `restoredFromVersionId`；不得直接包装只返回草稿的 restore 端点。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { assertReadable } from "../fs-safe.js";
import { resolveContentPaths } from "../paths.js";
import { previewOverlayUpdate } from "../overlay.js";
import {
  applySourceYamlImportDeltas,
  planSourceYamlImport,
  readSource,
  type SourceYamlImportDelta
} from "../semantic-layer.js";
import {
  createTableYamlVersionSnapshotDeferred,
  pruneTableYamlVersions,
  removeTableYamlVersionEntries,
  restoreTableYamlVersionDraft
} from "../table-yaml-history.js";
import { validateSource } from "../ktx.js";
import { detectOpsSourceWriteConflicts, formOpsSourceGroups } from "./ops-manifest-groups.js";
import { withOpsWriteLocks } from "./ops-locks.js";
import { Outcome } from "./ops-outcome.js";
import type {
  OpsGroupContext,
  OpsGroupVerifyResult,
  OpsPlanBuildContext,
  OpsPlanDraft,
  OpsPlanGroup,
  OpsPlanTarget,
  OpsRollbackResult,
  OpsToolAdapter
} from "./ops-batch.js";

export const OPS_SOURCE_IMPORT = "lucy_ops_source_import";

/** 控制面稳定拒绝码。 */
export const OPS_SOURCE_WRITE_SET_CONFLICT = "ops_source_write_set_conflict";
export const OPS_SOURCE_EXTERNAL_MODIFICATION = "ops_external_modification_detected";
export const OPS_SOURCE_NOT_FOUND = "ops_source_not_found";
export const OPS_SOURCE_VALIDATION_FAILED = "ops_source_validation_failed";

export interface OpsSourceImportTargetInput {
  connectionId: string;
  schema: string;
  table: string;
  /** `action = "import"` 时的 YAML 文本。 */
  yaml?: string;
  /** `action = "restore"` 时的版本 id。 */
  versionId?: string;
  action?: "import" | "restore";
  sourceFileName?: string;
}

export class OpsSourceImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OpsSourceImportError";
  }
}

/** 目标 id —— 稳定、可用于幂等键与审计 `target_id`。 */
export function sourceImportTargetId(input: OpsSourceImportTargetInput): string {
  return `${input.connectionId}:${input.schema}:${input.table}`;
}

/** 解析请求里的目标列表。 */
export function parseSourceImportTargets(request: Record<string, unknown>): OpsSourceImportTargetInput[] {
  const raw = request.targets;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new OpsSourceImportError("ops_target_unresolvable", "targets 必须是非空数组");
  }
  const targets: OpsSourceImportTargetInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new OpsSourceImportError("ops_target_unresolvable", "每个 target 必须是对象");
    }
    const record = item as Record<string, unknown>;
    const connectionId = typeof record.connectionId === "string" ? record.connectionId.trim() : "";
    const schema = typeof record.schema === "string" ? record.schema.trim() : "";
    const table = typeof record.table === "string" ? record.table.trim() : "";
    if (!connectionId || !schema || !table) {
      throw new OpsSourceImportError(
        "ops_target_unresolvable",
        "target 必须携带 connectionId / schema / table"
      );
    }
    const action = record.action === "restore" ? "restore" : "import";
    const yaml = typeof record.yaml === "string" ? record.yaml : undefined;
    const versionId = typeof record.versionId === "string" ? record.versionId.trim() : undefined;
    if (action === "restore" && !versionId) {
      throw new OpsSourceImportError("ops_target_unresolvable", "action=restore 必须携带 versionId");
    }
    if (action === "import" && (!yaml || !yaml.trim())) {
      throw new OpsSourceImportError("ops_target_unresolvable", "action=import 必须携带 yaml");
    }
    const target: OpsSourceImportTargetInput = {
      connectionId,
      schema,
      table,
      action,
      ...(action === "restore" ? { versionId } : { yaml }),
      ...(typeof record.sourceFileName === "string" ? { sourceFileName: record.sourceFileName } : {})
    };
    const id = sourceImportTargetId(target);
    if (seen.has(id)) {
      throw new OpsSourceImportError("ops_target_unresolvable", `重复的 target：${id}`);
    }
    seen.add(id);
    targets.push(target);
  }
  return targets;
}

// ─── 文件读写辅助 ─────────────────────────────────────────────────────────────

async function readContentFile(projectRoot: string, relPath: string): Promise<{ content: string; existed: boolean }> {
  try {
    // 按本次 operation 的 projectRoot 解析内容根——不用全局缓存路径，
    // 否则多内容根部署下会写到别的项目根去。
    const paths = await resolveContentPaths(projectRoot);
    const abs = await assertReadable(paths, projectRoot, relPath);
    return { content: await readFile(abs, "utf8"), existed: true };
  } catch {
    return { content: "", existed: false };
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ─── 组执行状态（供组级撤销使用） ────────────────────────────────────────────

interface SourceGroupState {
  /** 共享内容文件 → 写入前的内容（不存在则 content 为空、existed=false）。 */
  preImages: Map<string, { content: string; existed: boolean }>;
  /** 共享内容文件 → 写入后的内容摘要（供恢复核验）。 */
  postHashes: Map<string, string>;
  /** 本组新建的版本条目（组级撤销按条目回滚历史索引）。 */
  versionEntries: Array<{ conn: string; schema: string; table: string; versionId: string }>;
  /** 需要延后裁剪的表。 */
  deferredPruneTables: Array<{ conn: string; schema: string; table: string }>;
}

/**
 * 组执行状态暂存。
 *
 * 组级撤销需要「写入前的内容」——那是**执行时刻**才确定的事实（锁内重读），
 * 计划里只留摘要（`before`）。这里按 `executionId` 暂存，供同一次 attempt 的撤销使用。
 *
 * ⚠️ 按 `executionId`（而不是组 id）暂存：组 id 只由目标派生，同一个表被两次不同的
 * operation 导入时组 id 相同——按组 id 暂存会让后一次执行覆盖前一次的**前像**，
 * 撤销就会拿错文件内容。`executionId` 含 operation_key 与 attempt，不会撞。
 */
const GROUP_STATES = new Map<string, SourceGroupState>();

// ─── 适配器 ───────────────────────────────────────────────────────────────────

export class OpsSourceImportAdapter implements OpsToolAdapter {
  readonly toolName = OPS_SOURCE_IMPORT;

  operationAudit() {
    return {
      filePath: "semantic-layer",
      changeType: "semantic_table_import",
      assetKind: "semantic" as const
    };
  }

  parseTargets(request: Record<string, unknown>): unknown[] {
    return parseSourceImportTargets(request);
  }

  targetId(target: unknown): string {
    return sourceImportTargetId(target as OpsSourceImportTargetInput);
  }

  connectionId(target: unknown): string {
    return (target as OpsSourceImportTargetInput).connectionId;
  }

  async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const targets = parseSourceImportTargets(ctx.request);
    const perTarget: OpsPlanTarget[] = [];
    const blockers: string[] = [];

    for (const target of targets) {
      const id = sourceImportTargetId(target);
      const payload: OpsSourceImportTargetInput = { ...target };

      // restore 的 YAML 在执行时刻从版本快照读取（保证落盘的是**当时**的候选内容）。
      let probeYaml = payload.yaml ?? "";
      if (payload.action === "restore") {
        try {
          const current = await readSource(ctx.projectRoot, payload.connectionId, payload.schema, payload.table);
          const draft = await restoreTableYamlVersionDraft(
            ctx.projectRoot,
            payload.connectionId,
            payload.schema,
            payload.table,
            payload.versionId as string,
            current.rawYaml
          );
          probeYaml = draft.rawYaml;
        } catch (err) {
          blockers.push(OPS_SOURCE_NOT_FOUND);
          perTarget.push({
            id,
            groupId: `g:${id}`,
            connectionId: payload.connectionId,
            payload: payload as unknown as Record<string, unknown>,
            before: null,
            after: null,
            blockers: [OPS_SOURCE_NOT_FOUND],
            writeSet: [],
            audit: {
              changeType: "semantic_table_import",
              assetKind: "semantic",
              targetId: id,
              filePath: "semantic-layer"
            }
          });
          continue;
        }
      }

      let delta: SourceYamlImportDelta;
      try {
        delta = await planSourceYamlImport(
          ctx.projectRoot,
          payload.connectionId,
          payload.schema,
          payload.table,
          probeYaml
        );
      } catch (err) {
        const code = (err as { code?: string }).code === "SOURCE_NOT_FOUND" ? OPS_SOURCE_NOT_FOUND : "ops_target_unresolvable";
        blockers.push(code);
        perTarget.push({
          id,
          groupId: `g:${id}`,
          connectionId: payload.connectionId,
          payload: payload as unknown as Record<string, unknown>,
          before: null,
          after: null,
          blockers: [code],
          writeSet: [],
          audit: {
            changeType: "semantic_table_import",
            assetKind: "semantic",
            targetId: id,
            filePath: "semantic-layer"
          }
        });
        continue;
      }

      const contentFiles = [delta.manifest?.relPath, delta.overlay?.relPath].filter(
        (file): file is string => typeof file === "string"
      );

      // 基线：共享内容文件的当前内容摘要（执行时刻在锁内复算，检测外部修改）。
      const beforeFiles: Array<{ filePath: string; contentHash: string }> = [];
      for (const filePath of contentFiles) {
        const current = await readContentFile(ctx.projectRoot, filePath);
        beforeFiles.push({ filePath, contentHash: hashContent(current.content) });
      }

      perTarget.push({
        id,
        groupId: `g:${id}`, // 下面的分组会覆盖
        connectionId: payload.connectionId,
        payload: payload as unknown as Record<string, unknown>,
        before: { files: beforeFiles },
        after: { files: contentFiles, operation: payload.action },
        blockers: [],
        writeSet: contentFiles,
        audit: {
          changeType: "semantic_table_import",
          assetKind: "semantic",
          targetId: id,
          filePath: contentFiles[0] ?? "semantic-layer"
        }
      });
    }

    // 组划分：实际写集交集（Overlay 路径不含 Schema ⇒ 跨 Schema 同名表也合组）。
    const groups = formOpsSourceGroups(
      perTarget.map((target) => ({ id: target.id, contentFiles: target.writeSet }))
    );
    const groupOf = new Map<string, string>();
    for (const group of groups) {
      for (const memberId of group.memberIds) groupOf.set(memberId, group.id);
    }
    for (const target of perTarget) {
      target.groupId = groupOf.get(target.id) ?? target.groupId;
    }

    // 组内共享文件的内容冲突：同一文件被组内多个目标写入不同内容 → 整组不可执行。
    const conflicts = await this.detectGroupConflicts(ctx.projectRoot, perTarget, groups);
    if (conflicts.length > 0) {
      for (const group of groups) {
        const members = perTarget.filter((target) => group.memberIds.includes(target.id));
        const hit = members.some((member) =>
          conflicts.some((conflict) => member.writeSet.includes(conflict))
        );
        if (!hit) continue;
        for (const member of members) {
          if (!member.blockers.includes(OPS_SOURCE_WRITE_SET_CONFLICT)) {
            member.blockers.push(OPS_SOURCE_WRITE_SET_CONFLICT);
          }
        }
      }
      blockers.push(OPS_SOURCE_WRITE_SET_CONFLICT);
    }

    const planGroups: OpsPlanGroup[] = groups.map((group) => ({
      id: group.id,
      memberIds: group.memberIds,
      sharedFiles: group.sharedFiles
    }));

    return { perTarget, groups: planGroups, blockers };
  }

  /**
   * 组内共享文件的写入内容冲突检测。
   *
   * 只对 **Overlay** 文件判定：Manifest 的多目标写入是**合并**（各改各的表），
   * 不冲突；Overlay 是整份替换（grain / measures / segments），两个目标写同一文件
   * 必然互相覆盖 ⇒ 冲突。
   */
  private async detectGroupConflicts(
    projectRoot: string,
    perTarget: OpsPlanTarget[],
    groups: OpsSourceGroupLike[]
  ): Promise<string[]> {
    const proposals = new Map<string, Map<string, string>>();
    for (const group of groups) {
      const members = perTarget.filter((target) => group.memberIds.includes(target.id));
      for (const member of members) {
        const target = member.payload as unknown as OpsSourceImportTargetInput;
        let probeYaml = target.yaml ?? "";
        if (target.action === "restore") {
          const current = await readSource(projectRoot, target.connectionId, target.schema, target.table);
          probeYaml = (
            await restoreTableYamlVersionDraft(
              projectRoot,
              target.connectionId,
              target.schema,
              target.table,
              target.versionId as string,
              current.rawYaml
            )
          ).rawYaml;
        }
        const delta = await planSourceYamlImport(
          projectRoot,
          target.connectionId,
          target.schema,
          target.table,
          probeYaml
        );
        if (!delta.overlay) continue;
        const preview = await previewOverlayUpdate(projectRoot, target.connectionId, target.table, {
          grain: delta.overlay.grain,
          measures: delta.overlay.measures,
          segments: delta.overlay.segments
        });
        if (!preview) continue;
        const byTarget = proposals.get(preview.relPath) ?? new Map<string, string>();
        byTarget.set(member.id, preview.proposedText);
        proposals.set(preview.relPath, byTarget);
      }
    }
    return detectOpsSourceWriteConflicts(proposals);
  }

  async executeGroup(ctx: OpsGroupContext): Promise<void> {
    const members = ctx.members.map(
      (member) => member.payload as unknown as OpsSourceImportTargetInput
    );

    await withOpsWriteLocks(
      {
        projectRoot: ctx.projectRoot,
        scopes: ["D", "P", "C", "L"],
        publishWindow: true,
        kind: "batch_import"
      },
      async () => {
        const state: SourceGroupState = {
          preImages: new Map(),
          postHashes: new Map(),
          versionEntries: [],
          deferredPruneTables: []
        };
        GROUP_STATES.set(ctx.executionId, state);

        // ── 1. 锁内基线复算：检测到外部修改即整组拒绝 ────────────────────
        const expectedHashes = new Map<string, string>();
        for (const member of ctx.members) {
          const before = member.before as { files?: Array<{ filePath: string; contentHash: string }> } | null;
          for (const file of before?.files ?? []) expectedHashes.set(file.filePath, file.contentHash);
        }
        for (const [filePath, expected] of expectedHashes) {
          const current = await readContentFile(ctx.projectRoot, filePath);
          if (hashContent(current.content) !== expected) {
            throw new OpsSourceImportError(
              OPS_SOURCE_EXTERNAL_MODIFICATION,
              `文件 '${filePath}' 在预览后被外部修改，整组拒绝`
            );
          }
        }

        // ── 2. 解析每个目标的写入内容（restore 经版本快照读取） ─────────────
        const deltas = new Map<string, SourceYamlImportDelta>();
        const resolvedYaml = new Map<string, string>();
        for (const target of members) {
          const id = sourceImportTargetId(target);
          let yaml = target.yaml ?? "";
          if (target.action === "restore") {
            const current = await readSource(ctx.projectRoot, target.connectionId, target.schema, target.table);
            const draft = await restoreTableYamlVersionDraft(
              ctx.projectRoot,
              target.connectionId,
              target.schema,
              target.table,
              target.versionId as string,
              current.rawYaml
            );
            yaml = draft.rawYaml;
          }
          resolvedYaml.set(id, yaml);
          deltas.set(
            id,
            await planSourceYamlImport(ctx.projectRoot, target.connectionId, target.schema, target.table, yaml)
          );
        }

        // ── 3. 按共享文件合并：每个文件只写一次 ───────────────────────────
        const manifestFiles = new Map<string, Array<{ table: string; merged: Record<string, unknown> }>>();
        const overlayFiles = new Map<string, Map<string, string>>();
        for (const member of ctx.members) {
          const id = member.id;
          const delta = deltas.get(id);
          if (!delta) continue;
          if (delta.manifest) {
            const list = manifestFiles.get(delta.manifest.relPath) ?? [];
            list.push({ table: delta.manifest.table, merged: delta.manifest.merged });
            manifestFiles.set(delta.manifest.relPath, list);
          }
          if (delta.overlay) {
            const preview = await previewOverlayUpdate(
              ctx.projectRoot,
              (member.payload as unknown as OpsSourceImportTargetInput).connectionId,
              (member.payload as unknown as OpsSourceImportTargetInput).table,
              {
                grain: delta.overlay.grain,
                measures: delta.overlay.measures,
                segments: delta.overlay.segments
              }
            );
            if (!preview) continue;
            const byTarget = overlayFiles.get(preview.relPath) ?? new Map<string, string>();
            byTarget.set(id, preview.proposedText);
            overlayFiles.set(preview.relPath, byTarget);
          }
        }

        const conflicts = detectOpsSourceWriteConflicts(overlayFiles);
        if (conflicts.length > 0) {
          throw new OpsSourceImportError(
            OPS_SOURCE_WRITE_SET_CONFLICT,
            `组内多个目标对同一共享文件提出不同内容：${conflicts.join(", ")}`
          );
        }

        // 写入前留前像（组级撤销用）。
        for (const filePath of [...manifestFiles.keys(), ...overlayFiles.keys()]) {
          const current = await readContentFile(ctx.projectRoot, filePath);
          state.preImages.set(filePath, current);
        }

        const paths = await resolveContentPaths(ctx.projectRoot);
        for (const [filePath, list] of manifestFiles) {
          const content = await applySourceYamlImportDeltas(ctx.projectRoot, filePath, list);
          const { safeWriteAtomic } = await import("../fs-safe.js");
          await safeWriteAtomic(paths, ctx.projectRoot, filePath, content);
          state.postHashes.set(filePath, hashContent(content));
        }
        for (const [filePath, byTarget] of overlayFiles) {
          const content = [...byTarget.values()][0];
          const { safeWriteAtomic } = await import("../fs-safe.js");
          await safeWriteAtomic(paths, ctx.projectRoot, filePath, content);
          state.postHashes.set(filePath, hashContent(content));
        }
        for (const member of ctx.members) {
          ctx.setEffectPhase(member.id, "written");
        }

        // ── 4. 逐目标校验（复用既有 validateSource） ───────────────────────
        for (const target of members) {
          const validation = await validateSource(ctx.projectRoot, target.connectionId, target.schema, target.table);
          if (validation && typeof validation === "object" && "ok" in validation && validation.ok === false) {
            throw new OpsSourceImportError(
              OPS_SOURCE_VALIDATION_FAILED,
              `源表 '${target.connectionId}/${target.schema}/${target.table}' 校验未通过`
            );
          }
        }

        // ── 5. 逐目标版本快照（裁剪延后到组终结之后） ─────────────────────
        for (const target of members) {
          const id = sourceImportTargetId(target);
          const source = await readSource(ctx.projectRoot, target.connectionId, target.schema, target.table);
          const affectedFiles = [
            deltas.get(id)?.manifest?.relPath,
            deltas.get(id)?.overlay?.relPath
          ].filter((file): file is string => typeof file === "string");
          const created = await createTableYamlVersionSnapshotDeferred(
            ctx.projectRoot,
            target.connectionId,
            target.schema,
            target.table,
            source.rawYaml,
            {
              operation: target.action === "restore" ? "restore" : "import",
              ...(target.sourceFileName ? { sourceFileName: target.sourceFileName } : {}),
              ...(target.action === "restore" ? { restoredFromVersionId: target.versionId } : {}),
              affectedFiles
            }
          );
          if (created.version) {
            state.versionEntries.push({
              conn: target.connectionId,
              schema: target.schema,
              table: target.table,
              versionId: created.version.versionId
            });
          }
          state.deferredPruneTables.push({
            conn: target.connectionId,
            schema: target.schema,
            table: target.table
          });
        }

        for (const member of ctx.members) {
          ctx.setEffectPhase(member.id, "activated");
        }
      }
    );
  }

  async rollbackGroup(ctx: OpsGroupContext): Promise<OpsRollbackResult> {
    const state = GROUP_STATES.get(ctx.executionId);
    if (!state) {
      // 没有前像（例如进程重启后的恢复）——无法证明撤销完整 ⇒ 交恢复处理。
      return { complete: false, detail: "ops_source_preimage_unavailable" };
    }
    try {
      await withOpsWriteLocks(
        {
          projectRoot: ctx.projectRoot,
          scopes: ["D", "P", "C", "L"],
          publishWindow: true,
          kind: "batch_import"
        },
        async () => {
          const paths = await resolveContentPaths(ctx.projectRoot);
          const { safeWriteAtomic, safeRemove } = await import("../fs-safe.js");
          for (const [filePath, pre] of state.preImages) {
            if (pre.existed) {
              await safeWriteAtomic(paths, ctx.projectRoot, filePath, pre.content);
            } else {
              await safeRemove(paths, ctx.projectRoot, filePath);
            }
          }
          // 组级回滚**只回滚本组的历史索引条目**，不整份回滚全局索引。
          await removeTableYamlVersionEntries(ctx.projectRoot, state.versionEntries);
        }
      );
      return { complete: true };
    } catch (err) {
      return { complete: false, detail: String(err) };
    }
  }

  async verifyGroup(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult> {
    const state = GROUP_STATES.get(ctx.executionId);
    const expectedHashes = new Map<string, string>();
    for (const member of ctx.members) {
      const before = member.before as { files?: Array<{ filePath: string; contentHash: string }> } | null;
      for (const file of before?.files ?? []) expectedHashes.set(file.filePath, file.contentHash);
    }

    const members: OpsGroupVerifyResult["members"] = [];
    for (const member of ctx.members) {
      let verdict: "succeeded" | "failed" | "unknown" = "unknown";
      let detail: unknown;
      for (const [filePath, beforeHash] of expectedHashes) {
        const current = await readContentFile(ctx.projectRoot, filePath);
        const currentHash = hashContent(current.content);
        const postHash = state?.postHashes.get(filePath);
        if (postHash) {
          if (currentHash === postHash) {
            verdict = "succeeded";
          } else if (currentHash === beforeHash) {
            verdict = "failed";
            detail = { filePath, reason: "not_written" };
            break;
          } else {
            verdict = "unknown";
            detail = { filePath, reason: "content_undeterminable" };
            break;
          }
        } else if (currentHash === beforeHash) {
          verdict = "failed";
          detail = { filePath, reason: "not_written" };
          break;
        } else {
          verdict = "succeeded";
        }
      }
      members.push({ id: member.id, state: verdict, detail });
    }
    return { members };
  }

  /**
   * 组终结（全部成员确认成功）后执行被延后的版本裁剪。
   *
   * 由通用编排在组成功后调用；组失败时**不得**裁剪——被裁剪的旧版本必须仍可读。
   */
  async finalizeGroup(ctx: OpsGroupContext): Promise<void> {
    const state = GROUP_STATES.get(ctx.executionId);
    if (!state) return;
    for (const entry of state.deferredPruneTables) {
      await pruneTableYamlVersions(ctx.projectRoot, entry.conn, entry.schema, entry.table);
    }
    GROUP_STATES.delete(ctx.executionId);
  }
}

interface OpsSourceGroupLike {
  id: string;
  memberIds: string[];
  sharedFiles: string[];
}

export { Outcome };
