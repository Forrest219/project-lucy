import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  registerAuditRoutes: vi.fn(),
  recordConfigChange: vi.fn()
}));

const CANONICAL_SUITE = `lucy_eval_schema_version: 1
kind: lucy_eval_suite
suite_id: kx_financial_v1
domain: kx_financial
title: KX Financial Eval Suite
runner_hints:
  supported_runners:
    - claude_code
cases:
  - id: kx-income-001
    case_type: single_turn
    question: 查询 2024 年营业收入
    expected_source: semantic_layer
    expected_measures:
      - operating_revenue
`;

const LEGACY_SUITE = `metadata:
  document_name: KX Financial Eval Cases
  snapshot_date: "2026-08-01"
  data_source: semantic_layer
cases:
  - id: kx-income-001
    case_type: single_turn
    question: 查询 2024 年营业收入
    domain: kx_financial
    expected_measures:
      - operating_revenue
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousDb: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-eval-suite-import-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
  resetEvalDb();

  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
});

afterEach(async () => {
  resetEvalDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("POST /api/eval/suites/import", () => {
  it("dry-runs canonical Eval YAML and returns suite hash plus diff", async () => {
    const app = buildServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: true, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(200);

    expect(res.body.data).toMatchObject({
      domain: "kx_financial",
      suiteId: "kx_financial_v1",
      caseCount: 1,
      format: "canonical_v1",
      warnings: [],
      errors: []
    });
    expect(res.body.data.suiteHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.body.data.proposedYaml).toContain("suite_hash: sha256:");
    expect(res.body.data.diff).toContain("kx_financial-eval-cases.yaml");

    await expect(
      readFile(path.join(projectRoot, "evals", "kx_financial", "eval", "kx_financial-eval-cases.yaml"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });

    await app.close();
  });

  it("dry-runs legacy Eval YAML as canonical migration preview", async () => {
    const app = buildServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: true, filename: "kx_financial-eval-cases.yaml", content: LEGACY_SUITE })
      .expect(200);

    expect(res.body.data).toMatchObject({
      domain: "kx_financial",
      suiteId: "kx_financial_v1",
      caseCount: 1,
      format: "legacy_migration"
    });
    expect(res.body.data.warnings[0]).toContain("legacy Eval YAML migrated");
    expect(res.body.data.proposedYaml).toContain("lucy_eval_schema_version: 1");
    expect(res.body.data.proposedYaml).not.toContain("domain: kx_financial\n    expected_measures");

    await app.close();
  });

  it("returns localized schema errors for invalid Eval YAML", async () => {
    const app = buildServer();
    await app.ready();

    const invalid = CANONICAL_SUITE.replace("id: kx-income-001", "id: Bad Case");
    const res = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: true, filename: "kx_financial.yaml", content: invalid })
      .expect(422);

    expect(res.body).toMatchObject({
      ok: false,
      error: {
        code: "EVAL_SUITE_SCHEMA_INVALID"
      }
    });
    expect(res.body.error.detail.errors).toContainEqual(
      expect.objectContaining({
        code: "INVALID_SAFE_ID",
        path: "cases[0].id"
      })
    );

    await app.close();
  });

  it("rejects obvious sensitive fields in Eval YAML", async () => {
    const app = buildServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: true, filename: "kx_financial.yaml", content: `${CANONICAL_SUITE}\npassword: secret\n` })
      .expect(422);

    expect(res.body.error.detail.errors).toContainEqual(
      expect.objectContaining({
        code: "SENSITIVE_FIELD_DETECTED",
        path: "content"
      })
    );

    await app.close();
  });

  it("writes canonical Eval YAML only when dryRun is false", async () => {
    const app = buildServer();
    await app.ready();

    const res = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: false, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(201);

    expect(res.body.data).toMatchObject({
      domain: "kx_financial",
      suiteId: "kx_financial_v1",
      written: true
    });

    const written = await readFile(
      path.join(projectRoot, "evals", "kx_financial", "eval", "kx_financial-eval-cases.yaml"),
      "utf8"
    );
    expect(written).toContain("kind: lucy_eval_suite");
    expect(written).toContain("suite_hash: sha256:");
    expect(written).toContain("id: kx-income-001");

    await app.close();
  });

  it("downloads canonical Eval YAML with runner command headers", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: false, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(201);

    const res = await request(app.server)
      .get("/api/eval/suites/kx_financial/download")
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/yaml");
    expect(res.headers["x-lucy-suite-id"]).toBe("kx_financial_v1");
    expect(res.headers["x-lucy-suite-hash"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.headers["x-lucy-runner-command"]).toContain("lucy-eval-runner.mjs");
    expect(res.text).toContain("lucy_eval_schema_version: 1");
    expect(res.text).toContain("suite_hash: sha256:");

    await app.close();
  });

  it("imports matching Result JSON into eval_run and eval_run_case", async () => {
    const app = buildServer();
    await app.ready();
    const suiteImport = await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: false, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(201);

    const resultJson = {
      lucy_eval_result_version: 1,
      suite_id: "kx_financial_v1",
      suite_hash: suiteImport.body.data.suiteHash,
      domain: "kx_financial",
      runner: { kind: "noop", version: "test" },
      started_at: "2026-08-01T10:00:00.000Z",
      finished_at: "2026-08-01T10:01:00.000Z",
      results: [
        {
          case_id: "kx-income-001",
          status: "PASS",
          actual: { operating_revenue: 1 },
          expected: { operating_revenue: 1 },
          final_text: "ok"
        }
      ]
    };

    const res = await request(app.server)
      .post("/api/eval/results/import")
      .send({ dryRun: false, content: JSON.stringify(resultJson) })
      .expect(201);

    expect(res.body.data).toMatchObject({
      domain: "kx_financial",
      suiteId: "kx_financial_v1",
      suiteHashMatched: true,
      hashStatus: "matched",
      passCount: 1,
      failCount: 0,
      written: true
    });
    const db = await getEvalDb();
    const run = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(res.body.data.runId) as Record<string, unknown>;
    expect(run.suite_id).toBe("kx_financial_v1");
    expect(run.hash_status).toBe("matched");
    const row = db.prepare("SELECT * FROM eval_run_case WHERE run_id = ?").get(res.body.data.runId) as Record<string, unknown>;
    expect(row.status).toBe("PASS");

    await app.close();
  });

  it("allows hash mismatch only as confirmed local variant", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: false, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(201);

    const resultJson = {
      lucy_eval_result_version: 1,
      suite_id: "kx_financial_v1",
      suite_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      domain: "kx_financial",
      runner: { kind: "noop" },
      started_at: "2026-08-01T10:00:00.000Z",
      finished_at: "2026-08-01T10:01:00.000Z",
      results: [{ case_id: "kx-income-001", status: "SKIPPED" }]
    };

    const preview = await request(app.server)
      .post("/api/eval/results/import")
      .send({ dryRun: true, content: JSON.stringify(resultJson) })
      .expect(200);
    expect(preview.body.data).toMatchObject({
      hashStatus: "mismatch",
      suiteHashMatched: false,
      skippedCount: 1
    });

    await request(app.server)
      .post("/api/eval/results/import")
      .send({ dryRun: false, content: JSON.stringify(resultJson) })
      .expect(409);

    const imported = await request(app.server)
      .post("/api/eval/results/import")
      .send({ dryRun: false, archiveLocalVariant: true, content: JSON.stringify(resultJson) })
      .expect(201);
    expect(imported.body.data).toMatchObject({
      hashStatus: "mismatch",
      written: true
    });

    await app.close();
  });

  it("rejects obvious sensitive fields in Result JSON", async () => {
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/eval/suites/import")
      .send({ dryRun: false, filename: "kx_financial.yaml", content: CANONICAL_SUITE })
      .expect(201);

    const res = await request(app.server)
      .post("/api/eval/results/import")
      .send({
        dryRun: true,
        content: JSON.stringify({
          lucy_eval_result_version: 1,
          suite_id: "kx_financial_v1",
          suite_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          domain: "kx_financial",
          authorization: "Bearer nope",
          runner: { kind: "noop" },
          started_at: "2026-08-01T10:00:00.000Z",
          finished_at: "2026-08-01T10:01:00.000Z",
          results: [{ case_id: "kx-income-001", status: "SKIPPED" }]
        }, null, 2)
      })
      .expect(422);

    expect(res.body.error.detail.errors).toContainEqual(
      expect.objectContaining({
        code: "SENSITIVE_FIELD_DETECTED",
        path: "content"
      })
    );

    await app.close();
  });
});
