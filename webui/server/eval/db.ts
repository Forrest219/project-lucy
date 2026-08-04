import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";

let db: Database.Database | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS eval_run (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    domain          TEXT    NOT NULL,
    started_at      TEXT    NOT NULL,
    finished_at     TEXT,
    status          TEXT    NOT NULL,
    triggered_by    TEXT    NOT NULL,
    trigger         TEXT    NOT NULL,
    trigger_reason  TEXT,
    ktx_mcp_url     TEXT    NOT NULL,
    case_selection  TEXT    NOT NULL,
    total_cases     INTEGER NOT NULL DEFAULT 0,
    pass_count      INTEGER NOT NULL DEFAULT 0,
    fail_count      INTEGER NOT NULL DEFAULT 0,
    runner_pid      INTEGER,
    log_path        TEXT,
    json_path       TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_run_case (
    run_id            INTEGER NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
    case_id           TEXT    NOT NULL,
    status            TEXT    NOT NULL,
    drift             TEXT,
    exit_code         INTEGER,
    duration_ms       INTEGER,
    sql               TEXT,
    result_raw        TEXT,
    expected_raw      TEXT,
    actual_raw        TEXT,
    failed_assertions TEXT,
    error_message     TEXT,
    final_text        TEXT,
    tool_calls_raw    TEXT,
    tool_summary_raw  TEXT,
    budget_failures   TEXT,
    trace_id          TEXT,
    artifact_path     TEXT,
    wiki_context_raw  TEXT,
    semantic_queries_raw TEXT,
    lucy_meta_raw     TEXT,
    score_raw         TEXT,
    failure_classification TEXT,
    turn_artifacts_raw TEXT,
    PRIMARY KEY (run_id, case_id)
  );

  CREATE INDEX IF NOT EXISTS idx_run_domain_started ON eval_run(domain, started_at);
  CREATE INDEX IF NOT EXISTS idx_run_case_status    ON eval_run_case(case_id, status);

  CREATE TABLE IF NOT EXISTS security_eval_candidate (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_trace_id TEXT,
    source_access_log_id INTEGER,
    normalized_event TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    decision_reason TEXT NOT NULL,
    tool TEXT,
    user_id TEXT,
    token_hash_prefix TEXT,
    role_ids_json TEXT NOT NULL DEFAULT '[]',
    table_refs_json TEXT NOT NULL DEFAULT '[]',
    risk_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    redaction_status TEXT NOT NULL,
    evidence_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS security_eval_candidate_review (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    reviewer_actor_json TEXT NOT NULL,
    permission_boundary_confirmed INTEGER NOT NULL,
    expected_denial_confirmed INTEGER NOT NULL,
    business_context_confirmed INTEGER NOT NULL,
    decision TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(candidate_id) REFERENCES security_eval_candidate(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sec_candidate_status ON security_eval_candidate(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_sec_candidate_hash ON security_eval_candidate(event_hash);
  CREATE INDEX IF NOT EXISTS idx_sec_review_candidate ON security_eval_candidate_review(candidate_id, created_at);
`;

function ensureEvalRunColumns(instance: Database.Database): void {
  const rows = instance.prepare("PRAGMA table_info(eval_run)").all() as Array<{ name: string }>;
  const columns = new Set(rows.map((row) => row.name));
  const additions: Array<[string, string]> = [
    ["suite_id", "TEXT"],
    ["suite_hash", "TEXT"],
    ["runner_metadata_raw", "TEXT"],
    ["import_source", "TEXT"],
    ["hash_status", "TEXT"]
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) {
      instance.exec(`ALTER TABLE eval_run ADD COLUMN ${name} ${type}`);
    }
  }
}

function ensureEvalRunCaseColumns(instance: Database.Database): void {
  const rows = instance.prepare("PRAGMA table_info(eval_run_case)").all() as Array<{ name: string }>;
  const columns = new Set(rows.map((row) => row.name));
  const additions: Array<[string, string]> = [
    ["tool_calls_raw", "TEXT"],
    ["tool_summary_raw", "TEXT"],
    ["budget_failures", "TEXT"],
    ["trace_id", "TEXT"],
    ["artifact_path", "TEXT"],
    ["wiki_context_raw", "TEXT"],
    ["semantic_queries_raw", "TEXT"],
    ["lucy_meta_raw", "TEXT"],
    ["score_raw", "TEXT"],
    ["failure_classification", "TEXT"],
    ["turn_artifacts_raw", "TEXT"]
  ];
  for (const [name, type] of additions) {
    if (!columns.has(name)) {
      instance.exec(`ALTER TABLE eval_run_case ADD COLUMN ${name} ${type}`);
    }
  }
}

export async function getEvalDb(dbPath?: string): Promise<Database.Database> {
  if (db && !dbPath) return db;
  const projectRoot = await resolveProjectRoot();
  const evalDir = path.join(projectRoot, ".ktx-ui", "eval");
  mkdirSync(evalDir, { recursive: true });
  const resolvedPath = dbPath ?? (process.env.LUCY_EVAL_DB ?? path.join(evalDir, "runs.sqlite"));
  const instance = new Database(resolvedPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.exec(SCHEMA);
  ensureEvalRunColumns(instance);
  ensureEvalRunCaseColumns(instance);
  if (!dbPath) {
    db = instance;
  }
  return instance;
}

export function resetEvalDb(): void {
  db = null;
}

export interface EvalRunRow {
  id: number;
  domain: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  trigger: string;
  trigger_reason: string | null;
  ktx_mcp_url: string;
  case_selection: string;
  total_cases: number;
  pass_count: number;
  fail_count: number;
  runner_pid: number | null;
  log_path: string | null;
  json_path: string | null;
  suite_id: string | null;
  suite_hash: string | null;
  runner_metadata_raw: string | null;
  import_source: string | null;
  hash_status: string | null;
}

export interface EvalRunCaseRow {
  run_id: number;
  case_id: string;
  status: string;
  drift: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  sql: string | null;
  result_raw: string | null;
  expected_raw: string | null;
  actual_raw: string | null;
  failed_assertions: string | null;
  error_message: string | null;
  final_text: string | null;
  tool_calls_raw: string | null;
  tool_summary_raw: string | null;
  budget_failures: string | null;
  trace_id: string | null;
  artifact_path: string | null;
  wiki_context_raw: string | null;
  semantic_queries_raw: string | null;
  lucy_meta_raw: string | null;
  score_raw: string | null;
  failure_classification: string | null;
  turn_artifacts_raw: string | null;
}
