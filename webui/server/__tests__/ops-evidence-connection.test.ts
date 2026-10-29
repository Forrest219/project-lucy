/**
 * Spec 149 §7 / §8 / WO T2 — 运维问数连接块与就绪状态。
 *
 * 覆盖：SC-05、SC-08、SC-11、SC-20。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    const state = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath);
    expect(state.write).toBe("inserted");

    const block = await readOpsEvidenceBlock(projectRoot);
    expect(block?.driver).toBe("sqlite");
    expect(block?.readonly).toBe(true);
    expect(block?.path).toBe(auditDbPath);
    expect(block?.database).toBe(auditDbPath);
    expect(block?.schemas).toEqual(["main"]);
    expect(block?.enabled_tables).toEqual(["ops_calls", "ops_call_tables"]);

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
      const state = await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath);
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

    expect((await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath)).write).toBe("inserted");
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect((await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath)).write).toBe("unchanged");
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
    await ensureOpsEvidenceConnectionBlock(projectRoot, auditDbPath);
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

  it("SC-11: 确保前后 access.yaml 整文件字节不变", async () => {
    projectRoot = await makeProject();
    auditDbPath = path.join(projectRoot, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = auditDbPath;

    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await readFile(accessPath);

    const { ensureOpsEvidence } = await loadModule<typeof import("../ops-evidence/ensure")>(
      "../ops-evidence/ensure"
    );
    await ensureOpsEvidence({ projectRoot });

    expect(await readFile(accessPath)).toEqual(before);
  });
});
