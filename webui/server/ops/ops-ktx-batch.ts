/**
 * L25-16 — `lucy_ops_connection_tables` 的批量服务（Spec §3.3 / §6.3，S3）。
 *
 * **原子性：整批全成或全拒**——全部 KTX 连接配置都在同一份 `ktx.yaml`，
 * 一次合并写就是一个原子组，组内不能报告部分成功。
 *
 * **锁顺序（唯一）**：`withKtxYamlWriteLock → withDisplayWriteBarrier(["D","P","C","L"]) → 写`。
 * 重读 → 基线比较 → 补丁生成 → 写入 → catalog 重载 → 策略提交**全部在同一把锁内**。
 *
 * **控制面不删语义文件**：工具不接受 `deleteManifest` / `deleteOverlays`，
 * 参数里出现这两个字段即拒绝，原因码 `ops_schema_content_delete_unsupported`。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { reloadCatalog } from "../catalog-reload.js";
import {
  patchConnectionsEnabledTablesYaml,
  patchRemoveSchemaYaml,
  scannedPhysicalTables,
  validateEnabledTables
} from "../enabled-tables.js";
import { safeWriteAtomic } from "../fs-safe.js";
import { readHiveConnections } from "../hive/config.js";
import { resolveContentPaths } from "../paths.js";
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

/** 控制面稳定拒绝码。 */
export const OPS_CONNECTION_ORIGIN_UNSUPPORTED = "ops_connection_origin_unsupported";
export const OPS_SCHEMA_CONTENT_DELETE_UNSUPPORTED = "ops_schema_content_delete_unsupported";
export const OPS_EXTERNAL_MODIFICATION_DETECTED = "ops_external_modification_detected";

export const OPS_CONNECTION_TABLES = "lucy_ops_connection_tables";

/** 一次目标：要么设置启用表范围，要么移除 Schema。 */
export interface OpsConnectionTableTargetInput {
  connectionId: string;
  /** 设置启用表范围（整表替换）。 */
  enabledTables?: string[];
  /** 移除 Schema（只改 ktx.yaml，不删语义文件）。 */
  removeSchema?: string;
  /** 控制面**不接受**该字段——出现即拒绝。 */
  deleteManifest?: unknown;
  deleteOverlays?: unknown;
}

interface KtxBaseline {
  connectionId: string;
  enabledTables: string[];
  schemas: string[];
}

/**
 * 组执行状态（供组级撤销使用）。
 *
 * ⚠️ `wrote` 是**关键**：
 * - 锁内发现外部修改时，失败发生在**写入之前**——没有任何效果需要撤销。
 *   此时撤销必须**不写任何文件**：否则「回滚到基线」会把别人在预览之后的外部修改
 *   一起抹掉（那本身是一次控制面写入，违反「整批不写」）。
 * - 写入成功但生效未确认（catalog 重载 / 策略提交失败）时，才需要把 ktx.yaml
 *   **逐字节**恢复成写入前的内容。
 */
interface KtxGroupState {
  /** 写入前 ktx.yaml 的完整内容（锁内读取）。 */
  preImage: string;
  /** 本次执行是否真的写过文件。 */
  wrote: boolean;
}

/** 组级暂存——按 `executionId` 绑定到具体的一次 attempt。 */
const KTX_GROUP_STATES = new Map<string, KtxGroupState>();

function readConnectionState(text: string, connectionId: string): { enabledTables: string[]; schemas: string[] } | undefined {
  const doc = parseDocument(text, { keepSourceTokens: true });
  const connections = doc.get("connections", true) as
    | { get?: (key: string, keepScalar?: boolean) => unknown }
    | undefined;
  if (!connections || typeof connections.get !== "function") return undefined;
  const conn = connections.get(connectionId, true) as
    | { get?: (key: string, keepScalar?: boolean) => unknown }
    | undefined;
  if (!conn || typeof conn.get !== "function") return undefined;
  const seqOf = (key: string): string[] => {
    const node = conn.get?.(key, true) as { items?: unknown[] } | undefined;
    if (!node || !Array.isArray(node.items)) return [];
    return node.items
      .map((item) => {
        if (typeof item === "string") return item;
        const value = (item as { value?: unknown } | undefined)?.value;
        return typeof value === "string" ? value : null;
      })
      .filter((value): value is string => value !== null);
  };
  return { enabledTables: seqOf("enabled_tables"), schemas: seqOf("schemas") };
}

function sameList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

/** 目标 id —— 稳定、可用于幂等键与审计 `target_id`。 */
export function connectionTableTargetId(input: OpsConnectionTableTargetInput): string {
  return input.removeSchema
    ? `schema:${input.connectionId}:${input.removeSchema}`
    : `tables:${input.connectionId}`;
}

/** 解析请求里的目标列表。 */
export function parseConnectionTableTargets(request: Record<string, unknown>): OpsConnectionTableTargetInput[] {
  const raw = request.targets;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new OpsConnectionTableError("ops_target_unresolvable", "targets 必须是非空数组");
  }
  const targets: OpsConnectionTableTargetInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new OpsConnectionTableError("ops_target_unresolvable", "每个 target 必须是对象");
    }
    const record = item as Record<string, unknown>;
    const connectionId = typeof record.connectionId === "string" ? record.connectionId.trim() : "";
    if (!connectionId) {
      throw new OpsConnectionTableError("ops_target_unresolvable", "target.connectionId 必填");
    }
    if (record.deleteManifest !== undefined || record.deleteOverlays !== undefined) {
      throw new OpsConnectionTableError(
        OPS_SCHEMA_CONTENT_DELETE_UNSUPPORTED,
        "控制面首期不提供语义内容删除：deleteManifest / deleteOverlays 不被接受"
      );
    }
    const hasEnabled = record.enabledTables !== undefined;
    const removeSchema =
      typeof record.removeSchema === "string" && record.removeSchema.trim()
        ? record.removeSchema.trim()
        : undefined;
    if (!hasEnabled && !removeSchema) {
      throw new OpsConnectionTableError(
        "ops_target_unresolvable",
        "target 必须携带 enabledTables 或 removeSchema"
      );
    }
    if (hasEnabled && removeSchema) {
      throw new OpsConnectionTableError(
        "ops_target_unresolvable",
        "同一 target 不得同时携带 enabledTables 与 removeSchema"
      );
    }
    const target: OpsConnectionTableTargetInput = {
      connectionId,
      ...(hasEnabled
        ? { enabledTables: Array.isArray(record.enabledTables) ? (record.enabledTables as string[]) : (record.enabledTables as never) }
        : {}),
      ...(removeSchema ? { removeSchema } : {})
    };
    const id = connectionTableTargetId(target);
    if (seen.has(id)) {
      throw new OpsConnectionTableError("ops_target_unresolvable", `重复的 target：${id}`);
    }
    seen.add(id);
    targets.push(target);
  }
  return targets;
}

export class OpsConnectionTableError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OpsConnectionTableError";
  }
}

/**
 * `lucy_ops_connection_tables` 适配器。
 */
export class OpsConnectionTablesAdapter implements OpsToolAdapter {
  readonly toolName = OPS_CONNECTION_TABLES;

  operationAudit() {
    return {
      filePath: "ktx.yaml",
      changeType: "enabled_tables_update",
      assetKind: "governance" as const
    };
  }

  parseTargets(request: Record<string, unknown>): unknown[] {
    return parseConnectionTableTargets(request);
  }

  targetId(target: unknown): string {
    return connectionTableTargetId(target as OpsConnectionTableTargetInput);
  }

  connectionId(target: unknown): string {
    return (target as OpsConnectionTableTargetInput).connectionId;
  }

  async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const targets = parseConnectionTableTargets(ctx.request);
    const ktxPath = path.join(ctx.projectRoot, "ktx.yaml");
    const ktxText = await readFile(ktxPath, "utf8");

    // R15：连接来源边界——Hive 来源连接在 preview 阶段就拒绝。
    const hive = await readHiveConnections(ctx.projectRoot);
    const hiveIds = new Set(
      hive.ok ? hive.value.connections.map((connection) => connection.id) : []
    );

    const perTarget: OpsPlanTarget[] = [];
    const blockers: string[] = [];

    for (const target of targets) {
      const id = connectionTableTargetId(target);
      if (hiveIds.has(target.connectionId)) {
        blockers.push(OPS_CONNECTION_ORIGIN_UNSUPPORTED);
        perTarget.push({
          id,
          groupId: "ktx",
          connectionId: target.connectionId,
          payload: { ...target },
          before: null,
          after: null,
          blockers: [OPS_CONNECTION_ORIGIN_UNSUPPORTED],
          writeSet: ["ktx.yaml"],
          audit: {
            changeType: target.removeSchema ? "schema_remove" : "enabled_tables_update",
            assetKind: "governance",
            targetId: target.removeSchema
              ? `${target.connectionId}:${target.removeSchema}`
              : target.connectionId,
            filePath: "ktx.yaml"
          }
        });
        continue;
      }

      const state = readConnectionState(ktxText, target.connectionId);
      if (!state) {
        blockers.push("ops_connection_not_found");
        perTarget.push({
          id,
          groupId: "ktx",
          connectionId: target.connectionId,
          payload: { ...target },
          before: null,
          after: null,
          blockers: ["ops_connection_not_found"],
          writeSet: ["ktx.yaml"],
          audit: {
            changeType: target.removeSchema ? "schema_remove" : "enabled_tables_update",
            assetKind: "governance",
            targetId: target.removeSchema
              ? `${target.connectionId}:${target.removeSchema}`
              : target.connectionId,
            filePath: "ktx.yaml"
          }
        });
        continue;
      }

      const baseline: KtxBaseline = {
        connectionId: target.connectionId,
        enabledTables: state.enabledTables,
        schemas: state.schemas
      };

      let before: unknown = null;
      let after: unknown = null;
      let targetBlockers: string[] = [];

      if (target.removeSchema) {
        const prefix = `${target.removeSchema}.`;
        const removedEnabledTables = state.enabledTables.filter((table) => table.startsWith(prefix));
        const known = state.schemas.includes(target.removeSchema) || removedEnabledTables.length > 0;
        if (!known) {
          targetBlockers = ["ops_schema_not_found"];
        }
        before = {
          schemas: state.schemas,
          removedEnabledTables
        };
        after = {
          schemas: state.schemas.filter((schema) => schema !== target.removeSchema),
          removedEnabledTables
        };
      } else {
        const scanned = await scannedPhysicalTables(ctx.projectRoot, target.connectionId);
        try {
          const validated = validateEnabledTables(
            target.enabledTables,
            scanned,
            new Set(state.enabledTables)
          );
          before = { enabledTables: state.enabledTables, warnings: validated.warnings };
          after = { enabledTables: validated.tables, warnings: validated.warnings };
        } catch (err) {
          targetBlockers = [(err as { code?: string }).code ?? "ops_invalid_enabled_tables"];
        }
      }

      perTarget.push({
        id,
        groupId: "ktx",
        connectionId: target.connectionId,
        payload: { ...target, baseline },
        before,
        after,
        blockers: targetBlockers,
        writeSet: ["ktx.yaml"],
        audit: {
          changeType: target.removeSchema ? "schema_remove" : "enabled_tables_update",
          assetKind: "governance",
          targetId: target.removeSchema
            ? `${target.connectionId}:${target.removeSchema}`
            : target.connectionId,
          filePath: "ktx.yaml"
        }
      });
    }

    const groups: OpsPlanGroup[] = [
      { id: "ktx", memberIds: perTarget.map((target) => target.id), sharedFiles: ["ktx.yaml"] }
    ];

    return { perTarget, groups, blockers };
  }

  async executeGroup(ctx: OpsGroupContext): Promise<void> {
    const targets = ctx.members.map(
      (member) => member.payload as unknown as OpsConnectionTableTargetInput & { baseline?: KtxBaseline }
    );

    await withOpsWriteLocks(
      {
        projectRoot: ctx.projectRoot,
        scopes: ["D", "P", "C", "L"],
        publishWindow: false
      },
      async () => {
        const ktxPath = path.join(ctx.projectRoot, "ktx.yaml");
        const currentText = await readFile(ktxPath, "utf8");
        // 组级暂存：写入前的内容 + 「是否真的写过」。
        const state: KtxGroupState = { preImage: currentText, wrote: false };
        KTX_GROUP_STATES.set(ctx.executionId, state);

        // 锁内逐连接复算基线——检测到外部修改即整批拒绝。
        for (const target of targets) {
          const baseline = target.baseline;
          if (!baseline) continue;
          const state = readConnectionState(currentText, target.connectionId);
          if (!state) {
            throw new OpsConnectionTableError(
              "ops_connection_not_found",
              `连接 '${target.connectionId}' 在写入前消失`
            );
          }
          if (
            !sameList(state.enabledTables, baseline.enabledTables) ||
            !sameList(state.schemas, baseline.schemas)
          ) {
            throw new OpsConnectionTableError(
              OPS_EXTERNAL_MODIFICATION_DETECTED,
              `连接 '${target.connectionId}' 在预览后被外部修改，整批拒绝`
            );
          }
        }

        // 一次合并补丁（内存），最后只写一次。
        // 顺序：先把各连接的 enabled_tables 行级补丁合并好，再处理 Schema 移除
        // （Schema 移除要裁剪 enabled_tables，必须在最后生效）。
        let proposedYaml = currentText;
        const tableEntries: Array<{ connId: string; enabledTables: string[] }> = [];
        for (const target of targets) {
          if (target.removeSchema) continue;
          tableEntries.push({
            connId: target.connectionId,
            enabledTables: target.enabledTables ?? []
          });
        }
        if (tableEntries.length > 0) {
          proposedYaml = patchConnectionsEnabledTablesYaml(proposedYaml, tableEntries).proposedYaml;
        }
        for (const target of targets) {
          if (!target.removeSchema) continue;
          proposedYaml = patchRemoveSchemaYaml(proposedYaml, target.connectionId, target.removeSchema)
            .proposedYaml;
        }

        // 写入（一次）。
        const paths = await resolveContentPaths(ctx.projectRoot);
        await safeWriteAtomic(paths, ctx.projectRoot, "ktx.yaml", proposedYaml);
        state.wrote = true;
        for (const target of targets) {
          ctx.setEffectPhase(target.connectionId, "written");
        }

        // 生效确认：catalog 重载 + 策略提交。
        try {
          for (const connectionId of new Set(targets.map((target) => target.connectionId))) {
            await reloadCatalog(ctx.projectRoot, { connectionId });
          }
        } catch (err) {
          throw Object.assign(
            new Error(`catalog 重载失败：${String(err)}`),
            { opsOutcome: Outcome.recoveryRequired({ detail: "catalog_reload_failed" }) }
          );
        }
        try {
          const { commitEffectivePolicy } = await import("../proxy/acl.js");
          await commitEffectivePolicy();
        } catch (err) {
          throw Object.assign(
            new Error(`策略提交失败：${String(err)}`),
            { opsOutcome: Outcome.recoveryRequired({ detail: "policy_commit_failed" }) }
          );
        }
        for (const target of targets) {
          ctx.setEffectPhase(target.connectionId, "activated");
        }
      }
    );
  }

  async rollbackGroup(ctx: OpsGroupContext): Promise<OpsRollbackResult> {
    // ktx.yaml 的合并写要么整体成功要么整体未写；写成功但生效未确认时，
    // 撤销 = **逐字节**恢复写入前的 ktx.yaml 内容。
    const state = KTX_GROUP_STATES.get(ctx.executionId);
    if (!state) {
      // 没有前像（例如进程重启后的恢复）——无法证明撤销完整 ⇒ 交恢复处理。
      return { complete: false, detail: "ops_ktx_preimage_unavailable" };
    }
    if (!state.wrote) {
      // 失败发生在**写入之前**（例如锁内发现外部修改）：没有效果需要撤销。
      // ⚠️ 这里**不得**写文件——否则会用基线覆盖别人的外部修改，
      // 那本身是一次控制面写入，违反「整批不写」。
      KTX_GROUP_STATES.delete(ctx.executionId);
      return { complete: true };
    }
    try {
      await withOpsWriteLocks(
        { projectRoot: ctx.projectRoot, scopes: ["D", "P", "C", "L"], publishWindow: false },
        async () => {
          const paths = await resolveContentPaths(ctx.projectRoot);
          await safeWriteAtomic(paths, ctx.projectRoot, "ktx.yaml", state.preImage);
        }
      );
      KTX_GROUP_STATES.delete(ctx.executionId);
      return { complete: true };
    } catch (err) {
      return { complete: false, detail: String(err) };
    }
  }

  /** 组终结：成功即丢弃暂存（无需再回滚）。 */
  async finalizeGroup(ctx: OpsGroupContext): Promise<void> {
    KTX_GROUP_STATES.delete(ctx.executionId);
  }

  async verifyGroup(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult> {
    // 核验：目标连接的 enabled_tables / schemas 是否与计划一致。
    try {
      const ktxPath = path.join(ctx.projectRoot, "ktx.yaml");
      const currentText = await readFile(ktxPath, "utf8");
      const members = ctx.members.map((member) => {
        const target = member.payload as unknown as OpsConnectionTableTargetInput & {
          baseline?: KtxBaseline;
        };
        const state = readConnectionState(currentText, target.connectionId);
        if (!state) {
          return { id: member.id, state: "unknown" as const, detail: "connection_missing" };
        }
        const after = member.after as { enabledTables?: string[] } | null;
        if (target.removeSchema) {
          const removed = state.schemas.includes(target.removeSchema);
          return {
            id: member.id,
            state: removed ? ("failed" as const) : ("succeeded" as const),
            detail: { schemas: state.schemas }
          };
        }
        if (!after?.enabledTables) {
          return { id: member.id, state: "unknown" as const, detail: "no_expected_state" };
        }
        const matches = sameList(state.enabledTables, after.enabledTables);
        return {
          id: member.id,
          state: matches ? ("succeeded" as const) : ("failed" as const),
          detail: { enabledTables: state.enabledTables }
        };
      });
      return { members };
    } catch (err) {
      return {
        members: ctx.members.map((member) => ({
          id: member.id,
          state: "unknown" as const,
          detail: String(err)
        }))
      };
    }
  }
}

