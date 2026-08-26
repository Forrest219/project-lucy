import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { getEvalDb, type EvalRunCaseRow, type EvalRunRow } from "./db.js";
import { listCases, type EvalCase } from "./cases.js";

// ─── types ──────────────────────────────────────────────────────────────────

export type CaseSelection =
  | { mode: "all" }
  | { mode: "ids"; ids: string[] }
  | { mode: "coverage"; coverage: string }
  | { mode: "failed_in_last" };

// ─── errors ─────────────────────────────────────────────────────────────────

export class RunnerBusyError extends Error {
  code = "RUNNER_BUSY";
  statusCode = 409;
  constructor() {
    super("An eval run is already in progress");
    this.name = "RunnerBusyError";
  }
}

export class RunNotFoundError extends Error {
  code = "RUN_NOT_FOUND";
  statusCode = 404;
  constructor(id: string) {
    super(`Run ${id} not found`);
    this.name = "RunNotFoundError";
  }
}

export class RunnerPrecheckFailedError extends Error {
  code = "RUNNER_PRECHECK_FAILED";
  statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "RunnerPrecheckFailedError";
  }
}

export class NoCasesSelectedError extends Error {
  code = "NO_CASES_SELECTED";
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "NoCasesSelectedError";
  }
}

// Active SSE connections per runId
const sseClients = new Map<number, Set<FastifyReply>>();
const activeChildren = new Map<number, ReturnType<typeof spawn>>();
const cancelledRuns = new Set<number>();

function broadcast(runId: number, event: string, data: unknown) {
  const clients = sseClients.get(runId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of clients) {
    try {
      reply.raw.write(payload);
    } catch {
      // ignore disconnected clients
    }
  }
}

type EvalSummaryCase = {
  id?: unknown;
  pass?: unknown;
  failures?: unknown;
  sql?: unknown;
  finalText?: unknown;
  result?: unknown;
  resultRaw?: unknown;
  actual?: unknown;
  expected?: unknown;
  toolCalls?: unknown;
  toolSummary?: unknown;
  budgetFailures?: unknown;
  traceId?: unknown;
  trace?: unknown;
  turns?: unknown;
  semanticQueries?: unknown;
  wikiContextEvidence?: unknown;
  lucyMeta?: unknown;
  score?: unknown;
  failureClassification?: unknown;
  artifactPath?: unknown;
  exitCode?: unknown;
  durationMs?: unknown;
};

type EvalSummary = {
  total: number;
  pass: number;
  fail: number;
  cases: EvalSummaryCase[];
};

function toJsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseJsonText(value: string | null): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function expectedForCase(evalCase: EvalCase | undefined): unknown {
  if (!evalCase) return undefined;
  const legacy = (evalCase as Record<string, unknown>).expected_result;
  return evalCase.result_assertions ?? legacy;
}

function classifyDrift(pass: boolean, failures: string[]): string {
  if (pass) return "pass";
  const joined = failures.join("\n").toLowerCase();
  if (joined.includes("budget:")) return "logic_regression";
  if (joined.includes("cli:") || joined.includes("tool") || joined.includes("timeout")) return "tool_error";
  if (joined.includes("parse:") || joined.includes("schema")) return "schema_drift";
  if (joined.includes("sql") || joined.includes("required") || joined.includes("forbidden") || joined.includes("lineage")) {
    return "logic_regression";
  }
  return "data_drift";
}

function formatSummaryMarkdown(summary: EvalSummary, sourceRelPath: string): string {
  const lines = [
    "# project-lucy eval report",
    "",
    `- cases: ${summary.total}`,
    `- pass: ${summary.pass}`,
    `- fail: ${summary.fail}`,
    `- result: ${summary.total} cases · ${summary.pass} pass · ${summary.fail} fail`,
    `- source: ${sourceRelPath}`,
    ""
  ];
  for (const c of summary.cases) {
    const failures = Array.isArray(c.failures) ? c.failures.map(String) : [];
    lines.push(`## ${String(c.id ?? "")}`);
    lines.push(`- pass: ${c.pass ? "PASS" : "FAIL"}`);
    if (c.traceId) lines.push(`- traceId: ${String(c.traceId)}`);
    if (c.failureClassification) lines.push(`- failureClassification: ${String(c.failureClassification)}`);
    if (c.score) lines.push(`- score: ${JSON.stringify(c.score)}`);
    if (Array.isArray(c.wikiContextEvidence)) lines.push(`- wikiContextEvidence: ${c.wikiContextEvidence.length}`);
    if (c.sql) {
      lines.push("- sql:");
      lines.push("```sql");
      lines.push(String(c.sql).trim());
      lines.push("```");
    } else {
      lines.push("- sql: (none captured)");
    }
    if (failures.length > 0) {
      lines.push("- failures:");
      for (const failure of failures) lines.push(`  - ${failure}`);
    }
    lines.push("- finalTextSnippet:");
    lines.push("```");
    lines.push(String(c.finalText ?? "").slice(0, 200));
    lines.push("```");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function runCliCapture(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function preflightClaude(
  projectRoot: string,
  run: typeof runCliCapture = runCliCapture
): Promise<void> {
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await run("claude", ["auth", "status"], projectRoot);
  } catch (error) {
    throw new RunnerPrecheckFailedError(`claude auth status failed: ${(error as Error).message}`);
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || `exit code ${result.code}`).trim();
    throw new RunnerPrecheckFailedError(`claude auth status failed: ${detail}`);
  }
}

export function mapSummaryCaseToRunCase(
  runId: number,
  summaryCase: EvalSummaryCase,
  evalCase?: EvalCase
): Omit<EvalRunCaseRow, "run_id"> & { run_id: number } {
  const pass = Boolean(summaryCase.pass);
  const failures = Array.isArray(summaryCase.failures) ? summaryCase.failures.map(String) : [];
  const actual = summaryCase.actual ?? summaryCase.result;
  const expected = summaryCase.expected ?? expectedForCase(evalCase);
  return {
    run_id: runId,
    case_id: String(summaryCase.id ?? ""),
    status: pass ? "PASS" : "FAIL",
    drift: classifyDrift(pass, failures),
    exit_code: typeof summaryCase.exitCode === "number" ? summaryCase.exitCode : null,
    duration_ms: typeof summaryCase.durationMs === "number" ? summaryCase.durationMs : null,
    sql: typeof summaryCase.sql === "string" ? summaryCase.sql : null,
    result_raw: toJsonText(summaryCase.resultRaw ?? summaryCase.result),
    expected_raw: toJsonText(expected),
    actual_raw: toJsonText(actual),
    failed_assertions: failures.length > 0 ? JSON.stringify(failures) : null,
    error_message: failures.length > 0 ? failures[0] : null,
    final_text: typeof summaryCase.finalText === "string" ? summaryCase.finalText : null,
    tool_calls_raw: toJsonText(summaryCase.toolCalls),
    tool_summary_raw: toJsonText(summaryCase.toolSummary),
    budget_failures: toJsonText(summaryCase.budgetFailures),
    trace_id: typeof summaryCase.traceId === "string" ? summaryCase.traceId : null,
    artifact_path: typeof summaryCase.artifactPath === "string" ? summaryCase.artifactPath : null,
    wiki_context_raw: toJsonText(summaryCase.wikiContextEvidence),
    semantic_queries_raw: toJsonText(summaryCase.semanticQueries),
    lucy_meta_raw: toJsonText(summaryCase.lucyMeta),
    score_raw: toJsonText(summaryCase.score),
    failure_classification: typeof summaryCase.failureClassification === "string" ? summaryCase.failureClassification : null,
    turn_artifacts_raw: toJsonText(summaryCase.turns)
  };
}

// ─── runner launch ───────────────────────────────────────────────────────────

export async function spawnEvalRun(
  projectRoot: string,
  domain: string,
  caseSelection: CaseSelection,
  ktxMcpUrl: string,
  triggerReason: string | undefined,
  triggeredBy: string
): Promise<number> {
  const db = await getEvalDb();

  // Check for concurrent run
  const running = db.prepare("SELECT id FROM eval_run WHERE status = 'running' OR status = 'queued'").get() as { id: number } | undefined;
  if (running) {
    throw new RunnerBusyError();
  }

  await preflightClaude(projectRoot);

  const startedAt = new Date().toISOString();
  const evalDir = path.join(projectRoot, ".ktx-ui", "eval", "runs");
  mkdirSync(evalDir, { recursive: true });

  // Calculate cases to run
  let caseIds: string[] = [];
  if (caseSelection.mode === "ids") {
    caseIds = caseSelection.ids;
  } else if (caseSelection.mode === "coverage") {
    throw Object.assign(new Error("coverage 模式暂未实现，请使用 all、ids 或 failed_in_last"), {
      code: "UNSUPPORTED_SELECTION_MODE",
      statusCode: 400
    });
  } else if (caseSelection.mode === "failed_in_last") {
    // Get last run for this domain
    const lastRun = db.prepare("SELECT id FROM eval_run WHERE domain = ? AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1").get(domain) as { id: number } | undefined;
    if (lastRun) {
      const failedCases = db.prepare("SELECT case_id FROM eval_run_case WHERE run_id = ? AND status = 'FAIL'").all(lastRun.id) as { case_id: string }[];
      caseIds = failedCases.map((r) => r.case_id);
    }
  }

  const allCases = await listCases(projectRoot, domain);
  if (caseSelection.mode === "failed_in_last" && caseIds.length === 0) {
    throw new NoCasesSelectedError("No failed cases found in the last succeeded run");
  }
  const totalPlanned = caseIds.length > 0 ? caseIds.length : allCases.length;

  const insertResult = db.prepare(`
    INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, trigger_reason, ktx_mcp_url, case_selection, total_cases)
    VALUES (?, ?, 'running', ?, 'manual', ?, ?, ?, 0)
  `).run(domain, startedAt, triggeredBy, triggerReason ?? null, ktxMcpUrl, JSON.stringify(caseSelection));

  const runId = insertResult.lastInsertRowid as number;

  const logPath = path.join(evalDir, `${runId}.log`);
  const jsonPath = path.join(evalDir, `${runId}.json`);
  const mdPath = path.join(evalDir, `${runId}.md`);

  // Build runner args
  const casesPath = `evals/${domain}/eval/${domain}-eval-cases.yaml`;
  const args: string[] = ["scripts/eval-runner.mjs", "--cases", casesPath, "--format", "json"];
  for (const id of caseIds) {
    args.push("--case", id);
  }

  const env = {
    ...process.env,
    EVAL_KTX_MCP_URL: ktxMcpUrl,
    EVAL_MCP_CONFIG: "/tmp/eval-mcp.json"
  };

  const child = spawn("node", args, { cwd: projectRoot, env });
  activeChildren.set(runId, child);

  db.prepare("UPDATE eval_run SET runner_pid = ?, log_path = ?, json_path = ? WHERE id = ?").run(
    child.pid ?? null,
    path.relative(projectRoot, logPath),
    path.relative(projectRoot, jsonPath),
    runId
  );

  let stdoutData = "";
  let stderrData = "";
  let progressCount = 0;

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutData += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrData += text;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      // "# running <case_id>"
      const runningMatch = trimmed.match(/^# running (.+)$/);
      if (runningMatch) {
        progressCount++;
        broadcast(runId, "progress", {
          current: progressCount,
          total: totalPlanned,
          caseId: runningMatch[1]
        });
      }
      // "#   <case_id> → PASS/FAIL"
      const doneMatch = trimmed.match(/^#\s+(.+)\s+→\s+(PASS|FAIL)$/);
      if (doneMatch) {
        broadcast(runId, "case_done", {
          caseId: doneMatch[1].trim(),
          status: doneMatch[2]
        });
      }
    }
  });

  child.on("close", async () => {
    activeChildren.delete(runId);
    // Write log
    try {
      await writeFile(logPath, stderrData, "utf8");
    } catch { /* ignore */ }

    // Parse JSON output
    let summary: EvalSummary | null = null;
    try {
      summary = JSON.parse(stdoutData);
    } catch { /* ignore */ }

    // Write JSON artifact
    if (stdoutData) {
      try {
        await writeFile(jsonPath, stdoutData, "utf8");
      } catch { /* ignore */ }
    }
    if (summary) {
      try {
        await writeFile(mdPath, formatSummaryMarkdown(summary, casesPath), "utf8");
      } catch { /* ignore */ }
    }

    const finishedAt = new Date().toISOString();
    const status = cancelledRuns.has(runId) ? "cancelled" : (summary !== null ? "succeeded" : "failed");
    cancelledRuns.delete(runId);
    const passCount = summary?.pass ?? 0;
    const failCount = summary?.fail ?? 0;
    const totalCases = summary?.total ?? 0;

    const db2 = await getEvalDb();
    db2.prepare(`
      UPDATE eval_run SET status = ?, finished_at = ?, pass_count = ?, fail_count = ?, total_cases = ?
      WHERE id = ?
    `).run(status, finishedAt, passCount, failCount, totalCases, runId);

    // Insert case results
    if (summary?.cases) {
      const casesById = new Map(allCases.map((c) => [c.id, c]));
      const insertCase = db2.prepare(`
        INSERT OR REPLACE INTO eval_run_case (
          run_id, case_id, status, drift, exit_code, duration_ms, sql, result_raw, expected_raw, actual_raw,
          failed_assertions, error_message, final_text, tool_calls_raw, tool_summary_raw, budget_failures,
          trace_id, artifact_path, wiki_context_raw, semantic_queries_raw, lucy_meta_raw, score_raw,
          failure_classification, turn_artifacts_raw
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db2.transaction((cases: EvalSummaryCase[]) => {
        for (const c of cases) {
          const mapped = mapSummaryCaseToRunCase(runId, c, casesById.get(String(c.id ?? "")));
          insertCase.run(
            mapped.run_id,
            mapped.case_id,
            mapped.status,
            mapped.drift,
            mapped.exit_code,
            mapped.duration_ms,
            mapped.sql,
            mapped.result_raw,
            mapped.expected_raw,
            mapped.actual_raw,
            mapped.failed_assertions,
            mapped.error_message,
            mapped.final_text,
            mapped.tool_calls_raw,
            mapped.tool_summary_raw,
            mapped.budget_failures,
            mapped.trace_id,
            mapped.artifact_path,
            mapped.wiki_context_raw,
            mapped.semantic_queries_raw,
            mapped.lucy_meta_raw,
            mapped.score_raw,
            mapped.failure_classification,
            mapped.turn_artifacts_raw
          );
        }
      });
      insertMany(summary.cases);
    }

    broadcast(runId, "finished", { runId, passCount, failCount, totalCases, status });

    // Close all SSE connections for this run
    const clients = sseClients.get(runId);
    if (clients) {
      for (const reply of clients) {
        try { reply.raw.end(); } catch { /* ignore */ }
      }
      sseClients.delete(runId);
    }
  });

  return runId;
}

// ─── route registration ──────────────────────────────────────────────────────

export function registerRunnerRoutes(app: FastifyInstance) {
  // GET /api/eval/runs/summary — Spec 128 Task 4: bounded 30-day KPI
  // Returns MetricResult-style summary counting only status='succeeded' runs.
  // MUST be registered before GET /api/eval/runs/:runId to avoid path collision.
  app.get<{
    Querystring: { days?: string; domain?: string };
  }>("/api/eval/runs/summary", async (request) => {
    const days = Math.min(Math.max(parseInt(request.query.days ?? "30", 10) || 30, 1), 365);
    const { domain } = request.query;

    const nowMs = Date.now();
    const windowStart = new Date(nowMs - days * 86_400_000).toISOString();
    const windowEnd = new Date(nowMs).toISOString();
    const asOf = windowEnd;

    try {
      const db = await getEvalDb();
      const params: unknown[] = [windowStart, windowEnd];
      const domainClause = domain ? " AND domain = ?" : "";
      if (domain) params.push(domain);

      const row = db.prepare(`
        SELECT COUNT(*) AS run_count, MAX(started_at) AS latest_succeeded_at
        FROM eval_run
        WHERE status = 'succeeded'
          AND started_at >= ? AND started_at < ?${domainClause}
      `).get(...params) as { run_count: number; latest_succeeded_at: string | null } | undefined;

      const runCount = row?.run_count ?? 0;
      return {
        ok: true,
        data: {
          runCount: {
            metricId: "eval-runs-30d",
            state: runCount === 0 ? "no_data" : "ok",
            value: runCount,
            asOf,
            windowStart,
            windowEnd
          },
          latestSucceededRunAt: row?.latest_succeeded_at ?? null
        }
      };
    } catch (err) {
      return {
        ok: true,
        data: {
          runCount: {
            metricId: "eval-runs-30d",
            state: "unavailable",
            value: null,
            asOf,
            windowStart,
            windowEnd,
            unavailableReason: err instanceof Error ? err.message : "db_error"
          },
          latestSucceededRunAt: null
        }
      };
    }
  });

  // POST /api/eval/runs
  app.post<{
    Body: {
      domain: string;
      caseSelection?: CaseSelection;
      ktxMcpUrl?: string;
      triggerReason?: string;
    };
  }>("/api/eval/runs", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { domain, caseSelection = { mode: "all" }, ktxMcpUrl = "http://localhost:7878/mcp", triggerReason } = request.body;
    const triggeredBy = "webui";

    const runId = await spawnEvalRun(projectRoot, domain, caseSelection, ktxMcpUrl, triggerReason, triggeredBy);
    return reply.status(202).send({ ok: true, data: { runId, status: "running" } });
  });

  // GET /api/eval/runs
  app.get<{
    Querystring: { domain?: string; limit?: string; offset?: string; status?: string };
  }>("/api/eval/runs", async (request) => {
    const db = await getEvalDb();
    // Spec 128 D2/Task 5: status filter allows callers to request only succeeded runs.
    const { domain, limit: limitStr = "20", offset: offsetStr = "0", status } = request.query;
    const limit = Math.min(parseInt(limitStr, 10) || 20, 100);
    const offset = parseInt(offsetStr, 10) || 0;

    const statusClause = status ? " AND status = ?" : "";
    const statusParams = status ? [status] : [];

    let rows: EvalRunRow[];
    let total: number;

    if (domain) {
      const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM eval_run WHERE domain = ?${statusClause}`).get(domain, ...statusParams) as { cnt: number };
      total = countRow.cnt;
      rows = db.prepare(`SELECT * FROM eval_run WHERE domain = ?${statusClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(domain, ...statusParams, limit, offset) as EvalRunRow[];
    } else {
      const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM eval_run WHERE 1=1${statusClause}`).get(...statusParams) as { cnt: number };
      total = countRow.cnt;
      rows = db.prepare(`SELECT * FROM eval_run WHERE 1=1${statusClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...statusParams, limit, offset) as EvalRunRow[];
    }

    const runs = rows.map(rowToRun);
    return { ok: true, data: { total, runs } };
  });

  // GET /api/eval/runs/:runId
  app.get<{ Params: { runId: string } }>("/api/eval/runs/:runId", async (request) => {
    const db = await getEvalDb();
    const runId = parseInt(request.params.runId, 10);
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow | undefined;
    if (!row) throw new RunNotFoundError(request.params.runId);

    const caseRows = db.prepare("SELECT * FROM eval_run_case WHERE run_id = ?").all(runId) as Array<{
      case_id: string; status: string; drift: string | null; exit_code: number | null; duration_ms: number | null;
      sql: string | null; result_raw: string | null; expected_raw: string | null; actual_raw: string | null;
      failed_assertions: string | null; error_message: string | null; final_text: string | null;
      tool_calls_raw: string | null; tool_summary_raw: string | null; budget_failures: string | null;
      trace_id: string | null; artifact_path: string | null; wiki_context_raw: string | null; semantic_queries_raw: string | null;
      lucy_meta_raw: string | null; score_raw: string | null; failure_classification: string | null; turn_artifacts_raw: string | null;
    }>;

    const results = caseRows.map((c) => ({
      caseId: c.case_id,
      status: c.status as "PASS" | "FAIL",
      drift: c.drift ?? undefined,
      exitCode: c.exit_code ?? undefined,
      durationMs: c.duration_ms ?? undefined,
      sql: c.sql ?? undefined,
      resultRaw: parseJsonText(c.result_raw),
      expected: parseJsonText(c.expected_raw),
      actual: parseJsonText(c.actual_raw),
      failedAssertions: c.failed_assertions ? JSON.parse(c.failed_assertions) as string[] : undefined,
      errorMessage: c.error_message ?? undefined,
      finalText: c.final_text ?? undefined,
      toolCalls: parseJsonText(c.tool_calls_raw),
      toolSummary: parseJsonText(c.tool_summary_raw),
      budgetFailures: parseJsonText(c.budget_failures),
      traceId: c.trace_id ?? undefined,
      artifactPath: c.artifact_path ?? undefined,
      wikiContextEvidence: parseJsonText(c.wiki_context_raw),
      semanticQueries: parseJsonText(c.semantic_queries_raw),
      lucyMeta: parseJsonText(c.lucy_meta_raw),
      score: parseJsonText(c.score_raw),
      failureClassification: c.failure_classification ?? undefined,
      turns: parseJsonText(c.turn_artifacts_raw)
    }));

    return { ok: true, data: { ...rowToRun(row), results } };
  });

  // GET /api/eval/runs/:runId/results
  app.get<{ Params: { runId: string } }>("/api/eval/runs/:runId/results", async (request) => {
    const db = await getEvalDb();
    const runId = parseInt(request.params.runId, 10);
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow | undefined;
    if (!row) throw new RunNotFoundError(request.params.runId);

    const caseRows = db.prepare("SELECT * FROM eval_run_case WHERE run_id = ?").all(runId) as Array<{
      case_id: string; status: string; sql: string | null; failed_assertions: string | null;
      error_message: string | null; final_text: string | null; duration_ms: number | null;
      trace_id: string | null; failure_classification: string | null; score_raw: string | null;
    }>;

    const cases = caseRows.map((c) => ({
      id: c.case_id,
      passed: c.status === "PASS",
      traceId: c.trace_id ?? undefined,
      failureClassification: c.failure_classification ?? undefined,
      score: parseJsonText(c.score_raw),
      failedAssertions: c.failed_assertions ? JSON.parse(c.failed_assertions) as string[] : undefined,
      errorMessage: c.error_message ?? undefined,
      durationMs: c.duration_ms ?? undefined
    }));

    const passed = caseRows.filter((c) => c.status === "PASS").length;
    const failed = caseRows.filter((c) => c.status === "FAIL").length;
    const total = caseRows.length;

    return {
      ok: true,
      data: {
        runId,
        passed,
        failed,
        total,
        passRate: total > 0 ? passed / total : 0,
        cases
      }
    };
  });

  // GET /api/eval/runs/:runId/artifact?type=json|md
  app.get<{
    Params: { runId: string };
    Querystring: { type?: string };
  }>("/api/eval/runs/:runId/artifact", async (request, reply) => {
    const db = await getEvalDb();
    const projectRoot = await resolveProjectRoot();
    const runId = parseInt(request.params.runId, 10);
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow | undefined;
    if (!row) throw new RunNotFoundError(request.params.runId);

    const type = request.query.type === "md" ? "md" : "json";
    const jsonRelPath = row.json_path;
    if (!jsonRelPath) throw new RunNotFoundError(request.params.runId);
    const relPath = type === "json" ? jsonRelPath : jsonRelPath.replace(/\.json$/, ".md");
    try {
      const text = await readFile(path.join(projectRoot, relPath), "utf8");
      reply
        .header("Content-Type", type === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="eval-run-${runId}.${type}"`);
      return reply.send(text);
    } catch {
      throw new RunNotFoundError(`${request.params.runId} artifact ${type}`);
    }
  });

  // GET /api/eval/runs/:runId/compare?with=<otherRunId>
  app.get<{
    Params: { runId: string };
    Querystring: { with?: string };
  }>("/api/eval/runs/:runId/compare", async (request) => {
    const db = await getEvalDb();
    const rightId = parseInt(request.params.runId, 10);
    const leftId = parseInt(request.query.with ?? "", 10);
    if (!Number.isFinite(leftId)) throw new RunNotFoundError(request.query.with ?? "");

    const left = db.prepare("SELECT id FROM eval_run WHERE id = ?").get(leftId) as { id: number } | undefined;
    const right = db.prepare("SELECT id FROM eval_run WHERE id = ?").get(rightId) as { id: number } | undefined;
    if (!left) throw new RunNotFoundError(String(leftId));
    if (!right) throw new RunNotFoundError(String(rightId));

    const rows = db.prepare(`
      SELECT case_id, run_id, status
      FROM eval_run_case
      WHERE run_id IN (?, ?)
    `).all(leftId, rightId) as Array<{ case_id: string; run_id: number; status: "PASS" | "FAIL" }>;

    const byCase = new Map<string, { left?: "PASS" | "FAIL"; right?: "PASS" | "FAIL" }>();
    for (const row of rows) {
      const existing = byCase.get(row.case_id) ?? {};
      if (row.run_id === leftId) existing.left = row.status;
      if (row.run_id === rightId) existing.right = row.status;
      byCase.set(row.case_id, existing);
    }

    let regressed = 0;
    let fixed = 0;
    let unchanged = 0;
    const items = [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([caseId, value]) => {
      let delta: "regressed" | "fixed" | "unchanged" | "added" | "removed" = "unchanged";
      if (value.left === "PASS" && value.right === "FAIL") delta = "regressed";
      else if (value.left === "FAIL" && value.right === "PASS") delta = "fixed";
      else if (!value.left) delta = "added";
      else if (!value.right) delta = "removed";
      if (delta === "regressed") regressed++;
      else if (delta === "fixed") fixed++;
      else unchanged++;
      return { caseId, left: value.left, right: value.right, delta };
    });

    return {
      ok: true,
      data: {
        left: { runId: leftId },
        right: { runId: rightId },
        byCase: items,
        summary: { regressed, fixed, unchanged }
      }
    };
  });

  // POST /api/eval/runs/:runId/cancel
  app.post<{ Params: { runId: string } }>("/api/eval/runs/:runId/cancel", async (request) => {
    const db = await getEvalDb();
    const runId = parseInt(request.params.runId, 10);
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow | undefined;
    if (!row) throw new RunNotFoundError(request.params.runId);
    const child = activeChildren.get(runId);
    if (child) {
      cancelledRuns.add(runId);
      child.kill("SIGTERM");
    } else if (row.status === "running" || row.status === "queued") {
      db.prepare("UPDATE eval_run SET status = 'cancelled', finished_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    }
    return { ok: true, data: { cancelled: true } };
  });

  // GET /api/eval/runs/:runId/stream  (SSE)
  app.get<{ Params: { runId: string } }>("/api/eval/runs/:runId/stream", async (request, reply) => {
    const db = await getEvalDb();
    const runId = parseInt(request.params.runId, 10);
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow | undefined;
    if (!row) throw new RunNotFoundError(request.params.runId);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    // If already done, send finished event and close
    if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
      reply.raw.write(`event: finished\ndata: ${JSON.stringify({ runId, status: row.status })}\n\n`);
      reply.raw.end();
      return reply;
    }

    // Register this client
    if (!sseClients.has(runId)) {
      sseClients.set(runId, new Set());
    }
    sseClients.get(runId)!.add(reply);

    // Send keepalive every 15s
    const keepalive = setInterval(() => {
      try {
        reply.raw.write(": keepalive\n\n");
      } catch {
        clearInterval(keepalive);
      }
    }, 15_000);

    reply.raw.on("close", () => {
      sseClients.get(runId)?.delete(reply);
      clearInterval(keepalive);
    });

    return reply;
  });
}

function rowToRun(row: EvalRunRow) {
  const runnerMetadata = parseJsonText(row.runner_metadata_raw);
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    triggeredBy: row.triggered_by,
    trigger: row.trigger,
    triggerReason: row.trigger_reason ?? undefined,
    ktxMcpUrl: row.ktx_mcp_url,
    caseSelection: JSON.parse(row.case_selection) as CaseSelection,
    totalCases: row.total_cases,
    passCount: row.pass_count,
    failCount: row.fail_count,
    passRate: row.total_cases > 0 ? row.pass_count / row.total_cases : undefined,
    suiteId: row.suite_id ?? undefined,
    suiteHash: row.suite_hash ?? undefined,
    runnerMetadata,
    importSource: row.import_source ?? undefined,
    hashStatus: row.hash_status ?? undefined
  };
}
