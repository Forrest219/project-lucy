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
    PRIMARY KEY (run_id, case_id)
  );

  CREATE INDEX IF NOT EXISTS idx_run_domain_started ON eval_run(domain, started_at);
  CREATE INDEX IF NOT EXISTS idx_run_case_status    ON eval_run_case(case_id, status);
`;

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
}
