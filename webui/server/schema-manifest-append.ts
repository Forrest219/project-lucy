/**
 * P1-90／REQ-030-111 — Schema Manifest 按表追加（create-only）。
 *
 * 客户现场缺口：import 为 update-only（表键已存在才允许），向既有 Schema 新增一张表
 * 无 API 通道。本模块提供按表合并追加：在既有 Manifest 文档上仅 `setIn` 新增节点，
 * 其余表节点逐字节不动；兼容 1/2/3 段物理表名（末尾段与路径表名大小写不敏感一致）；
 * 派生列（`expr`／`role`）与节点白名单外键显式拒绝；同连接存在同名 standalone 文件时
 * 输出 `EXISTING_STANDALONE_SHADOW` 非阻断告警。响应信封对齐 P1-89 D8。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { auditActorFields, type TrustedActor } from "./security/request-actor.js";
import {
  assertSafeSegment,
  readYamlDocument,
  resolveSchemaManifestPath,
  scopesForSourceFiles,
  serialize,
  valueAsRecord,
  SourceNotFoundError,
  SchemaManifestNotFoundError,
  AmbiguousSchemaError,
  YamlParseError,
  TABLE_KEYS
} from "./semantic-layer";

/** P1-89 D8 — 非阻断告警统一 `warnings: [{ code, ... }]` 形态。 */
export type SchemaAppendWarning = {
  code: string;
  file?: string;
  hint: string;
};

export class TableAlreadyExistsError extends Error {
  code = "TABLE_ALREADY_EXISTS";
  statusCode = 409;
  data: { nextSteps: string[] };

  constructor(message: string, nextSteps: string[]) {
    super(message);
    this.name = "TableAlreadyExistsError";
    this.data = { nextSteps };
  }
}

/** 节点内容校验失败（白名单外键 / TABLE_NAME_MISMATCH / OVERLAY_ONLY_KEY），统一 422。 */
export class SchemaAppendValidationError extends Error {
  code: string;
  statusCode = 422;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SchemaAppendValidationError";
    this.code = code;
  }
}

export type SchemaAppendPlan = {
  relPath: string;
  node: Record<string, unknown>;
  proposedYaml: string;
  diff: string;
  warnings: SchemaAppendWarning[];
};

/** 抽取单表节点：支持单表 YAML 片段或含 `tables.<table>` 的片段。 */
function extractTableNode(yaml: string, table: string): Record<string, unknown> {
  const doc = parseDocument(yaml, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new YamlParseError(`Failed to parse appended YAML: ${doc.errors[0].message}`);
  }
  const root = valueAsRecord(doc.toJSON());
  if (root.tables && typeof root.tables === "object" && !Array.isArray(root.tables)) {
    const value = valueAsRecord(root.tables)[table];
    if (!value) {
      throw new SourceNotFoundError(`Appended YAML does not contain table ${table}`);
    }
    return valueAsRecord(value);
  }
  if (Object.keys(root).length === 0) {
    throw new SourceNotFoundError(`Appended YAML does not contain table ${table}`);
  }
  return root;
}

/** 反向 standalone shadow 检测（只读，不阻断）：同名文件含 `table:`/`sql:` 即 standalone。 */
export async function detectExistingStandaloneShadow(conn: string, table: string): Promise<SchemaAppendWarning[]> {
  assertSafeSegment(table, "table");
  const relPath = path.posix.join("semantic-layer", conn, `${table}.yaml`);
  let text: string;
  try {
    const paths = await loadContentPaths();
    text = await readFile(path.join(paths.semanticLayer, conn, `${table}.yaml`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    // 同名文件不是合法 YAML：不动它，也不基于猜测告警。
    return [];
  }
  const root = valueAsRecord(doc.toJSON());
  if ("table" in root || "sql" in root) {
    return [
      {
        code: "EXISTING_STANDALONE_SHADOW",
        file: relPath,
        hint: "同连接存在同名 standalone 文件，将遮蔽刚追加的 Manifest 定义；可经 DELETE /api/semantic-assets/overlay/<conn>/<table> 清理"
      }
    ];
  }
  return [];
}

export async function planSchemaManifestAppend(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  yaml: string
): Promise<SchemaAppendPlan> {
  assertSafeSegment(conn, "connection");
  assertSafeSegment(schema, "schema");
  assertSafeSegment(table, "table");
  const relPath = await resolveSchemaManifestPath(projectRoot, conn, schema);

  const node = extractTableNode(yaml, table);
  if (Object.keys(node).length === 0) {
    throw new SchemaAppendValidationError(
      "SCHEMA_APPEND_UNKNOWN_KEY",
      `导入片段中的表节点 ${table} 为空（可能是标量或 null），不能追加空表节点`
    );
  }

  // 节点键白名单（与 import / KTX Manifest 列模型一致，防派生列被静默丢弃）。
  const unknownKeys = Object.keys(node).filter((key) => !TABLE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new SchemaAppendValidationError(
      "SCHEMA_APPEND_UNKNOWN_KEY",
      `表节点含不支持的字段：${unknownKeys.join("、")}；允许键：${[...TABLE_KEYS].join("、")}`
    );
  }

  // 1/2/3 段物理表名：仅校验末尾物理表名段与路径 table 大小写不敏感一致（OQ-3）。
  if (typeof node.table === "string" && node.table.trim()) {
    const lastSegment = node.table.trim().split(".").pop() ?? "";
    if (lastSegment.toLowerCase() !== table.toLowerCase()) {
      throw new SchemaAppendValidationError(
        "TABLE_NAME_MISMATCH",
        `物理表名末尾段与路径 table 不一致：${node.table} vs ${table}`
      );
    }
  }

  // 派生列 / role 属 overlay 职责，写入 Manifest 会被运行时静默丢弃（F6）。
  const columns = Array.isArray(node.columns) ? node.columns : [];
  for (const column of columns) {
    const record = valueAsRecord(column);
    if ("expr" in record || "role" in record) {
      throw new SchemaAppendValidationError(
        "OVERLAY_ONLY_KEY",
        "派生列（expr）／role 属 overlay 职责，写入 Manifest 会被静默丢弃；请落 per-table overlay"
      );
    }
  }

  const { doc, text } = await readYamlDocument(projectRoot, relPath);
  const existingTables = valueAsRecord(doc.toJSON()).tables;
  if (valueAsRecord(existingTables)[table]) {
    throw new TableAlreadyExistsError(
      `表已存在于 Schema Manifest：${conn}/${schema}/${table}；更新既有表请走 import`,
      [`POST /api/sources/${conn}/${schema}/${table}/import`]
    );
  }

  const warnings = await detectExistingStandaloneShadow(conn, table);

  doc.setIn(["tables", table], doc.createNode(node));
  const proposedYaml = serialize(doc);
  const diff = previewDiff(text, proposedYaml, relPath);
  return { relPath, node, proposedYaml, diff, warnings };
}

/**
 * 正式写：复用 L25-16 既有管线（ktx.yaml 写锁 → 展示写屏障 → 发布窗口 →
 * release ＋ recovery journal → auditedWriteFile → closeContentBatch）。
 * 追加属 Manifest 新增表操作，不创建既有表编辑的 TableYamlVersionSnapshot。
 */
export async function writeSchemaManifestAppend(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  plan: SchemaAppendPlan,
  actor?: TrustedActor
): Promise<void> {
  const { relPath, proposedYaml, diff } = plan;
  await withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["D"], async (token) => {
      expandDisplayWrite(token, await scopesForSourceFiles(projectRoot, [{ filePath: relPath }]));
      await withPublishCoordinator(
        "semantic_table_append",
        async () => {
          const opened = await openPromotingContentRelease({
            projectRoot,
            actor: actor?.actorId ?? "local-admin",
            targets: [
              {
                targetPath: relPath,
                expectedNewDigest: createHash("sha256").update(proposedYaml, "utf8").digest("hex"),
                assetKind: "manifest",
                identity: { connectionId: conn, schema, table }
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
                identity: { connectionId: conn, schema, table },
                newContent: proposedYaml
              }
            ]
          });
          try {
            await auditedWriteFile(projectRoot, relPath, proposedYaml, {
              enabled: true,
              changeType: "semantic_table_append",
              assetKind: "semantic",
              ...auditActorFields(actor),
              source: "schema_manifest_append_api",
              targetId: `${conn}:${schema}:${table}`,
              diff,
              operation: "append"
            });
            await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
            await closeContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              attemptId: opened.attemptId,
              actor: actor?.actorId ?? "local-admin",
              journalId: journal.journalId,
              changeType: "semantic_table_append_terminal",
              source: "schema_manifest_append_api",
              targetId: `${conn}:${schema}:${table}`,
              operation: "append_terminal",
              newSummary: { connectionId: conn, schema, table, fileCount: 1 }
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

export { SchemaManifestNotFoundError, AmbiguousSchemaError };
