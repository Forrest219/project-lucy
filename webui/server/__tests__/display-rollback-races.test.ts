import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec 174 R7 — fault injection on the real write paths (import confirm,
 * createConnection + rollbackWrittenConnection, Agent and access-config
 * writeAccessYaml runtimeAck=false rollbacks, enabled-tables policy failure,
 * audit failure after a successful write). Real display HTTP requests are sent
 * at write → commit → rollback stages: before the fault resolves they wait
 * (or are busy), afterwards they carry only the final disk state.
 */
const hooks = vi.hoisted(() => ({
  afterWrite: null as null | ((relPath: string) => Promise<void>),
  beforeCommit: null as null | ((call: number) => Promise<void>),
  commitCalls: 0,
  forceNoAck: false,
  failCommit: false,
  connectionAudit: null as null | (() => Promise<void>),
  failValidate: false
}));

vi.mock("../ktx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ktx")>();
  return {
    ...actual,
    validateSource: vi.fn(async () => {
      if (hooks.failValidate) throw new Error("injected: validate after import write");
      return { ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] };
    })
  };
});

vi.mock("../admin/config-audit-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/config-audit-write")>();
  return {
    ...actual,
    auditedWriteFile: vi.fn(async (...args: Parameters<typeof actual.auditedWriteFile>) => {
      const result = await actual.auditedWriteFile(...args);
      if (hooks.afterWrite) await hooks.afterWrite(args[1]);
      return result;
    })
  };
});

vi.mock("../proxy/acl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../proxy/acl")>();
  return {
    ...actual,
    commitEffectivePolicy: vi.fn(async () => {
      hooks.commitCalls += 1;
      if (hooks.beforeCommit) await hooks.beforeCommit(hooks.commitCalls);
      if (hooks.failCommit) throw new Error("injected: policy commit failed");
      return actual.commitEffectivePolicy();
    }),
    evaluateRuntimeAck: vi.fn((...args: Parameters<typeof actual.evaluateRuntimeAck>) => (hooks.forceNoAck ? false : actual.evaluateRuntimeAck(...args)))
  };
});

vi.mock("../admin/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit")>();
  return {
    ...actual,
    recordConfigChange: vi.fn(async (...args: Parameters<typeof actual.recordConfigChange>) => {
      if (hooks.connectionAudit && args[0]?.changeType === "connection_create") await hooks.connectionAudit();
      return actual.recordConfigChange(...args);
    })
  };
});

import { buildServer } from "../index";
import { displayGenerations, hasPendingDisplayWrite, resetDisplayGenerationsForTests } from "../display-generation";
import { resetDisplaySnapshotsForTests, startDisplayReconciler, stopDisplayReconciler } from "../display-snapshot";
import { invalidateContentPathsCache } from "../paths";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { commitEffectivePolicy, resetEffectivePolicyForTests } from "../proxy/acl";
import { resetAdminsCache } from "../auth/admins-store";

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
      - fin.fin_budget
`;
const MANIFEST = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: id
        type: number
      - name: region
        type: string
  fin_budget:
    table: fin.fin_budget
    columns:
      - name: id
        type: number
`;
const ACCESS = `roles:
  ledger_all:
    permission_model_version: 2
    description: Ledger readers
    allow:
      connections: [warehouse]
      tableSelectors:
        - connection: warehouse
          schema: fin
          names: [fin_ledger]
          row_access: all
      tools: [lucy_query, lucy_catalog]
users:
  - id: zhangsan
    name: Zhang San
    enabled: true
    roles: [ledger_all]
    tokens: []
  - id: lisi
    name: Li Si
    enabled: true
    roles: [ledger_all]
    tokens: []
defaults:
  known_tools: [lucy_query, lucy_catalog]
  table_touching_tools: [lucy_query]
`;

let projectRoot: string;
const savedEnv = { ...process.env };
let app: ReturnType<typeof buildServer>;

const accessPath = () => path.join(projectRoot, "webui", "config", "access.yaml");
const manifestPath = () => path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A real display HTTP request whose settlement is observable. */
function displayRequest(url: string) {
  const state = { settled: false };
  const promise = request(app.server).get(url).then((res) => {
    state.settled = true;
    return res;
  });
  return { state, promise };
}

/** Fire display reads now, assert they have not answered while the fault is unresolved. */
async function readsDuringStage(urls: string[]) {
  const reads = urls.map(displayRequest);
  await sleep(60);
  expect(reads.map((read) => read.state.settled)).toEqual(urls.map(() => false));
  expect(hasPendingDisplayWrite()).toBe(true);
  return reads;
}

function agentName(body: { data: { agents: Array<{ id: string; name: string }> } }, id: string) {
  return body.data.agents.find((agent) => agent.id === id)?.name;
}

/** Final answers: success with final disk content, or the retryable busy envelope — never an intermediate version. */
function finalOrBusy(res: request.Response) {
  if (res.status === 503) {
    expect(res.body.error.code).toBe("DISPLAY_SNAPSHOT_BUSY");
    return null;
  }
  expect(res.status).toBe(200);
  return res.body;
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-races-"));
  await mkdir(path.dirname(manifestPath()), { recursive: true });
  await mkdir(path.dirname(accessPath()), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(manifestPath(), MANIFEST, "utf8");
  await writeFile(accessPath(), ACCESS, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_PROXY_UPSTREAM_PORT = "9";
  process.env.LUCY_MCP_RUNTIME_PROBE_TIMEOUT_MS = "50";
  process.env.LUCY_WEBUI_AUTH = "off";
  process.env.LUCY_ADMINS_CONFIG_PATH = path.join(projectRoot, "no-admins.yaml");
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  Object.assign(hooks, { afterWrite: null, beforeCommit: null, commitCalls: 0, forceNoAck: false, failCommit: false, connectionAudit: null, failValidate: false });
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  resetAdminsCache();
  resetDisplayGenerationsForTests();
  resetDisplaySnapshotsForTests();
  await commitEffectivePolicy();
  await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
  app = buildServer();
  await app.ready();
  // Warm both display snapshots so a stale hit would be observable.
  await request(app.server).get("/api/sources").expect(200);
  await request(app.server).get("/api/admin/agents").expect(200);
  hooks.commitCalls = 0;
});

afterEach(async () => {
  Object.assign(hooks, { afterWrite: null, beforeCommit: null, forceNoAck: false, failCommit: false, connectionAudit: null, failValidate: false });
  await app.close();
  stopDisplayReconciler();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  invalidateContentPathsCache();
  invalidateAccessConfigCache();
  resetEffectivePolicyForTests();
  resetAdminsCache();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("Spec 174 R7 — HTTP races on rollback and failed-write paths (SC-04/05/15/16)", () => {
  it("import confirm: reads wait during the write; a failure after the write still serves the written Manifest", async () => {
    let stage: Promise<Array<ReturnType<typeof displayRequest>>> | null = null;
    hooks.afterWrite = async (relPath) => {
      if (!relPath.endsWith("_schema/fin.yaml")) return;
      stage = readsDuringStage(["/api/sources", "/api/admin/agents"]);
      await stage;
    };
    hooks.failValidate = true;
    const imported = `table: fin.fin_ledger\ncolumns:\n  - name: id\n    type: number\n  - name: region\n    type: string\ndescriptions:\n  human: Imported in R7.\n`;
    const res = await request(app.server).post("/api/sources/warehouse/fin/fin_ledger/import").send({ dryRun: false, yaml: imported });
    expect(res.status).toBe(500);
    const reads = await stage!;
    for (const read of reads) {
      const body = finalOrBusy(await read.promise);
      if (body && body.data.tables) expect(body.data.tables.find((t: { table: string }) => t.table === "fin_ledger").hasTableDesc).toBe(true);
    }
    const after = await request(app.server).get("/api/sources").expect(200);
    expect(after.body.data.tables.find((t: { table: string }) => t.table === "fin_ledger").hasTableDesc).toBe(true);
    expect(hasPendingDisplayWrite()).toBe(false);
  });

  it("createConnection: an audit failure after ktx.yaml + secret writes rolls back; reads never see the intermediate connection", async () => {
    const before = displayGenerations();
    let stage: Promise<Array<ReturnType<typeof displayRequest>>> | null = null;
    hooks.connectionAudit = async () => {
      const ktx = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
      expect(ktx).toContain("r7conn");
      stage = readsDuringStage(["/api/sources", "/api/admin/agents"]);
      await stage;
      throw new Error("injected: connection audit failed");
    };
    const res = await request(app.server).post("/api/connections").send({
      id: "r7conn", driver: "mysql", host: "db.invalid", port: 3306, database: "r7", username: "reader", password: "r7-secret", dryRun: false
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const reads = await stage!;
    for (const read of reads) finalOrBusy(await read.promise);
    expect(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).not.toContain("r7conn");
    expect(existsSync(path.join(projectRoot, ".ktx", "secrets", "r7conn-password"))).toBe(false);
    expect(displayGenerations().C).toBeGreaterThan(before.C);
    expect(hasPendingDisplayWrite()).toBe(false);
    const project = await request(app.server).get("/api/project").expect(200);
    expect(project.body.data.connections.map((c: { id: string }) => c.id)).not.toContain("r7conn");
  });

  const accessRollbacks = [
    {
      name: "Agent writeAccessYaml (admin/agents.ts)",
      send: () => request(app.server).patch("/api/admin/agents/lisi").send({ dryRun: false, patch: { name: "Li Si Unacked" } }),
      leaked: "Li Si Unacked"
    },
    {
      name: "access-config writeAccessYaml (roles PATCH)",
      send: () => request(app.server).patch("/api/admin/roles/ledger_all").send({ dryRun: false, patch: { description: "Unacked role text" } }),
      leaked: "Unacked role text"
    }
  ];
  for (const scenario of accessRollbacks) {
    it(`${scenario.name}: runtimeAck=false rollback — reads at write, commit and rollback stages only see the final file`, async () => {
      hooks.forceNoAck = true;
      const stages: Array<Promise<Array<ReturnType<typeof displayRequest>>>> = [];
      hooks.afterWrite = async (relPath) => {
        if (!relPath.endsWith("access.yaml")) return;
        expect(await readFile(accessPath(), "utf8")).toContain(scenario.leaked);
        const stage = readsDuringStage(["/api/sources", "/api/admin/agents"]);
        stages.push(stage);
        await stage;
      };
      hooks.beforeCommit = async (call) => {
        // call 1: unacked new file on disk; call 2: rollback already written.
        if (call === 2) expect(await readFile(accessPath(), "utf8")).not.toContain(scenario.leaked);
        const stage = readsDuringStage(["/api/admin/agents"]);
        stages.push(stage);
        await stage;
      };
      const res = await scenario.send();
      hooks.afterWrite = null;
      hooks.beforeCommit = null;
      expect(res.status).toBeLessThan(500);
      expect(hooks.commitCalls).toBe(2);
      expect(stages).toHaveLength(3);
      for (const stage of stages) {
        for (const read of await stage) {
          const body = finalOrBusy(await read.promise);
          expect(JSON.stringify(body ?? {})).not.toContain(scenario.leaked);
        }
      }
      expect(await readFile(accessPath(), "utf8")).toBe(ACCESS);
      const agents = await request(app.server).get("/api/admin/agents").expect(200);
      expect(agentName(agents.body, "lisi")).toBe("Li Si");
      expect(JSON.stringify(agents.body)).not.toContain(scenario.leaked);
      expect(hasPendingDisplayWrite()).toBe(false);
    });
  }

  it("enabled-tables: a policy commit failure keeps reads waiting through write → reload → commit, then serves the written scope", async () => {
    hooks.failCommit = true;
    let stage: Promise<Array<ReturnType<typeof displayRequest>>> | null = null;
    hooks.beforeCommit = async () => {
      stage = readsDuringStage(["/api/sources", "/api/admin/agents"]);
      await stage;
    };
    const res = await request(app.server).put("/api/connections/warehouse/enabled-tables").send({ dryRun: false, enabledTables: ["fin.fin_ledger"] });
    hooks.beforeCommit = null;
    hooks.failCommit = false;
    expect(res.status).toBe(200);
    expect(res.body.data.runtimeAck).toBe(false);
    for (const read of await stage!) {
      const body = finalOrBusy(await read.promise);
      if (body?.data?.tables) expect(body.data.tables.find((t: { table: string }) => t.table === "fin_budget").enabled).toBe(false);
    }
    const sources = await request(app.server).get("/api/sources").expect(200);
    expect(sources.body.data.tables.find((t: { table: string }) => t.table === "fin_budget").enabled).toBe(false);
    expect(hasPendingDisplayWrite()).toBe(false);
  });

  it("audit failure after a successful semantic save still invalidates (no stale cache)", async () => {
    hooks.afterWrite = async (relPath) => {
      if (relPath.endsWith("fin_ledger.yaml") || relPath.endsWith("_schema/fin.yaml")) throw new Error("injected: audit failed after write");
    };
    const res = await request(app.server).put("/api/sources/warehouse/fin/fin_ledger").send({ dryRun: false, patch: { grain: ["id"] } });
    hooks.afterWrite = null;
    expect(res.status).toBe(500);
    const sources = await request(app.server).get("/api/sources").expect(200);
    expect(sources.body.data.tables.find((t: { table: string }) => t.table === "fin_ledger").hasGrain).toBe(true);
  });
});
