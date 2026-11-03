/**
 * Spec 149 §6 / §8 / WO T4 — 运维问数连接的显式授权与查询门。
 *
 * 覆盖：SC-01、SC-08（查询码）、SC-10、SC-20（查询码）。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

let projectRoot: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

const ACCESS_YAML = `roles:
  lucy_admin:
    description: 平台运维数据面（非 WebUI 登录账户）
    permission_model_version: 2
    allow:
      connections:
        - "*"
      source_scope: catalog_bound
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - connection_list
  demo_readonly:
    description: demo readonly
    allow:
      connections:
        - demo-mysql
      tableSelectors:
        - connection: demo-mysql
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - connection_list
  lucy_ops_reader:
    description: 运维问数角色
    allow:
      connections:
        - lucy-ops
      tableSelectors:
        - connection: lucy-ops
          schema: main
          names:
            - ops_calls
            - ops_call_tables
          row_access: all
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - connection_list
users:
  - id: admin_agent
    name: Admin Agent
    enabled: true
    role: lucy_admin
    tokens: []
  - id: demo_agent
    name: Demo Agent
    enabled: true
    role: demo_readonly
    tokens: []
  - id: ops_agent
    name: Ops Agent
    enabled: true
    role: lucy_ops_reader
    tokens: []
defaults:
  deny_tools: []
`;

const OPS_SCHEMA_YAML = `tables:
  ops_calls:
    table: ops_calls
  ops_call_tables:
    table: ops_call_tables
`;

const DEMO_SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject(lucyOpsBlock: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-evidence-acl-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "lucy-ops", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "demo-mysql", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  demo-mysql:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
    schemas:
      - dataforai
${lucyOpsBlock}setup:
  database_connection_ids:
    - demo-mysql
`,
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "lucy-ops", "_schema", "main.yaml"), OPS_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "demo-mysql", "_schema", "dataforai.yaml"), DEMO_SCHEMA_YAML, "utf8");
  return root;
}

function consistentBlock(auditDbPath: string): string {
  return `  lucy-ops:
    driver: sqlite
    readonly: true
    path: ${auditDbPath}
    schemas:
      - main
    enabled_tables:
      - ops_calls
      - ops_call_tables
`;
}

function consistentYaml(auditDbPath: string): string {
  return `connections:
  demo-mysql:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
    schemas:
      - dataforai
${consistentBlock(auditDbPath)}setup:
  database_connection_ids:
    - demo-mysql
`;
}

async function loadAll() {
  vi.resetModules();
  const readiness = await import("../ops-evidence/readiness");
  const acl = await import("../proxy/acl");
  return { readiness, acl };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
});

describe("Spec 149 §6 — 显式授权", () => {
  it("SC-01: 只有显式列出的 Role 能看见并查询运维问数连接", async () => {
    projectRoot = await makeProject("");
    const auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    await writeFile(path.join(projectRoot, "ktx.yaml"), consistentYaml(auditDbPath), "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { readiness, acl } = await loadAll();
    await readiness.writeOpsEvidenceDigestStamp(projectRoot);

    // 显式授权的 Role：目录可见，查询放行。
    const opsCatalog = await acl.lucyCatalog(identity("ops_agent"));
    expect(opsCatalog.connections).toContain("lucy-ops");
    expect(opsCatalog.sources.map((source) => source.sourceName)).toContain("ops_calls");

    await expect(
      acl.authorizeAndRewrite(identity("ops_agent"), "lucy_query", {
        connectionId: "lucy-ops",
        measures: ["ops_calls.call_count"]
      })
    ).resolves.toEqual({ allowed: true });

    // 未显式列出的 Role：目录没有该连接，查询被拒绝。
    const demoCatalog = await acl.lucyCatalog(identity("demo_agent"));
    expect(demoCatalog.connections).not.toContain("lucy-ops");
    await expect(
      acl.authorizeAndRewrite(identity("demo_agent"), "lucy_query", {
        connectionId: "lucy-ops",
        measures: ["ops_calls.call_count"]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "unknown_or_forbidden_connection:lucy-ops"
    });
  });

  it("SC-10: lucy_admin 的编译连接集不含 lucy-ops", async () => {
    projectRoot = await makeProject("");
    const auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    await writeFile(path.join(projectRoot, "ktx.yaml"), consistentYaml(auditDbPath), "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { readiness, acl } = await loadAll();
    await readiness.writeOpsEvidenceDigestStamp(projectRoot);

    const resolved = await acl.effectivePermissions(identity("admin_agent"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.permissions.connections).not.toContain("lucy-ops");
    expect(
      resolved.permissions.sources.some((source) => source.connectionId === "lucy-ops")
    ).toBe(false);

    const catalog = await acl.lucyCatalog(identity("admin_agent"));
    expect(catalog.connections).not.toContain("lucy-ops");

    await expect(
      acl.authorizeAndRewrite(identity("admin_agent"), "lucy_query", {
        connectionId: "lucy-ops",
        measures: ["ops_calls.call_count"]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "unknown_or_forbidden_connection:lucy-ops"
    });
  });

  it("SC-20: 未就绪时目录不列出该连接，查询返回 OPS_EVIDENCE_RUNTIME_NOT_READY", async () => {
    projectRoot = await makeProject("");
    const auditDbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    await writeFile(path.join(projectRoot, "ktx.yaml"), consistentYaml(auditDbPath), "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { acl } = await loadAll();
    // 没有摘要戳 → 不是 current。
    const catalog = await acl.lucyCatalog(identity("ops_agent"));
    expect(catalog.connections).not.toContain("lucy-ops");
    expect(catalog.sources.some((source) => source.connectionId === "lucy-ops")).toBe(false);

    await expect(
      acl.authorizeAndRewrite(identity("ops_agent"), "lucy_query", {
        connectionId: "lucy-ops",
        measures: ["ops_calls.call_count"]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "OPS_EVIDENCE_RUNTIME_NOT_READY"
    });
  });

  it("SC-08: 连接块冲突时查询返回 OPS_EVIDENCE_CONNECTION_CONFLICT", async () => {
    projectRoot = await makeProject(`  lucy-ops:
    driver: sqlite
    readonly: false
    path: /tmp/some-other.sqlite
    schemas:
      - main
    enabled_tables:
      - ops_calls
`);
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";

    const { acl } = await loadAll();
    const catalog = await acl.lucyCatalog(identity("ops_agent"));
    expect(catalog.connections).not.toContain("lucy-ops");

    await expect(
      acl.authorizeAndRewrite(identity("ops_agent"), "lucy_query", {
        connectionId: "lucy-ops",
        measures: ["ops_calls.call_count"]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "OPS_EVIDENCE_CONNECTION_CONFLICT"
    });
  });
});
