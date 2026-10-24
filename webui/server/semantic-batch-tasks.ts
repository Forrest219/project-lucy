/**
 * Lucy v0.25 — the independent batch validation task.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §6 (validation and result contract), §10 V11, and §11 D10.
 *
 * ── What this is ───────────────────────────────────────────────────────────
 * A read-only, cancellable, bounded background task that runs the SHARED
 * legality check (see `semantic-checks.ts`) over the tables of a scope and
 * persists a report. It never writes a formal YAML, never changes the
 * enabled range, never touches the index and never changes a publish state.
 *
 * ── The fixed budget (Spec §6, D1) ─────────────────────────────────────────
 *   - 4 parallel checks
 *   - 30 s per table
 *   - 10 min for the whole task
 *   - a table that TIMED OUT is `failed`
 *   - a table that SHOULD have run but was never scheduled (task timeout or
 *     cancellation) is `not_run`
 *   - a table whose result is no longer backed by the baseline is `stale`
 *
 * The count identity `selected = passed + failed + not_run + stale` is
 * enforced by `semantic-checks.ts` and re-checked here before the report is
 * written.
 *
 * ── Cancellation ───────────────────────────────────────────────────────────
 * Cancelling a read-only task does NOT revoke the results it already
 * produced (Spec §6). Only the not-yet-scheduled tables become `not_run`.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits";
import {
  assertVerdictCountsConsistent,
  buildFailedResult,
  buildNotRunResult,
  summarizeSemanticVerdicts,
  type SemanticTableCheckResult,
  type SemanticVerdictSummary
} from "./semantic-checks";
import {
  semanticIdentityKey,
  sortUniqueSemanticIdentities,
  type SemanticTableIdentity
} from "./semantic-identity";

const TASKS_DIR_REL = ".ktx-ui/semantic-batch-tasks";
const REPORTS_DIR_REL = ".ktx-ui/semantic-batch-reports";
const MAX_TASK_RECORDS = 100;

export type SemanticBatchTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface SemanticBatchTask {
  taskId: string;
  scopeId: string;
  actor: string;
  instanceId: string;
  status: SemanticBatchTaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** The baseline digest the results are bound to. */
  baselineDigest: string;
  /** The read-only dependencies of the scope (counted separately). */
  dependencyIdentities: SemanticTableIdentity[];
  results: SemanticTableCheckResult[];
  summary: SemanticVerdictSummary;
  /** Project-root-relative report paths. */
  reportJsonPath?: string;
  reportCsvPath?: string;
  /** Whether the task was cancelled by the operator. */
  cancelled: boolean;
}

export interface SemanticBatchReport {
  taskId: string;
  scopeId: string;
  actor: string;
  baselineDigest: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  selected: SemanticTableIdentity[];
  dependencies: SemanticTableIdentity[];
  summary: SemanticVerdictSummary;
  results: SemanticTableCheckResult[];
}

export type SemanticBatchCheckFn = (
  identity: SemanticTableIdentity
) => Promise<SemanticTableCheckResult>;

export interface RunSemanticBatchTaskInput {
  projectRoot: string;
  taskId: string;
  scopeId: string;
  actor: string;
  instanceId: string;
  baselineDigest: string;
  /** The tables to check (deduplicated + sorted inside). */
  identities: readonly SemanticTableIdentity[];
  /** Read-only dependencies; listed in the report, never checked as targets. */
  dependencyIdentities?: readonly SemanticTableIdentity[];
  /** The shared legality check. */
  check: SemanticBatchCheckFn;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Injectable clock. */
  now?: () => number;
  /** Overrides for the fixed budget (tests only; production uses the limits). */
  concurrency?: number;
  perTableTimeoutMs?: number;
  taskTimeoutMs?: number;
}

function tasksDir(projectRoot: string): string {
  return path.resolve(projectRoot, TASKS_DIR_REL);
}

function reportsDir(projectRoot: string): string {
  return path.resolve(projectRoot, REPORTS_DIR_REL);
}

function taskPath(projectRoot: string, taskId: string): string {
  return path.join(tasksDir(projectRoot), `${taskId}.json`);
}

/** Escape one CSV cell. Formula-injection prefixes are neutralised. */
export function escapeSemanticCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = value;
  // A leading =, +, -, @, TAB or CR makes a spreadsheet treat the cell as a
  // formula. Prefixing a single quote keeps the text literal.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Build the CSV report body. */
export function buildSemanticBatchCsv(report: SemanticBatchReport): string {
  const header = [
    "connectionId",
    "schema",
    "table",
    "verdict",
    "severity",
    "reasonCodes",
    "reasonDetail",
    "scopeInputVerdict",
    "semanticsVerdict",
    "hasDescription",
    "hasGrain",
    "columnCount",
    "describedColumnCount",
    "measureCount",
    "segmentCount",
    "executionEvidence",
    "durationMs"
  ];
  const lines = [header.join(",")];
  for (const result of report.results) {
    const reasonCodes = result.reasons.map((reason) => reason.code).join(" ");
    const reasonDetail = result.reasons.map((reason) => reason.message).join(" | ");
    const cells = [
      result.identity.connectionId,
      result.identity.schema,
      result.identity.table,
      result.verdict,
      result.severity,
      reasonCodes,
      reasonDetail,
      result.layers.scopeInput.verdict,
      result.layers.semantics.verdict,
      result.layers.completeness.hasDescription,
      result.layers.completeness.hasGrain,
      result.layers.completeness.columnCount,
      result.layers.completeness.describedColumnCount,
      result.layers.completeness.measureCount,
      result.layers.completeness.segmentCount,
      result.layers.executionEvidence.status,
      result.durationMs
    ];
    lines.push(cells.map((cell) => escapeSemanticCsvCell(cell as string | number)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function pruneDirectory(dir: string, keep: number): Promise<void> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((file) =>
    file.endsWith(".json")
  );
  const removable = files.slice(0, Math.max(0, files.length - keep));
  for (const file of removable) {
    await rm(path.join(dir, file), { force: true });
  }
}

/** Persist the task record. */
export async function persistSemanticBatchTask(
  projectRoot: string,
  task: SemanticBatchTask
): Promise<void> {
  const dir = tasksDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(taskPath(projectRoot, task.taskId), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  await pruneDirectory(dir, MAX_TASK_RECORDS);
}

/** Read a task record. */
export async function readSemanticBatchTask(
  projectRoot: string,
  taskId: string
): Promise<SemanticBatchTask | null> {
  if (!taskId || taskId.includes("/") || taskId.includes("\\") || taskId.includes("..")) {
    return null;
  }
  try {
    const text = await readFile(taskPath(projectRoot, taskId), "utf8");
    return JSON.parse(text) as SemanticBatchTask;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Run the batch validation task.
 *
 * The concurrency, the per-table timeout and the task timeout are the fixed
 * budget from Spec §6 / D1. Tables that time out are `failed`; tables that
 * never got scheduled are `not_run`.
 */
export async function runSemanticBatchTask(
  input: RunSemanticBatchTaskInput
): Promise<SemanticBatchTask> {
  const now = input.now ?? Date.now;
  const concurrency = Math.max(1, input.concurrency ?? SEMANTIC_BATCH_LIMITS.checkConcurrency);
  const perTableTimeoutMs = input.perTableTimeoutMs ?? SEMANTIC_BATCH_LIMITS.perTableTimeoutMs;
  const taskTimeoutMs = input.taskTimeoutMs ?? SEMANTIC_BATCH_LIMITS.taskTimeoutMs;

  const identities = sortUniqueSemanticIdentities(input.identities);
  const results: Array<SemanticTableCheckResult | undefined> = new Array(identities.length);
  const startedAtMs = now();
  const deadline = startedAtMs + taskTimeoutMs;

  let nextIndex = 0;
  let cancelled = false;
  let taskTimedOut = false;

  const notScheduled = (identity: SemanticTableIdentity): SemanticTableCheckResult =>
    cancelled
      ? buildNotRunResult(identity, {
          code: "TASK_CANCELLED",
          message: "批量校验已被取消，该表未执行必需检查。"
        })
      : buildNotRunResult(identity, {
          code: "TASK_TIMEOUT",
          message: `批量校验超过 ${taskTimeoutMs / 1000} 秒的任务上限，该表未执行必需检查。`
        });

  const runOne = async (identity: SemanticTableIdentity): Promise<SemanticTableCheckResult> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<SemanticTableCheckResult>((resolve) => {
      timer = setTimeout(() => {
        resolve(
          buildFailedResult(identity, {
            code: "PER_TABLE_TIMEOUT",
            message: `单表校验超过 ${perTableTimeoutMs / 1000} 秒上限，记为失败。`
          })
        );
      }, perTableTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([input.check(identity), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      if (input.signal?.aborted) {
        cancelled = true;
        return;
      }
      if (now() >= deadline) {
        taskTimedOut = true;
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      if (index >= identities.length) return;
      const identity = identities[index]!;
      try {
        results[index] = await runOne(identity);
      } catch (error) {
        results[index] = buildFailedResult(identity, {
          code: "CHECK_FAILED",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, identities.length)) }, () => worker())
  );

  // Every table that was not scheduled is `not_run` — it was supposed to run.
  for (let index = 0; index < identities.length; index += 1) {
    if (!results[index]) results[index] = notScheduled(identities[index]!);
  }

  const finalResults = results.filter((result): result is SemanticTableCheckResult =>
    Boolean(result)
  );
  const summary = summarizeSemanticVerdicts(finalResults);
  assertVerdictCountsConsistent(summary);

  const finishedAtMs = now();
  const status: SemanticBatchTaskStatus = cancelled
    ? "cancelled"
    : taskTimedOut
      ? "failed"
      : "completed";

  const report: SemanticBatchReport = {
    taskId: input.taskId,
    scopeId: input.scopeId,
    actor: input.actor,
    baselineDigest: input.baselineDigest,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    selected: identities,
    dependencies: sortUniqueSemanticIdentities(input.dependencyIdentities ?? []),
    summary,
    results: finalResults
  };

  const reportDir = reportsDir(input.projectRoot);
  await mkdir(reportDir, { recursive: true });
  const reportJsonRel = path.posix.join(REPORTS_DIR_REL, `${input.taskId}.json`);
  const reportCsvRel = path.posix.join(REPORTS_DIR_REL, `${input.taskId}.csv`);
  await writeFile(
    path.join(reportDir, `${input.taskId}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(reportDir, `${input.taskId}.csv`), buildSemanticBatchCsv(report), "utf8");

  const task: SemanticBatchTask = {
    taskId: input.taskId,
    scopeId: input.scopeId,
    actor: input.actor,
    instanceId: input.instanceId,
    status,
    createdAt: new Date(startedAtMs).toISOString(),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    baselineDigest: input.baselineDigest,
    dependencyIdentities: report.dependencies,
    results: finalResults,
    summary,
    reportJsonPath: reportJsonRel,
    reportCsvPath: reportCsvRel,
    cancelled
  };

  await persistSemanticBatchTask(input.projectRoot, task);
  return task;
}

/**
 * Mark every result whose baseline moved as `stale`.
 *
 * Spec §9: "if currentDigests != snapshot.digests: markAffectedResultsStale".
 * The caller supplies the set of tables whose target changed; the results of
 * those tables become `stale` and can no longer be submitted.
 */
export function markStaleSemanticResults(
  results: readonly SemanticTableCheckResult[],
  staleIdentities: ReadonlySet<string>
): SemanticTableCheckResult[] {
  return results.map((result) => {
    if (result.verdict === "stale") return result;
    if (!staleIdentities.has(semanticIdentityKey(result.identity))) return result;
    return {
      ...result,
      verdict: "stale" as const,
      reasons: [
        ...result.reasons,
        {
          code: "BASELINE_DRIFTED",
          message: "校验期间目标已改变，该结果已过期，请重新校验。",
          severity: "blocking" as const
        }
      ]
    };
  });
}
