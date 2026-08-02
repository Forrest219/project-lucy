import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { getEvalDb, resetEvalDb } from "../eval/db";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  registerAuditRoutes: vi.fn()
}));

const CASES_YAML = `metadata:
  version: v1.4
  runner_schema_version: v1.3
cases:
  - id: superstore-discount-001
    case_type: single_turn
    question: Weighted discount?
    domain: superstore
    result_assertions:
      - value_type: scalar
        data:
          weighted_discount: 0.1398
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousDb: string | undefined;

async function seedRun(id: number, startedAt: string, passCount: number, failCount: number) {
  const db = await getEvalDb();
  db.prepare(`
    INSERT INTO eval_run (
      id, domain, started_at, finished_at, status, triggered_by, trigger, ktx_mcp_url, case_selection,
      total_cases, pass_count, fail_count, json_path
    )
    VALUES (?, 'superstore', ?, ?, 'succeeded', 'test', 'manual', 'http://localhost:7878/mcp', '{}', 2, ?, ?, ?)
  `).run(id, startedAt, startedAt, passCount, failCount, `.ktx-ui/eval/runs/${id}.json`);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-eval-api-contract-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
  resetEvalDb();

  await mkdir(path.join(projectRoot, "evals", "superstore", "eval"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval", "runs"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "evals", "superstore", "eval", "superstore-eval-cases.yaml"), CASES_YAML, "utf8");
});

afterEach(async () => {
  resetEvalDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("eval API contract gaps", () => {
  it("returns domain lastRun summary", async () => {
    await seedRun(10, "2026-06-19T10:00:00Z", 1, 1);
    const app = buildServer();
    await app.ready();

    const res = await request(app.server).get("/api/eval/domains").expect(200);
    expect(res.body.data.domains[0]).toMatchObject({
      domain: "superstore",
      lastRun: { runId: 10, passRate: 0.5, startedAt: "2026-06-19T10:00:00Z" }
    });

    await app.close();
  });

  it("returns rich run details, artifacts, compare, and drift distribution", async () => {
    const recentPassStartedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentFailStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedRun(11, recentPassStartedAt, 2, 0);
    await seedRun(12, recentFailStartedAt, 1, 1);
    const db = await getEvalDb();
    db.prepare(`
      INSERT INTO eval_run_case (
        run_id, case_id, status, drift, sql, result_raw, expected_raw, actual_raw, failed_assertions, error_message, final_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      11,
      "superstore-discount-001",
      "PASS",
      "pass",
      "SELECT 1",
      JSON.stringify({ weighted_discount: 0.1398 }),
      JSON.stringify([{ data: { weighted_discount: 0.1398 } }]),
      JSON.stringify({ weighted_discount: 0.1398 }),
      null,
      null,
      "ok"
    );
    db.prepare(`
      INSERT INTO eval_run_case (
        run_id, case_id, status, drift, sql, result_raw, expected_raw, actual_raw, failed_assertions, error_message, final_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      12,
      "superstore-discount-001",
      "FAIL",
      "data_drift",
      "SELECT 2",
      JSON.stringify({ weighted_discount: 0.14 }),
      JSON.stringify([{ data: { weighted_discount: 0.1398 } }]),
      JSON.stringify({ weighted_discount: 0.14 }),
      JSON.stringify(["weighted_discount mismatch"]),
      "weighted_discount mismatch",
      "bad"
    );
    await writeFile(path.join(projectRoot, ".ktx-ui", "eval", "runs", "12.json"), "{\"total\":2}", "utf8");
    await writeFile(path.join(projectRoot, ".ktx-ui", "eval", "runs", "12.md"), "# report\n", "utf8");

    const app = buildServer();
    await app.ready();

    const detail = await request(app.server).get("/api/eval/runs/12").expect(200);
    expect(detail.body.data.results[0]).toMatchObject({
      caseId: "superstore-discount-001",
      status: "FAIL",
      drift: "data_drift",
      sql: "SELECT 2",
      expected: [{ data: { weighted_discount: 0.1398 } }],
      actual: { weighted_discount: 0.14 },
      failedAssertions: ["weighted_discount mismatch"],
      errorMessage: "weighted_discount mismatch",
      finalText: "bad"
    });

    const artifact = await request(app.server).get("/api/eval/runs/12/artifact?type=json").expect(200);
    expect(artifact.text).toBe("{\"total\":2}");

    const compare = await request(app.server).get("/api/eval/runs/12/compare?with=11").expect(200);
    expect(compare.body.data.summary.regressed).toBe(1);
    expect(compare.body.data.byCase[0]).toMatchObject({
      caseId: "superstore-discount-001",
      left: "PASS",
      right: "FAIL",
      delta: "regressed"
    });

    const drift = await request(app.server).get("/api/eval/monitor/drift-distribution?domain=superstore&days=30").expect(200);
    expect(drift.body.data.items).toContainEqual({ drift: "data_drift", count: 1 });
    expect(drift.body.data.items).toContainEqual({ drift: "pass", count: 1 });

    await app.close();
  });
});
