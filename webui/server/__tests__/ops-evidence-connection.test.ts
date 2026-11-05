/**
 * Spec 149 §7 / §8 / WO T2 — 运维问数连接块与就绪状态。
 *
 * 覆盖：SC-05、SC-08、SC-11、SC-20。
 * SC-11 的有效口径见客户默认系统正式 Role：缺 lucy_ops_reader 可创建；
 * 已存在、conflict、not_ready 时 access.yaml 字节不变。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { expandTemplate } from "../admin/role-templates";
import { OPS_EVIDENCE_ENABLED_TABLES, OPS_EVIDENCE_ROLE_ID } from "../ops-evidence/contract";

let projectRoot: string | undefined;
let auditDbPath: string | undefined;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

const BASE_YAML = `connections:
  demo-mysql:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
setup:
  database_connection_ids:
    - demo-mysql
`;

const ACCESS_YAML = `roles:
  demo_readonly:
    description: demo
    allow:
      connections:
        - demo-mysql
      tools:
        - lucy_query
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    role: demo_readonly
    tokens: []
`;

async function makeProject(yaml: string = BASE_YAML): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-evidence-conn-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), yaml, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  return root;
}

async function loadModule<T>(specifier: string): Promise<T> {
  vi.resetModules();
  return (await import(specifier)) as T;
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
});

afterEach(async () => {
  const readiness = await import("../ops-evidence/readiness");
  readiness.resetOpsEvidenceEnsureState();
  const audit = await import("../proxy/audit");
  audit.closeAuditDb();
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

describe("Spec 149 §7 — 连接块与一致性裁决", () => {
  it("SC-05: 缺失时写入只读块，enabled_tables 用冻结的 physicalTable，且不进 database_connection_ids", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { ensureOpsEvidenceConnectionBlock, readOpsEvidenceBlock, readDatabaseConnectionIds } =
      await loadModule<typeof import("../ops-evidence/connection-block")>(
        "../ops-evidence/connection-block"
      );

    const state = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
      manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
    });
    expect(state.write).toBe("inserted");

    const block = await readOpsEvidenceBlock(projectRoot);
    expect(block?.driver).toBe("sqlite");
    expect(block?.readonly).toBe(true);
    expect(block?.path).toBe(auditDbPath);
    expect(block?.database).toBe(auditDbPath);
    expect(block?.schemas).toEqual(["main"]);
    expect(block?.enabled_tables).toEqual([
      "ops_calls",
      "ops_call_tables",
      "ops_agents",
      "ops_tokens",
      "ops_agent_activity",
      "ops_question_kpi_agents",
      "ops_grant_paths",
      "ops_access_paths",
      "ops_edge_signals",
      "ops_map_nodes",
      "ops_map_meta",
      "ops_table_adoption"
    ]);

    // Goal 5 — 不写 setup.database_connection_ids。
    expect(await readDatabaseConnectionIds(projectRoot)).toEqual(["demo-mysql"]);
  });

  it("SC-08: driver / 路径 / readonly 三种不一致都不覆盖，状态为 conflict", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { ensureOpsEvidenceConnectionBlock, readOpsEvidenceBlock } = await loadModule<
      typeof import("../ops-evidence/connection-block")
    >("../ops-evidence/connection-block");

    const cases: Array<{ label: string; yaml: string }> = [
      {
        label: "driver 不是 sqlite",
        yaml: `connections:
  lucy-ops:
    driver: mysql
    readonly: true
    path: ${auditDbPath}
    schemas:
      - main
    enabled_tables:
      - ops_calls
`
      },
      {
        label: "路径不是当前审计库",
        yaml: `connections:
  lucy-ops:
    driver: sqlite
    readonly: true
    path: /tmp/some-other.sqlite
    schemas:
      - main
    enabled_tables:
      - ops_calls
`
      },
      {
        label: "readonly 不是 true",
        yaml: `connections:
  lucy-ops:
    driver: sqlite
    readonly: false
    path: ${auditDbPath}
    schemas:
      - main
    enabled_tables:
      - ops_calls
`
      }
    ];

    for (const testCase of cases) {
      await writeFile(path.join(projectRoot, "ktx.yaml"), testCase.yaml, "utf8");
      const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
      const state = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
        manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
      });
      expect(state.write, testCase.label).toBe("conflict");
      const after = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
      expect(after, testCase.label).toBe(before);
      const block = await readOpsEvidenceBlock(projectRoot);
      expect(block?.driver, testCase.label).toBe(
        testCase.label === "driver 不是 sqlite" ? "mysql" : "sqlite"
      );
    }
  });

  it("一致时不改文件", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const { ensureOpsEvidenceConnectionBlock } = await loadModule<
      typeof import("../ops-evidence/connection-block")
    >("../ops-evidence/connection-block");

    expect((await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
      manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
    })).write).toBe("inserted");
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect((await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
      manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
    })).write).toBe("unchanged");
    expect(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).toBe(before);
  });
});

describe("Spec 149 §8 — 就绪状态与摘要戳", () => {
  it("SC-20: daemon 已启动后才插入连接 → reload_required；戳与摘要一致 → current", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const readiness = await loadModule<typeof import("../ops-evidence/readiness")>(
      "../ops-evidence/readiness"
    );
    const { ensureOpsEvidenceConnectionBlock } = await loadModule<
      typeof import("../ops-evidence/connection-block")
    >("../ops-evidence/connection-block");

    // 连接还没有 → 未就绪。
    let state = await readiness.readOpsEvidenceReadiness({ projectRoot, auditDbPath });
    expect(state.readiness).toBe("reload_required");

    // daemon 已启动之后才插入 → 仍然是 reload_required（不自动重载）。
    await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath, {
      manifestPhysicalTables: OPS_EVIDENCE_ENABLED_TABLES
    });
    readiness.recordOpsEvidenceEnsureState({ connectionWrite: "inserted", readiness: "reload_required" });
    state = await readiness.readOpsEvidenceReadiness({ projectRoot, auditDbPath });
    expect(state.readiness).toBe("reload_required");

    // 摘要戳与当前 ktx.yaml 一致 → current。
    await readiness.writeOpsEvidenceDigestStamp(projectRoot);
    readiness.recordOpsEvidenceEnsureState({ connectionWrite: "unchanged", readiness: "current" });
    state = await readiness.readOpsEvidenceReadiness({ projectRoot, auditDbPath });
    expect(state.readiness).toBe("current");
  });

  it("冲突时状态是 conflict", async () => {
    projectRoot = await makeProject(
      `connections:
  lucy-ops:
    driver: mysql
    readonly: true
    path: /tmp/other.sqlite
`
    );
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const readiness = await loadModule<typeof import("../ops-evidence/readiness")>(
      "../ops-evidence/readiness"
    );
    const state = await readiness.readOpsEvidenceReadiness({ projectRoot, auditDbPath });
    expect(state.readiness).toBe("conflict");
  });

  it("SC-11: 缺 lucy_ops_reader 且状态表允许时创建正式 Role，非目标内容语义不变", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = parse(await readFile(accessPath, "utf8")) as {
      roles?: Record<string, unknown>;
      users?: unknown;
      defaults?: unknown;
    };

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const first = await ensureOpsEvidence({ projectRoot, recreateViews: false });
    expect(["inserted", "expanded", "unchanged"]).toContain(first.connectionWrite);
    expect(["current", "reload_required"]).toContain(first.readiness);

    const createdRaw = await readFile(accessPath, "utf8");
    const created = parse(createdRaw) as {
      roles?: Record<string, unknown>;
      users?: unknown;
      defaults?: unknown;
    };
    expect(created.roles?.[OPS_EVIDENCE_ROLE_ID]).toEqual(expandTemplate(OPS_EVIDENCE_ROLE_ID));
    expect(created.users).toEqual(before.users);
    expect(created.defaults).toEqual(before.defaults);
    const { [OPS_EVIDENCE_ROLE_ID]: _createdReader, ...createdOtherRoles } = created.roles ?? {};
    const { [OPS_EVIDENCE_ROLE_ID]: _beforeReader, ...beforeOtherRoles } = before.roles ?? {};
    expect(createdOtherRoles).toEqual(beforeOtherRoles);

    const second = await ensureOpsEvidence({ projectRoot, recreateViews: false });
    expect(["inserted", "expanded", "unchanged"]).toContain(second.connectionWrite);
    expect(["current", "reload_required"]).toContain(second.readiness);
    expect(await readFile(accessPath, "utf8")).toBe(createdRaw);
  });

  it("SC-11: 已有 lucy_ops_reader 时 access.yaml 字节不变", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const doc = parse(ACCESS_YAML) as { roles: Record<string, unknown> };
    doc.roles.lucy_ops_reader = {
      description: "narrow on purpose",
      allow: {
        connections: ["lucy-ops"],
        tableSelectors: [
          {
            connection: "lucy-ops",
            schema: "main",
            names: ["ops_calls"],
            row_access: "all"
          }
        ],
        tools: ["lucy_query"]
      }
    };
    await writeFile(accessPath, stringify(doc), "utf8");
    const before = await readFile(accessPath);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot, recreateViews: false });
    expect(["inserted", "expanded", "unchanged"]).toContain(result.connectionWrite);
    expect(["current", "reload_required"]).toContain(result.readiness);
    expect(await readFile(accessPath)).toEqual(before);
  });

  it("SC-11: conflict 不写 access.yaml", async () => {
    projectRoot = await makeProject(
      `connections:
  lucy-ops:
    driver: mysql
    readonly: true
    path: /tmp/other.sqlite
`
    );
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot, recreateViews: false });
    expect(result.connectionWrite).toBe("conflict");
    expect(result.readiness).toBe("conflict");
    expect(await readFile(accessPath)).toEqual(before);
    const doc = parse((await readFile(accessPath)).toString("utf8")) as { roles?: Record<string, unknown> };
    expect(doc.roles?.[OPS_EVIDENCE_ROLE_ID]).toBeUndefined();
  });

  it("SC-11: not_ready 不写 access.yaml", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    const contentRoot = path.join(projectRoot, "content-src");
    await mkdir(path.join(contentRoot, "semantic-layer"), { recursive: true });
    await writeFile(path.join(contentRoot, "semantic-layer", "note.yaml"), "x: 1\n", "utf8");
    await writeFile(path.join(projectRoot, "semantic-layer"), "not-a-directory\n", "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = contentRoot;
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    const result = await ensureOpsEvidence({ projectRoot, recreateViews: false });
    expect(result.connectionWrite).toBe("unchanged");
    expect(result.readiness).toBe("not_ready");
    expect(await readFile(accessPath)).toEqual(before);
    const doc = parse((await readFile(accessPath)).toString("utf8")) as { roles?: Record<string, unknown> };
    expect(doc.roles?.[OPS_EVIDENCE_ROLE_ID]).toBeUndefined();
  });
});
