/**
 * Spec 189 / WO-202610-28 — the Agent API usage contract on the **real**
 * audit database and the **real** `/api/admin/agents` endpoint (the audit
 * module is not mocked, so every number comes from production code).
 *
 * Coverage:
 *   - the deterministic mixed fixture (protocol-only Agents, eval probes,
 *     skill content reads, historical and unconfigured identities);
 *   - the Default Usage layer on every per-Agent and summary field;
 *   - the layer identities `calls = business + protocol` and
 *     `business = usage + evalProbe`;
 *   - the population boundary (historical log identities vs. current assets);
 *   - the Access Governance Gate input (Raw Business, not Default Usage).
 *
 * The pre-Spec-189 baseline is history: the recorded "before" figures and the
 * migration delta live in the WO-202610-28 landing notes and the CHANGELOG.
 * This file now asserts the **post-migration** figures.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit.js";
import {
  ADMITTED_METHOD_CLASSIFICATION,
  FIXTURE_NOW_ISO,
  PROTOCOL_METHODS,
  SERVER_PREFIXED_METHOD,
  buildFixtureAccessYaml,
  buildFixtureAgents,
  buildFixtureExpectations,
  buildFixtureRows,
  type UsageFixtureExpectation,
  type UsageFixtureRow
} from "./usage-mixed-fixture";

const SPEC_189_PATH = path.resolve(
  process.cwd(),
  "docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md"
);

let projectRoot: string;
let auditDbPath: string;
let prevRoot: string | undefined;
let prevAuditDb: string | undefined;
let prevContentRoot: string | undefined;
let agents: ReturnType<typeof buildFixtureAgents>;
let rows: UsageFixtureRow[];
let expectations: Map<string, UsageFixtureExpectation>;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-usage-baseline-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "ktx.yaml"),
    `connections:
  mysql-aliyun:
    driver: mysql
    enabled_tables:
      - dataforai.superstore_orders
`,
    "utf8"
  );
  await writeFile(path.join(root, "webui", "config", "access.yaml"), buildFixtureAccessYaml(agents), "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
    "utf8"
  );
  return root;
}

async function seedAuditRows(): Promise<void> {
  const db = await getAuditDb();
  const insert = db.prepare(
    `INSERT INTO access_log
       (ts, user_id, token_hash_prefix, token_label, tool, outcome, duration_ms,
        eval_mark, args_summary, role_ids, user_agent, tables, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const seed = db.transaction(() => {
    for (const r of rows) {
      insert.run(
        r.ts,
        r.user_id,
        r.token_hash_prefix,
        r.token_label,
        r.tool,
        r.outcome,
        r.duration_ms,
        r.eval_mark,
        r.args_summary,
        r.role_ids,
        r.user_agent,
        r.tables,
        r.request_id
      );
    }
  });
  seed();
}

async function fetchAgents() {
  const app = buildServer();
  await app.ready();
  try {
    const res = await request(app.server).get("/api/admin/agents").expect(200);
    return res.body.data as {
      agents: Array<{
        id: string;
        stats: {
          callsLast7d: number;
          businessCallsLast7d: number;
          protocolCallsLast7d: number;
          usageCallsLast7d: number;
          evalProbeCallsLast7d: number;
          deniedLast7d: number;
          lastBusinessSeen?: string;
          metricsState: string;
          credentialMetricsState: string;
          usedCredentialsLast7d: number | null;
        };
      }>;
      summary: {
        activeAgentCountLast7d: number | null;
        businessActiveAgentCountLast7d: number | null;
        callsLast7d: number | null;
        businessCallsLast7d: number | null;
        protocolCallsLast7d: number | null;
        usageCallsLast7d: number | null;
        evalProbeCallsLast7d: number | null;
        usageActiveAgentCountLast7d: number | null;
        activeTokenCountLast7d: number | null;
        usedCredentialCountLast7d: number | null;
        usedCredentialState: string;
      };
    };
  } finally {
    await app.close();
  }
}

function statsOf(payload: Awaited<ReturnType<typeof fetchAgents>>, id: string) {
  const found = payload.agents.find((a) => a.id === id);
  if (!found) throw new Error(`agent not returned by API: ${id}`);
  return found.stats;
}

beforeAll(async () => {
  agents = buildFixtureAgents();
  rows = buildFixtureRows(agents);
  expectations = buildFixtureExpectations(rows);
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXTURE_NOW_ISO));
  projectRoot = await makeProject();
  auditDbPath = path.join(projectRoot, ".ktx-ui", "usage-baseline.sqlite");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  await seedAuditRows();
});

afterEach(async () => {
  resetAuditDbForTests();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

afterAll(() => {
  resetAuditDbForTests();
});

describe("Spec 189 T1 — fixture integrity", () => {
  it("is deterministic: rebuilding the fixture yields identical rows", () => {
    const again = buildFixtureRows(buildFixtureAgents());
    expect(again).toEqual(rows);
  });

  it("covers every protocol method plus one server/* unknown method", () => {
    const tools = new Set(rows.map((r) => r.tool));
    for (const method of PROTOCOL_METHODS) {
      expect(tools.has(method), `fixture must cover protocol method ${method}`).toBe(true);
    }
    expect(tools.has(SERVER_PREFIXED_METHOD)).toBe(true);
  });

  it("classifies every admitted JSON-RPC method exactly once", () => {
    expect(ADMITTED_METHOD_CLASSIFICATION).toHaveLength(11);
    const methods = ADMITTED_METHOD_CLASSIFICATION.map((m) => m.method);
    expect(new Set(methods).size).toBe(11);
    // The admission set and the protocol set are different domains: the three
    // admitted business methods must not be classified as protocol.
    expect(ADMITTED_METHOD_CLASSIFICATION.filter((m) => m.classification === "business").map((m) => m.method)).toEqual([
      "tools/call",
      "resources/read",
      "prompts/get"
    ]);
  });

  it("keeps the fixture's admission table in sync with Spec 189 §4.2", async () => {
    const spec = await readFile(SPEC_189_PATH, "utf8");
    // The Spec groups methods into rows (e.g. `resources/read`、`prompts/get`),
    // so match any table line that mentions the method.
    const row = (method: string) =>
      spec.split("\n").find((l) => l.trim().startsWith("|") && l.includes(`\`${method}\``)) ?? "";
    const protocolRow = row("initialize");
    const businessRow = row("tools/call");
    expect(protocolRow, "Spec 189 §4.2 must classify initialize as Protocol").toContain("Protocol");
    expect(businessRow, "Spec 189 §4.2 must classify tools/call as business").toContain("Raw Business");
    for (const method of ["resources/read", "prompts/get"]) {
      expect(row(method), `Spec 189 §4.2 must classify ${method}`).toContain("Raw Business");
    }
  });
});

describe("Spec 189 — T1 baseline reconciled against the T2 migration", () => {
  it("records the current per-Agent call split", async () => {
    const payload = await fetchAgents();
    const configured = new Set(agents.filter((a) => a.configured).map((a) => a.id));
    for (const [id, expected] of expectations) {
      if (!configured.has(id)) continue; // unconfigured identities have no asset stats
      const stats = statsOf(payload, id);
      expect(stats.callsLast7d, `${id} callsLast7d`).toBe(expected.callsLast7d);
      // After T2 the Agent API's `businessCallsLast7d` is the Raw Business
      // Tool Call count (Spec 189 §5.2).
      expect(stats.businessCallsLast7d, `${id} businessCallsLast7d`).toBe(expected.targetRawBusinessCalls);
      expect(stats.protocolCallsLast7d, `${id} protocolCallsLast7d`).toBe(expected.targetProtocolCalls);
    }
  });

  it("no longer inflates protocol-only Agents as business-active", async () => {
    const payload = await fetchAgents();
    const inflated: string[] = [];
    for (const method of [...PROTOCOL_METHODS, SERVER_PREFIXED_METHOD]) {
      const id = `protocol_${method.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      const stats = statsOf(payload, id);
      if (stats.businessCallsLast7d > 0) inflated.push(method);
    }
    // Before Spec 189 seven of these methods were counted as business calls.
    expect(inflated).toEqual([]);
  });

  it("shows the inflation: eval probes are counted as business calls", async () => {
    const payload = await fetchAgents();
    const stats = statsOf(payload, "eval_probe_agent");
    expect(stats.businessCallsLast7d).toBe(2);
    expect(stats.businessCallsLast7d).toBeGreaterThan(0);
  });

  it("keeps skill content reads as business calls (never protocol noise)", async () => {
    const payload = await fetchAgents();
    for (const id of ["resource_read_agent", "prompts_get_agent", "skill_read_agent"]) {
      expect(statsOf(payload, id).businessCallsLast7d, `${id} must stay business`).toBe(1);
    }
  });

  it("keeps a name-only match (no eval_mark) in the business count", async () => {
    const payload = await fetchAgents();
    expect(statsOf(payload, "name_only_agent").businessCallsLast7d).toBe(1);
  });

  it("records the historical Agent as out-of-window and the unconfigured identity as absent from the asset list", async () => {
    const payload = await fetchAgents();
    const historical = statsOf(payload, "historical_agent");
    expect(historical.callsLast7d).toBe(0);
    expect(historical.lastBusinessSeen).toBeTruthy();
    expect(payload.agents.some((a) => a.id === "unconfigured_history_agent")).toBe(false);
  });

  it("keeps the D4 prefix-collision state as partial with a null credential value", async () => {
    const payload = await fetchAgents();
    const stats = statsOf(payload, "collision_agent");
    expect(stats.credentialMetricsState).toBe("partial");
    expect(stats.usedCredentialsLast7d).toBeNull();
    expect(payload.summary.usedCredentialState).toBe("partial");
  });
});

describe("Spec 189 — target behaviour (default usage layer)", () => {
  it("excludes every protocol method from the business call count (SC-01 / SC-02)", async () => {
    const payload = await fetchAgents();
    for (const method of [...PROTOCOL_METHODS, SERVER_PREFIXED_METHOD]) {
      const id = `protocol_${method.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      const stats = statsOf(payload, id);
      expect(stats.usageCallsLast7d, `${method} must not count as business usage`).toBe(0);
      expect(stats.businessCallsLast7d, `${method} must not be a business call`).toBe(0);
      expect(stats.protocolCallsLast7d, `${method} must be a protocol event`).toBe(1);
    }
  });

  it("excludes eval probes from the default usage count (SC-08)", async () => {
    const payload = await fetchAgents();
    const stats = statsOf(payload, "eval_probe_agent");
    // Raw Business keeps the probes; the default usage view drops them.
    expect(stats.businessCallsLast7d).toBe(2);
    expect(stats.evalProbeCallsLast7d).toBe(2);
    expect(stats.usageCallsLast7d).toBe(0);
    // …and an Agent whose traffic is only probes is not business-active.
    const businessActive = payload.agents
      .filter((a) => (a.stats.usageCallsLast7d ?? 0) > 0)
      .map((a) => a.id);
    expect(businessActive).not.toContain("eval_probe_agent");
  });

  it("keeps skill content reads inside the default usage count (SC-10)", async () => {
    const payload = await fetchAgents();
    for (const id of ["resource_read_agent", "prompts_get_agent", "skill_read_agent"]) {
      const stats = statsOf(payload, id);
      expect(stats.usageCallsLast7d, `${id} must stay in default usage`).toBe(1);
      expect(stats.businessCallsLast7d, `${id} must stay business`).toBe(1);
    }
  });

  it("keeps a name-only match inside the default usage count (SC-09)", async () => {
    const payload = await fetchAgents();
    const stats = statsOf(payload, "name_only_agent");
    expect(stats.usageCallsLast7d).toBe(1);
    expect(stats.evalProbeCallsLast7d).toBe(0);
  });

  it("counts business-active Agents on the default usage layer (SC-02)", async () => {
    const payload = await fetchAgents();
    const active = payload.agents
      .filter((a) => (a.stats.usageCallsLast7d ?? 0) > 0)
      .map((a) => a.id);
    expect(payload.summary.usageActiveAgentCountLast7d).toBe(active.length);
    // Every protocol-only Agent and the probe-only Agent must be inactive.
    for (const method of [...PROTOCOL_METHODS, SERVER_PREFIXED_METHOD]) {
      const id = `protocol_${method.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
      expect(active, `${method} Agent must not be business-active`).not.toContain(id);
    }
    expect(active).not.toContain("eval_probe_agent");
    expect(active).toContain("business_agent");
    expect(active).toContain("high_traffic_agent");
  });

  it("feeds the governance gate with Raw Business calls, not Default Usage (SC-10)", async () => {
    const app = buildServer();
    await app.ready();
    try {
      const gateFor = async (userId: string) => {
        const res = await request(app.server)
          .patch(`/api/admin/agents/${userId}`)
          .send({ dryRun: true, patch: { name: "renamed-for-gate-check" } })
          .expect(200);
        return res.body.data.gate as {
          decision: string;
          findings: Array<{ code: string; tier: string }>;
        };
      };

      // Protocol-only Agent → 0 Raw Business calls → not high traffic.
      const protocolGate = await gateFor("protocol_ping");
      expect(
        protocolGate.findings.some((f) => f.code === "HIGH_TRAFFIC_TARGET")
      ).toBe(false);

      // Eval probes stay in Raw Business → still counted, but far below the
      // threshold, so the gate stays quiet.
      const probeGate = await gateFor("eval_probe_agent");
      expect(
        probeGate.findings.some((f) => f.code === "HIGH_TRAFFIC_TARGET")
      ).toBe(false);

      // 51 Raw Business calls ≥ threshold (50) → P1 warn, never a block.
      const hotGate = await gateFor("high_traffic_agent");
      const finding = hotGate.findings.find((f) => f.code === "HIGH_TRAFFIC_TARGET");
      expect(finding, "a high-traffic Agent must raise HIGH_TRAFFIC_TARGET").toBeTruthy();
      expect(finding!.tier).toBe("P1");
      expect(hotGate.decision).toBe("warn");
      expect(hotGate.decision).not.toBe("block");
      expect(hotGate.decision).not.toBe("override_required");
    } finally {
      await app.close();
    }
  });

  it("reports the usage-level identity invariants (SC-11)", async () => {
    const payload = await fetchAgents();
    const summary = payload.summary;
    expect(summary.callsLast7d).toBe(
      (summary.businessCallsLast7d ?? 0) + (summary.protocolCallsLast7d ?? 0)
    );
    expect(summary.businessCallsLast7d).toBe(
      (summary.usageCallsLast7d ?? 0) + (summary.evalProbeCallsLast7d ?? 0)
    );
  });
});
