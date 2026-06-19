import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { getEvalDb, type EvalRunRow } from "./db.js";

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

// Active SSE connections per runId
const sseClients = new Map<number, Set<FastifyReply>>();

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

  const insertResult = db.prepare(`
    INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, trigger_reason, ktx_mcp_url, case_selection, total_cases)
    VALUES (?, ?, 'running', ?, 'manual', ?, ?, ?, 0)
  `).run(domain, startedAt, triggeredBy, triggerReason ?? null, ktxMcpUrl, JSON.stringify(caseSelection));

  const runId = insertResult.lastInsertRowid as number;

  const logPath = path.join(evalDir, `${runId}.log`);
  const jsonPath = path.join(evalDir, `${runId}.json`);

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

  child.on("close", async (code) => {
    // Write log
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(logPath, stderrData, "utf8");
    } catch { /* ignore */ }

    // Parse JSON output
    let summary: { total: number; pass: number; fail: number; cases: Array<Record<string, unknown>> } | null = null;
    try {
      summary = JSON.parse(stdoutData);
    } catch { /* ignore */ }

    // Write JSON artifact
    if (stdoutData) {
      try {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(jsonPath, stdoutData, "utf8");
      } catch { /* ignore */ }
    }

    const finishedAt = new Date().toISOString();
    const status = summary !== null ? "succeeded" : "failed";
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
      const insertCase = db2.prepare(`
        INSERT OR REPLACE INTO eval_run_case (run_id, case_id, status, sql, failed_assertions, error_message, final_text, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `);

      const insertMany = db2.transaction((cases: Array<Record<string, unknown>>) => {
        for (const c of cases) {
          const caseStatus = c.pass ? "PASS" : "FAIL";
          const failures = Array.isArray(c.failures) ? c.failures : [];
          insertCase.run(
            runId,
            c.id,
            caseStatus,
            c.sql ?? null,
            failures.length > 0 ? JSON.stringify(failures) : null,
            failures.length > 0 ? failures[0] : null,
            c.finalText ?? null
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
    Querystring: { domain?: string; limit?: string; offset?: string };
  }>("/api/eval/runs", async (request) => {
    const db = await getEvalDb();
    const { domain, limit: limitStr = "20", offset: offsetStr = "0" } = request.query;
    const limit = Math.min(parseInt(limitStr, 10) || 20, 100);
    const offset = parseInt(offsetStr, 10) || 0;

    let rows: EvalRunRow[];
    let total: number;

    if (domain) {
      const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM eval_run WHERE domain = ?").get(domain) as { cnt: number };
      total = countRow.cnt;
      rows = db.prepare("SELECT * FROM eval_run WHERE domain = ? ORDER BY started_at DESC LIMIT ? OFFSET ?").all(domain, limit, offset) as EvalRunRow[];
    } else {
      const countRow = db.prepare("SELECT COUNT(*) AS cnt FROM eval_run").get() as { cnt: number };
      total = countRow.cnt;
      rows = db.prepare("SELECT * FROM eval_run ORDER BY started_at DESC LIMIT ? OFFSET ?").all(limit, offset) as EvalRunRow[];
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
      case_id: string; status: string; sql: string | null; failed_assertions: string | null;
      error_message: string | null; final_text: string | null; duration_ms: number | null;
    }>;

    const results = caseRows.map((c) => ({
      caseId: c.case_id,
      status: c.status as "PASS" | "FAIL",
      sql: c.sql ?? undefined,
      failedAssertions: c.failed_assertions ? JSON.parse(c.failed_assertions) as string[] : undefined,
      errorMessage: c.error_message ?? undefined,
      finalText: c.final_text ?? undefined,
      durationMs: c.duration_ms ?? undefined
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
    }>;

    const cases = caseRows.map((c) => ({
      id: c.case_id,
      passed: c.status === "PASS",
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
    passRate: row.total_cases > 0 ? row.pass_count / row.total_cases : undefined
  };
}
