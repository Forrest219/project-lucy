// Lucy v0.25 — D8/D9: the shared legality rules and the verdict model.
//
// Coverage:
//  - One shared implementation decides legality; the same input yields the
//    same verdict regardless of the entry point.
//  - Completeness facts are listed separately and never block.
//  - Real-database execution evidence is `not_applicable` and never becomes
//    a submit verdict (the Spec's "must not block a normal publish" rule).
//  - `selected = passed + failed + not_run + stale` is enforced.
//  - A blocking error, a `not_run` or a `stale` forbids submission; a
//    warning does not.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SemanticVerdictConsistencyError,
  assertVerdictCountsConsistent,
  buildFailedResult,
  buildNotRunResult,
  buildStaleResult,
  computeSemanticCompletenessFacts,
  evaluateSemanticSubmitReadiness,
  runSemanticTableCheck,
  summarizeSemanticVerdicts,
  type SemanticTableCheckResult
} from "../semantic-checks";
import { buildSemanticModelIndex, type SemanticModelIndex } from "../semantic-identity";
import type { ValidationResult } from "../ktx";

let projectRoot: string;
let previousContentRoot: string | undefined;

const IDENTITY = { connectionId: "shop-db", schema: "public", table: "orders" };

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function seedValidProject(): Promise<void> {
  await writeFileAt(
    "ktx.yaml",
    `connections:
  shop-db:
    driver: postgres
    schemas:
      - public
    enabled_tables:
      - public.orders
`
  );
  await writeFileAt(
    "semantic-layer/shop-db/_schema/public.yaml",
    `tables:
  orders:
    table: public.orders
    columns:
      - name: id
        type: number
`
  );
  await writeFileAt(
    "semantic-layer/shop-db/orders.yaml",
    `name: orders
table: public.orders
grain:
  - id
descriptions:
  human: 订单
columns:
  - name: id
    type: number
`
  );
}

function okValidate(): Promise<ValidationResult> {
  return Promise.resolve({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] });
}

function failingValidate(message = "bad column"): Promise<ValidationResult> {
  return Promise.resolve({
    ok: false,
    exitCode: 1,
    stdout: "",
    stderr: message,
    issues: [{ message }]
  });
}

let index: SemanticModelIndex;

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-checks-"));
  await seedValidProject();
  index = await buildSemanticModelIndex(projectRoot);
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D8 shared legality rules", () => {
  it("passes a legal table and keeps completeness separate", async () => {
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: okValidate
    });

    expect(result.verdict).toBe("passed");
    expect(result.reasons).toEqual([]);
    expect(result.layers.semantics.verdict).toBe("passed");
    expect(result.layers.completeness.hasDescription).toBe(true);
    expect(result.layers.completeness.hasGrain).toBe(true);
    expect(result.layers.completeness.measureCount).toBe(0);
  });

  it("fails a table whose column type violates the contract", async () => {
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
columns:
  - name: id
    type: bigint
`
    );
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: okValidate
    });

    expect(result.verdict).toBe("failed");
    expect(result.reasons.some((reason) => reason.code === "COLUMN_TYPE_CONTRACT")).toBe(true);
    expect(result.severity).toBe("blocking");
  });

  it("fails a table whose ktx validate fails", async () => {
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: () => failingValidate("column id has an invalid type")
    });

    expect(result.verdict).toBe("failed");
    const reason = result.reasons.find((entry) => entry.code === "KTX_VALIDATE_FAILED");
    expect(reason?.message).toContain("column id has an invalid type");
  });

  it("fails a table whose Schema Manifest is missing", async () => {
    await rm(path.join(projectRoot, "semantic-layer", "shop-db", "_schema", "public.yaml"));
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: okValidate
    });

    expect(result.verdict).toBe("failed");
    expect(result.reasons.some((reason) => reason.code === "MANIFEST_MISSING")).toBe(true);
  });

  it("fails a table with an unresolvable dependency", async () => {
    await writeFileAt(
      "semantic-layer/shop-db/orders.yaml",
      `name: orders
table: public.orders
joins:
  - to: ghost
    on: orders.id = ghost.id
    relationship: many_to_one
`
    );
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: okValidate
    });

    expect(result.verdict).toBe("failed");
    expect(
      result.reasons.some((reason) => reason.code === "DEPENDENCY_NOT_FOUND")
    ).toBe(true);
  });

  it("checks a candidate overlay instead of the on-disk file", async () => {
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      candidateOverlay: "name: orders\ntable: public.orders\ncolumns:\n  - name: id\n    type: weird\n",
      validateSourceImpl: okValidate
    });
    expect(result.verdict).toBe("failed");
    expect(result.reasons.some((reason) => reason.code === "COLUMN_TYPE_CONTRACT")).toBe(true);
  });

  it("never turns the execution-evidence dimension into a submit verdict", async () => {
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity: IDENTITY,
      validateSourceImpl: okValidate
    });
    expect(result.layers.executionEvidence.status).toBe("not_applicable");
    expect(result.verdict).toBe("passed");
    expect(result.verdict).not.toBe("not_run");
  });
});

describe("D9 verdict model", () => {
  const identity = IDENTITY;

  it("keeps selected = passed + failed + not_run + stale", () => {
    const results: SemanticTableCheckResult[] = [
      { ...buildNotRunResult(identity, { code: "X", message: "x" }) },
      { ...buildFailedResult(identity, { code: "Y", message: "y" }) }
    ];
    const summary = summarizeSemanticVerdicts(results);
    expect(summary.selected).toBe(2);
    expect(summary.passed + summary.failed + summary.notRun + summary.stale).toBe(summary.selected);
  });

  it("rejects an inconsistent summary", () => {
    expect(() =>
      assertVerdictCountsConsistent({
        selected: 3,
        passed: 1,
        failed: 1,
        notRun: 0,
        stale: 0,
        dependencies: 0
      })
    ).toThrowError(SemanticVerdictConsistencyError);
  });

  it("blocks submission on failed / not_run / stale but not on warnings", () => {
    const blocked = evaluateSemanticSubmitReadiness({
      selected: 3,
      passed: 0,
      failed: 1,
      notRun: 1,
      stale: 1,
      dependencies: 0
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockingReasons).toHaveLength(3);

    const allowed = evaluateSemanticSubmitReadiness({
      selected: 1,
      passed: 1,
      failed: 0,
      notRun: 0,
      stale: 0,
      dependencies: 2
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.blockingReasons).toEqual([]);
  });

  it("marks a drifted result as stale", async () => {
    const result = await runSemanticTableCheck({
      projectRoot,
      index,
      identity,
      validateSourceImpl: okValidate
    });
    const stale = buildStaleResult(result, {
      code: "BASELINE_DRIFTED",
      message: "预览后目标已改变。"
    });
    expect(stale.verdict).toBe("stale");
    expect(stale.reasons.some((reason) => reason.code === "BASELINE_DRIFTED")).toBe(true);
  });

  it("computes completeness facts without blocking", () => {
    const facts = computeSemanticCompletenessFacts({
      manifestColumns: [{ name: "id", type: "number" }],
      overlay: {
        grain: ["id"],
        descriptions: { human: "订单" },
        measures: [{ name: "dau", expr: "sum(dau)" }],
        segments: []
      }
    });
    expect(facts.hasGrain).toBe(true);
    expect(facts.hasDescription).toBe(true);
    expect(facts.measureCount).toBe(1);
    expect(facts.segmentCount).toBe(0);
  });
});
