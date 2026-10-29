/**
 * L25-16 S4 — `lucy_ops_source_import` 批量写（Spec §3.3 / §4.3 / §6.3，D7 / R11 / N04 / F07，
 * F5-05 / G27）。
 *
 * 覆盖本阶段仍缺的直接测试：
 * - **同连接不同 schema 的同名表合组**：Overlay 路径不含 Schema ⇒ 同连接不同 Schema 的同名表
 *   写同一个文件，必须落在同一个原子组（组身份由**实际写集交集**决定，不得用 Schema 近似）。
 * - **组内全成或全败**：组内任一成员校验失败 ⇒ 整组回滚，同组其他成员的写入也必须撤销。
 * - **组间可部分成功**：写集不相交的组互不阻断。
 * - **版本裁剪延后到组成功之后**：组失败时不得裁剪历史版本（被裁掉的旧快照必须仍可读）；
 *   组成功（终结）后才执行裁剪。
 *
 * `validateSource` 会 shell out 到 `ktx` CLI——本文件把它替换成可控的桩，
 * 以便精确注入「某个目标校验失败」。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { validateSource } from "../../ktx";
import { getOpsToolSpec } from "../control-plane";
import { runOpsCommit, runOpsPreview } from "../ops-batch";
import { getOpsDatabase } from "../ops-idempotency";
import type { OpsGrant } from "../ops-grants";
import { OpsSourceImportAdapter } from "../ops-source-batch";
import {
  createTableYamlVersionSnapshotDeferred,
  TABLE_YAML_VERSION_RETENTION_LIMIT
} from "../../table-yaml-history";

vi.mock("../../ktx", () => ({
  validateSource: vi.fn(async () => ({
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    issues: []
  }))
}));

const TOOL = "lucy_ops_source_import";

const GRANTS: OpsGrant[] = [
  { tools: [TOOL], asset_kinds: ["semantic"], connections: ["conn_a", "conn_b"] }
];

const KTX_YAML = `connections:
  conn_a:
    driver: duckdb
    schemas:
      - s1
      - s2
    enabled_tables:
      - s1.orders
  conn_b:
    driver: duckdb
    schemas:
      - s1
    enabled_tables:
      - s1.orders
`;

function manifest(tables: string[]): string {
  const body = tables
    .map(
      (name) =>
        `  ${name}:\n    table: ${name}\n    columns:\n      - name: id\n        type: integer\n        nullable: false`
    )
    .join("\n");
  return `tables:\n${body}\n`;
}

/** 覆盖式导入（只改 Manifest 的一列描述）。 */
function schemaImport(table: string, extraColumn: string): string {
  return `tables:
  ${table}:
    columns:
      - name: id
        type: integer
      - name: ${extraColumn}
        type: string
`;
}

/** 覆盖式导入（只改 Overlay）。 */
function overlayImport(grain: string[]): string {
  return `grain:\n${grain.map((item) => `  - ${item}`).join("\n")}\n`;
}

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousContentRoot: string | undefined;

beforeAll(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ops-source-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_a", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "conn_b", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\nusers: []\n", "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml"), manifest(["orders", "items"]), "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s2.yaml"), manifest(["orders"]), "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_b", "_schema", "s1.yaml"), manifest(["orders"]), "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
});

afterAll(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const database = await getOpsDatabase();
  database.exec(
    "DELETE FROM ops_operations; DELETE FROM ops_targets; DELETE FROM ops_plans; DELETE FROM config_change_log;"
  );
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml"), manifest(["orders", "items"]), "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s2.yaml"), manifest(["orders"]), "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "conn_b", "_schema", "s1.yaml"), manifest(["orders"]), "utf8");
  await rm(path.join(projectRoot, "semantic-layer", "conn_a", "orders.yaml"), { force: true });
  await rm(path.join(projectRoot, "semantic-layer", "conn_b", "orders.yaml"), { force: true });
  // 历史索引与快照是跨用例共享的持久状态——每个用例从空历史开始。
  await rm(path.join(projectRoot, ".ktx-ui", "table-yaml-history"), { recursive: true, force: true });
  vi.mocked(validateSource).mockImplementation(async () => ({
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    issues: []
  }));
});

async function preview(
  adapter: OpsSourceImportAdapter,
  targets: unknown[]
): Promise<{ planId: string; digest: string }> {
  const envelope = await runOpsPreview({
    adapter,
    projectRoot,
    actor: "ops_agent",
    delegatedFrom: null,
    request: { targets }
  });
  expect(envelope.ok).toBe(true);
  if (!envelope.ok) throw new Error("preview failed");
  const data = envelope.data as { plan_id: string; confirm_digest: string };
  return { planId: data.plan_id, digest: data.confirm_digest };
}

// ─── 组划分 ──────────────────────────────────────────────────────────────────

describe("L25-16 S4 原子组划分（写集交集）", () => {
  it("同连接不同 schema 的同名表写同一个 Overlay 文件 ⇒ 必须合组", async () => {
    const adapter = new OpsSourceImportAdapter();
    const draft = await adapter.buildPlan({
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      request: {
        targets: [
          { connectionId: "conn_a", schema: "s1", table: "orders", yaml: overlayImport(["id"]) },
          { connectionId: "conn_a", schema: "s2", table: "orders", yaml: overlayImport(["id"]) },
          { connectionId: "conn_b", schema: "s1", table: "orders", yaml: overlayImport(["id"]) }
        ]
      }
    });

    const groupOf = new Map(draft.perTarget.map((target) => [target.id, target.groupId]));
    const a = groupOf.get("conn_a:s1:orders");
    const b = groupOf.get("conn_a:s2:orders");
    const c = groupOf.get("conn_b:s1:orders");
    expect(a).toBeDefined();
    // 同连接不同 Schema 的同名表 ⇒ 同一组（Overlay 路径不含 Schema）。
    expect(b).toBe(a);
    // 不同连接 ⇒ 不同组。
    expect(c).not.toBe(a);

    const group = draft.groups.find((item) => item.id === a);
    expect(group?.memberIds).toEqual(expect.arrayContaining(["conn_a:s1:orders", "conn_a:s2:orders"]));
    expect(group?.sharedFiles).toContain("semantic-layer/conn_a/orders.yaml");
  });

  it("同连接同 schema 的多张表共享 Manifest ⇒ 合组；不同 Manifest ⇒ 不同组", async () => {
    const adapter = new OpsSourceImportAdapter();
    const draft = await adapter.buildPlan({
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      request: {
        targets: [
          { connectionId: "conn_a", schema: "s1", table: "orders", yaml: schemaImport("orders", "extra_a") },
          { connectionId: "conn_a", schema: "s1", table: "items", yaml: schemaImport("items", "extra_b") },
          { connectionId: "conn_b", schema: "s1", table: "orders", yaml: schemaImport("orders", "extra_c") }
        ]
      }
    });

    const groupOf = new Map(draft.perTarget.map((target) => [target.id, target.groupId]));
    expect(groupOf.get("conn_a:s1:items")).toBe(groupOf.get("conn_a:s1:orders"));
    expect(groupOf.get("conn_b:s1:orders")).not.toBe(groupOf.get("conn_a:s1:orders"));
  });
});

// ─── 组内原子性 / 组间部分成功 ───────────────────────────────────────────────

describe("L25-16 S4 组内全成或全败、组间可部分成功", () => {
  it("组内任一成员校验失败 ⇒ 整组回滚（同组其他成员的写入也被撤销）", async () => {
    const adapter = new OpsSourceImportAdapter();
    const manifestPath = path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml");
    const before = await readFile(manifestPath, "utf8");

    vi.mocked(validateSource).mockImplementation(async (_root, conn, schema, table) => {
      const key = `${conn}/${schema}/${table}`;
      if (key === "conn_a/s1/items") {
        return { ok: false, exitCode: 1, stdout: "", stderr: "invalid", issues: [] };
      }
      return { ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] };
    });

    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_a", schema: "s1", table: "orders", yaml: schemaImport("orders", "extra_a") },
      { connectionId: "conn_a", schema: "s1", table: "items", yaml: schemaImport("items", "extra_b") }
    ]);

    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-source-group-fail",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["conn_a:s1:orders", "conn_a:s1:items"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as {
      per_target: Array<{ id: string; kind: string }>;
      succeeded: number;
      failed: number;
    };
    // 组内全败：同组的另一个成员也不能算成功。
    expect(data.succeeded).toBe(0);
    expect(data.failed).toBe(2);
    for (const item of data.per_target) {
      expect(item.kind).toBe("failed");
    }
    // 整组回滚 ⇒ Manifest 回到写入前的内容。
    expect(await readFile(manifestPath, "utf8")).toBe(before);
  });

  it("写集不相交的两组：一组失败、另一组成功（组间可部分成功）", async () => {
    const adapter = new OpsSourceImportAdapter();
    const aPath = path.join(projectRoot, "semantic-layer", "conn_a", "_schema", "s1.yaml");
    const bPath = path.join(projectRoot, "semantic-layer", "conn_b", "_schema", "s1.yaml");
    const aBefore = await readFile(aPath, "utf8");
    const bBefore = await readFile(bPath, "utf8");

    vi.mocked(validateSource).mockImplementation(async (_root, conn, schema, table) => {
      const key = `${conn}/${schema}/${table}`;
      if (key === "conn_a/s1/orders") {
        return { ok: false, exitCode: 1, stdout: "", stderr: "invalid", issues: [] };
      }
      return { ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] };
    });

    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_a", schema: "s1", table: "orders", yaml: schemaImport("orders", "extra_a") },
      { connectionId: "conn_b", schema: "s1", table: "orders", yaml: schemaImport("orders", "extra_c") }
    ]);

    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-source-partial",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["conn_a:s1:orders", "conn_b:s1:orders"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as {
      per_target: Array<{ id: string; kind: string }>;
      succeeded: number;
      failed: number;
      operation_state: string;
    };
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(1);
    const byId = new Map(data.per_target.map((item) => [item.id, item.kind]));
    expect(byId.get("conn_a:s1:orders")).toBe("failed");
    expect(byId.get("conn_b:s1:orders")).toBe("succeeded");
    // 全集聚合：有一个成员失败 ⇒ operation 不是 succeeded，但失败的组之外的成功效果保留。
    expect(data.operation_state).toBe("failed");

    // 失败组回滚、成功组保留。
    expect(await readFile(aPath, "utf8")).toBe(aBefore);
    expect(await readFile(bPath, "utf8")).not.toBe(bBefore);
    expect(await readFile(bPath, "utf8")).toContain("extra_c");
  });
});

// ─── 版本裁剪延后 ────────────────────────────────────────────────────────────

describe("L25-16 S4 版本裁剪延后到组成功之后", () => {
  it("组失败 ⇒ 被裁剪的旧版本仍可读（不裁剪）", async () => {
    // 先造出超过保留上限的版本（用延后裁剪的入口建索引，不裁剪）。
    const limit = TABLE_YAML_VERSION_RETENTION_LIMIT;
    for (let index = 0; index <= limit; index += 1) {
      await createTableYamlVersionSnapshotDeferred(
        projectRoot,
        "conn_b",
        "s1",
        "orders",
        `grain:\n  - col_${index}\n`,
        { operation: "import" }
      );
    }
    const before = await listSnapshotFiles("conn_b", "s1", "orders");

    const adapter = new OpsSourceImportAdapter();
    vi.mocked(validateSource).mockImplementation(async () => ({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "invalid",
      issues: []
    }));

    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_b", schema: "s1", table: "orders", yaml: overlayImport(["failing"]) }
    ]);
    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-source-prune-fail",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["conn_b:s1:orders"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });
    expect(envelope.ok).toBe(true);

    // 组失败 ⇒ 旧版本一个都不能少（裁剪被延后，且本组条目被回滚）。
    const after = await listSnapshotFiles("conn_b", "s1", "orders");
    for (const file of before) {
      expect(after).toContain(file);
    }
    expect(after.length).toBe(before.length);
  });

  it("组成功（终结）⇒ 延后的裁剪才执行", async () => {
    const limit = TABLE_YAML_VERSION_RETENTION_LIMIT;
    for (let index = 0; index <= limit; index += 1) {
      await createTableYamlVersionSnapshotDeferred(
        projectRoot,
        "conn_b",
        "s1",
        "orders",
        `grain:\n  - seed_${index}\n`,
        { operation: "import" }
      );
    }
    const before = await listSnapshotFiles("conn_b", "s1", "orders");
    expect(before.length).toBe(limit + 1);

    const adapter = new OpsSourceImportAdapter();
    const { planId, digest } = await preview(adapter, [
      { connectionId: "conn_b", schema: "s1", table: "orders", yaml: overlayImport(["id"]) }
    ]);
    const envelope = await runOpsCommit({
      adapter,
      projectRoot,
      actor: "ops_agent",
      delegatedFrom: null,
      idempotencyKey: "idem-source-prune-ok",
      planId,
      confirmDigest: digest,
      requestTargetIds: ["conn_b:s1:orders"],
      grants: GRANTS,
      tool: getOpsToolSpec(TOOL)
    });
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;
    const data = envelope.data as { succeeded: number; failed: number };
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(0);

    // 组终结后才裁剪 ⇒ 索引回到保留上限，超限的旧快照被删掉。
    const after = await listSnapshotFiles("conn_b", "s1", "orders");
    expect(after.length).toBe(TABLE_YAML_VERSION_RETENTION_LIMIT);
  });
});

/**
 * 列出某表的历史快照文件（相对路径）。
 *
 * 快照目录名是 `sha256(conn/schema/table)` 的前 16 位——与实现同源。
 */
async function listSnapshotFiles(conn: string, schema = "s1", table = "orders"): Promise<string[]> {
  const { createHash } = await import("node:crypto");
  const dir = createHash("sha256").update(`${conn}/${schema}/${table}`).digest("hex").slice(0, 16);
  const root = path.join(projectRoot, ".ktx-ui", "table-yaml-history", "snapshots", dir);
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root).catch(() => [] as string[]);
  return entries.map((file) => `${dir}/${file}`).sort();
}
