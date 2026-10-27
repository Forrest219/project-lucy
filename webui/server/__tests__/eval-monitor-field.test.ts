/**
 * Spec 189 / WO-202610-28 T1 — `/api/eval/monitor/field` fixture.
 *
 * The 「现场」panel is a **real-usage observation** surface (Spec 161 §8.4),
 * not raw eval-probe monitoring. Under Spec 189 §6 its calls／errors／denies
 * and rates must all be computed from **Default Usage Calls** — protocol
 * events and default-view-excluded eval probes leave the panel, while the
 * domain-bound Role population, the client-family aggregation, the empty
 * state and the yellow/red trend lines stay untouched.
 *
 * T1 recorded the pre-migration (unfiltered) behaviour as the baseline; T5
 * landed the Default Usage filter and the assertions below are now plain
 * expectations.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit.js";

const ROLE_ID = "role_finance";
const DOMAIN = "finance";
const CLIENT_UA = "python/3.12 fixture-client";

let projectRoot: string;
let prevRoot: string | undefined;
let prevAuditDb: string | undefined;

interface FieldRow {
  ts: string;
  user_id: string;
  tool: string;
  outcome: "ok" | "error" | "denied";
  eval_mark: 0 | 1 | null;
  args_summary: string | null;
}

/**
 * The field fixture: one protocol event, one explicit eval probe, and three
 * real business calls (ok / error / denied) — all bound to the same Role.
 */
function fieldRows(nowIso: string): FieldRow[] {
  const now = Date.parse(nowIso);
  const at = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  return [
    {
      ts: at(1),
      user_id: "field_agent",
      tool: "initialize",
      outcome: "ok",
      eval_mark: null,
      args_summary: null
    },
    {
      ts: at(2),
      user_id: "field_agent",
      tool: "lucy_query",
      outcome: "ok",
      eval_mark: 1,
      args_summary: JSON.stringify({ connection: "probe-demo" })
    },
    {
      ts: at(3),
      user_id: "field_agent",
      tool: "lucy_query",
      outcome: "ok",
      eval_mark: null,
      args_summary: JSON.stringify({ connection: "mysql-aliyun" })
    },
    {
      ts: at(4),
      user_id: "field_agent",
      tool: "lucy_query",
      outcome: "error",
      eval_mark: null,
      args_summary: JSON.stringify({ connection: "mysql-aliyun" })
    },
    {
      ts: at(5),
      user_id: "field_agent",
      tool: "lucy_query",
      outcome: "denied",
      eval_mark: null,
      args_summary: JSON.stringify({ connection: "mysql-aliyun" })
    }
  ];
}

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-eval-field-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(
    path.join(root, ".ktx-ui", "eval", "monitor-config.json"),
    JSON.stringify({ domains: { [DOMAIN]: { roleIds: [ROLE_ID] } } }, null, 2),
    "utf8"
  );
  return root;
}

async function seed(rows: FieldRow[]): Promise<void> {
  const db = await getAuditDb();
  const insert = db.prepare(
    `INSERT INTO access_log
       (ts, user_id, tool, outcome, duration_ms, eval_mark, args_summary, role_ids, user_agent, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  rows.forEach((r, index) => {
    insert.run(
      r.ts,
      r.user_id,
      r.tool,
      r.outcome,
      10,
      r.eval_mark,
      r.args_summary,
      JSON.stringify([ROLE_ID]),
      CLIENT_UA,
      `eval-field-req-${index}`
    );
  });
}

async function fetchField(domain: string) {
  const app = buildServer();
  await app.ready();
  try {
    const res = await request(app.server).get(`/api/eval/monitor/field?domain=${domain}`).expect(200);
    return res.body.data as {
      bound: boolean;
      message?: string;
      rows: Array<{ family: string; calls: number; errorRate: number; denyRate: number }>;
    };
  } finally {
    await app.close();
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T08:00:00.000Z"));
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  await seed(fieldRows("2026-10-27T08:00:00.000Z"));
});

afterEach(async () => {
  resetAuditDbForTests();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("Spec 189 T1 — /api/eval/monitor/field", () => {
  it("keeps the domain-bound Role population and the client-family aggregation", async () => {
    const data = await fetchField(DOMAIN);
    expect(data.bound).toBe(true);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].family).toBe("脚本客户端");
  });

  it("keeps the empty state when the domain has no bound Role", async () => {
    const data = await fetchField("unbound-domain");
    expect(data.bound).toBe(false);
    expect(data.rows).toEqual([]);
  });

  it("counts only Default Usage Calls (SC-08)", async () => {
    const data = await fetchField(DOMAIN);
    // The fixture holds 1 protocol event, 1 explicit eval probe and 3 real
    // business calls. Protocol + probe leave the panel; the 3 business calls
    // stay.
    expect(data.rows[0].calls).toBe(3);
    expect(data.rows[0].errorRate).toBeCloseTo(1 / 3);
    expect(data.rows[0].denyRate).toBeCloseTo(1 / 3);
  });

  it("excludes protocol and eval-probe traffic without dropping the rows from the audit store", async () => {
    // The excluded rows must still be present in the raw audit log — the
    // panel filters its view, it never deletes facts.
    const db = await getAuditDb();
    const total = db.prepare("SELECT COUNT(*) AS n FROM access_log").get() as { n: number };
    expect(total.n).toBe(5);
    const probes = db
      .prepare("SELECT COUNT(*) AS n FROM access_log WHERE eval_mark = 1")
      .get() as { n: number };
    expect(probes.n).toBe(1);

    const data = await fetchField(DOMAIN);
    expect(data.rows[0].calls).toBe(3);
  });

  it("keeps the domain-bound Role population unchanged", async () => {
    // The filter must not widen or narrow which Role's logs are considered.
    const data = await fetchField(DOMAIN);
    expect(data.bound).toBe(true);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].family).toBe("脚本客户端");
  });
});
