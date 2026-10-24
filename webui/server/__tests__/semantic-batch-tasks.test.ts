// Lucy v0.25 — D10: the independent batch validation task.
//
// Coverage:
//  - The fixed budget: 4 parallel checks, 30 s per table, 10 min per task.
//  - A table that times out is `failed`.
//  - A table that should have run but was never scheduled is `not_run`.
//  - Cancelling keeps the results that were already produced.
//  - The count identity `selected = passed + failed + not_run + stale` holds.
//  - The CSV report escapes formula injection.
//  - The report is persisted as JSON + CSV.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSemanticBatchCsv,
  escapeSemanticCsvCell,
  markStaleSemanticResults,
  readSemanticBatchTask,
  runSemanticBatchTask
} from "../semantic-batch-tasks";
import {
  buildFailedResult,
  buildNotRunResult,
  type SemanticTableCheckResult
} from "../semantic-checks";
import type { SemanticTableIdentity } from "../semantic-identity";

let projectRoot: string;

function identity(index: number): SemanticTableIdentity {
  return { connectionId: "shop-db", schema: "public", table: `table_${index}` };
}

function passedResult(target: SemanticTableIdentity): SemanticTableCheckResult {
  return {
    identity: target,
    verdict: "passed",
    severity: "info",
    reasons: [],
    layers: {
      scopeInput: { verdict: "passed", reasons: [] },
      semantics: { verdict: "passed", reasons: [] },
      completeness: {
        hasDescription: false,
        hasGrain: false,
        columnCount: 0,
        describedColumnCount: 0,
        measureCount: 0,
        segmentCount: 0
      },
      executionEvidence: { status: "not_applicable", note: "本期不要求实库执行证据。" }
    },
    durationMs: 1
  };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-batch-"));
});

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D10 batch validation task", () => {
  it("runs every table and keeps the count identity", async () => {
    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_ok",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: [identity(1), identity(2), identity(3)],
      check: async (target) => passedResult(target)
    });

    expect(task.status).toBe("completed");
    expect(task.summary.selected).toBe(3);
    expect(task.summary.passed).toBe(3);
    expect(task.summary.passed + task.summary.failed + task.summary.notRun + task.summary.stale).toBe(
      task.summary.selected
    );
    expect(task.cancelled).toBe(false);
  });

  it("never runs more than 4 checks in parallel", async () => {
    let running = 0;
    let peak = 0;
    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_concurrency",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: Array.from({ length: 9 }, (_, index) => identity(index)),
      check: async (target) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return passedResult(target);
      }
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(task.summary.passed).toBe(9);
  });

  it("marks a timed-out table as failed", async () => {
    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_timeout_table",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: [identity(1)],
      perTableTimeoutMs: 20,
      check: () => new Promise<SemanticTableCheckResult>(() => undefined)
    });

    expect(task.summary.failed).toBe(1);
    expect(task.summary.notRun).toBe(0);
    const reason = task.results[0]?.reasons[0];
    expect(reason?.code).toBe("PER_TABLE_TIMEOUT");
  });

  it("marks a table that was never scheduled as not_run", async () => {
    const startedAt = Date.now();
    let calls = 0;
    // The clock jumps past the task deadline after the first table.
    const now = (): number => {
      calls += 1;
      return calls <= 2 ? startedAt : startedAt + 60_000;
    };

    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_timeout_total",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: [identity(1), identity(2), identity(3)],
      taskTimeoutMs: 1_000,
      now,
      check: async (target) => passedResult(target)
    });

    expect(task.summary.notRun).toBeGreaterThan(0);
    expect(task.status).toBe("failed");
    const notRun = task.results.find((result) => result.verdict === "not_run");
    expect(notRun?.reasons[0]?.code).toBe("TASK_TIMEOUT");
    expect(
      task.summary.passed + task.summary.failed + task.summary.notRun + task.summary.stale
    ).toBe(task.summary.selected);
  });

  it("keeps the results produced before a cancellation", async () => {
    const controller = new AbortController();
    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_cancelled",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: [identity(1), identity(2), identity(3)],
      concurrency: 1,
      signal: controller.signal,
      check: async (target) => {
        controller.abort();
        return passedResult(target);
      }
    });

    expect(task.cancelled).toBe(true);
    expect(task.status).toBe("cancelled");
    expect(task.summary.passed).toBe(1);
    expect(task.summary.notRun).toBe(2);
    const notRun = task.results.find((result) => result.verdict === "not_run");
    expect(notRun?.reasons[0]?.code).toBe("TASK_CANCELLED");
  });

  it("persists the task record and both reports", async () => {
    const task = await runSemanticBatchTask({
      projectRoot,
      taskId: "task_report",
      scopeId: "scope_1",
      actor: "admin-a",
      instanceId: "inst-a",
      baselineDigest: "a".repeat(64),
      identities: [identity(1)],
      check: async (target) => passedResult(target)
    });

    const stored = await readSemanticBatchTask(projectRoot, "task_report");
    expect(stored?.taskId).toBe("task_report");
    expect(task.reportJsonPath).toBeTruthy();
    expect(task.reportCsvPath).toBeTruthy();

    const csv = await readFile(path.join(projectRoot, task.reportCsvPath!), "utf8");
    expect(csv).toContain("connectionId,schema,table,verdict");
    expect(csv).toContain("shop-db");
    const json = JSON.parse(await readFile(path.join(projectRoot, task.reportJsonPath!), "utf8"));
    expect(json.taskId).toBe("task_report");
    expect(json.summary.selected).toBe(1);
  });

  it("marks drifted results as stale", async () => {
    const results = [passedResult(identity(1)), passedResult(identity(2))];
    const stale = markStaleSemanticResults(results, new Set(["shop-db/public/table_2"]));

    expect(stale[0]?.verdict).toBe("passed");
    expect(stale[1]?.verdict).toBe("stale");
    expect(stale[1]?.reasons[0]?.code).toBe("BASELINE_DRIFTED");
  });
});

describe("D10 CSV escaping", () => {
  it("neutralises formula injection", () => {
    expect(escapeSemanticCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeSemanticCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeSemanticCsvCell("-2")).toBe("'-2");
    expect(escapeSemanticCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeSemanticCsvCell('a,b')).toBe('"a,b"');
    expect(escapeSemanticCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeSemanticCsvCell(42)).toBe("42");
    expect(escapeSemanticCsvCell(null)).toBe("");
  });

  it("escapes a reason that tries to become a formula", () => {
    const result = buildFailedResult(identity(1), {
      code: "X",
      message: "=HYPERLINK(\"http://evil\",\"click\")"
    });
    const csv = buildSemanticBatchCsv({
      taskId: "t",
      scopeId: "s",
      actor: "admin-a",
      baselineDigest: "a".repeat(64),
      startedAt: "2026-10-25T00:00:00.000Z",
      finishedAt: "2026-10-25T00:00:01.000Z",
      durationMs: 1000,
      selected: [identity(1)],
      dependencies: [],
      summary: {
        selected: 1,
        passed: 0,
        failed: 1,
        notRun: 0,
        stale: 0,
        dependencies: 0
      },
      results: [result]
    });
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain(",=HYPERLINK");
  });

  it("keeps the not_run builder usable in a report", () => {
    const result = buildNotRunResult(identity(1), { code: "TASK_TIMEOUT", message: "超时" });
    expect(result.verdict).toBe("not_run");
    expect(result.layers.executionEvidence.status).toBe("not_applicable");
  });
});
