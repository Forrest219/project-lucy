import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEvalDb, resetEvalDb } from "../eval/db";
import { importEvalResult } from "../eval/suite-import";
import { computeSuiteHash, parseEvalResultImport } from "../eval/suite-schema";

const suiteYaml = `lucy_eval_schema_version: 1
kind: lucy_eval_suite
suite_id: sales_v1
domain: sales
title: 销售
cases:
  - id: spend-by-platform
    case_type: single_turn
    question: 各平台花费
    expected_source: semantic_layer
  - id: spend-wrong
    case_type: single_turn
    question: 花费对不上
    expected_source: semantic_layer
  - id: spend-silent
    case_type: single_turn
    question: 花费没出来
    expected_source: semantic_layer
`;

function result(overrides: Record<string, unknown> = {}) {
  return {
    lucy_eval_result_version: 2,
    complete: true,
    role_id: "analyst",
    as_of: "2026-10-11",
    suite_id: "sales_v1",
    suite_hash: "sha256:" + "a".repeat(64),
    domain: "sales",
    runner: { kind: "lucy_offline_batch", version: "2", model: "" },
    started_at: "2026-10-11T00:00:00.000Z",
    finished_at: "2026-10-11T00:01:00.000Z",
    results: [
      { case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" }
    ],
    ...overrides
  };
}

let projectRoot = "";
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousDb: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-eval-result-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_EVAL_DB = path.join(projectRoot, "runs.sqlite");
  resetEvalDb();
  await mkdir(path.join(projectRoot, "evals/sales/eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "evals/sales/eval/sales-eval-cases.yaml"), suiteYaml, "utf8");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
});

afterEach(async () => {
  resetEvalDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("v2 result import", () => {
  it("rejects an incomplete file, a named model, or the wrong runner before writing a run", async () => {
    const samples = [
      result({ complete: false }),
      result({ runner: { kind: "lucy_offline_batch", version: "2", model: "claude" } }),
      result({ runner: { kind: "hermes", version: "2", model: "" } })
    ];
    for (const sample of samples) {
      expect(parseEvalResultImport(JSON.stringify(sample)).ok).toBe(false);
      await expect(importEvalResult(projectRoot, { content: JSON.stringify(sample), dryRun: false })).rejects.toThrow();
    }
    const db = await getEvalDb();
    const row = db.prepare("SELECT COUNT(*) AS n FROM eval_run").get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("stores the new pass rate without counting not answered", async () => {
    const { readCurrentEvalSuite } = await import("../eval/suite-import");
    const current = await readCurrentEvalSuite(projectRoot, "sales");
    const body = result({
      suite_hash: current.suite_hash ?? computeSuiteHash(current),
      results: [
        { case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" },
        { case_id: "spend-wrong", status: "FAIL", outcome: "answered_wrong", failures: ["reconciliation_mismatch"] },
        { case_id: "spend-silent", status: "ERROR", outcome: "not_answered", reason: "measure_unbound", error_message: "measure_unbound" }
      ]
    });
    const parsed = parseEvalResultImport(JSON.stringify(body));
    if (!parsed.ok) throw new Error(parsed.errors.map((item) => `${item.path}: ${item.message}`).join(" | "));
    const imported = await importEvalResult(projectRoot, { content: JSON.stringify(body), dryRun: false });
    expect(imported.passCount).toBe(1);
    expect(imported.failCount).toBe(1);
    expect(imported.totalCases).toBe(2);
    expect(imported.notAnsweredCount).toBe(1);
    const db = await getEvalDb();
    const row = db.prepare("SELECT pass_count, fail_count, total_cases, not_answered_count FROM eval_run").get() as {
      pass_count: number;
      fail_count: number;
      total_cases: number;
      not_answered_count: number;
    };
    expect(row.total_cases).toBe(2);
    expect(row.not_answered_count).toBe(1);
    expect(row.pass_count / row.total_cases).toBe(0.5);
  });
});
