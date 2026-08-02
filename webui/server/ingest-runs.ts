import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeWrite } from "./fs-safe";

// Local copy of the IngestRun shape. The shared frontend type lives in
// webui/src/lib/types.ts; mirroring here avoids a server→src cycle just for
// JSON shape. Keep fields in lock-step with that type.
export type IngestScope = "connection" | "schema";

export type IngestRunStatus = "running" | "success" | "failed";

export type IngestRun = {
  id: string;
  connectionId: string;
  schema?: string;
  requestedScope: IngestScope;
  executedScope: IngestScope;
  schemaScopedSupported: boolean;
  status: IngestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command: string[];
  scannedTableCount?: number;
  scannedSchemas?: string[];
  hint?: string;
};

export type IngestRunsFile = {
  version: 1;
  runs: IngestRun[];
};

export type IngestRunsResponse = {
  runs: IngestRun[];
  lastByConnection: Record<string, IngestRun>;
};

const REL_PATH = ".ktx-ui/ingest-runs.json";
const MAX_RUNS = 20;
const MAX_LOG_BYTES = 16 * 1024;

function emptyFile(): IngestRunsFile {
  return { version: 1, runs: [] };
}

function emptyResponse(): IngestRunsResponse {
  return { runs: [], lastByConnection: {} };
}

function normalize(value: unknown): IngestRunsFile {
  if (!value || typeof value !== "object") return emptyFile();
  const record = value as { version?: unknown; runs?: unknown };
  const runs = Array.isArray(record.runs) ? (record.runs as IngestRun[]) : [];
  const cleaned: IngestRun[] = runs
    .filter((item): item is IngestRun => Boolean(item) && typeof item === "object")
    .map((item) => ({ ...item }));
  return { version: 1, runs: cleaned };
}

function clamp(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= MAX_LOG_BYTES) return text;
  return text.slice(0, MAX_LOG_BYTES);
}

const REDACTED = "[REDACTED]";

// Single-token value: `--key=value`, `key=value`, `key: value`.
// Multi-word keys (e.g. "dsn password") are matched by allowing `\s+` between
// the optional "dsn" prefix and the canonical key name.
const SINGLE_TOKEN_VALUE = /((?:--\s*)?\b(?:dsn\s+)?(?:passw(?:or)?d|passwd|pwd|secret|token|api[-_]?key|authorization|credential)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
// Authorization header: redact the entire value (scheme + token) so the
// log doesn't reveal "Authorization: <scheme> was used". For schemes we
// don't recognize, fall through (the SINGLE_TOKEN_VALUE pass catches generic
// "authorization: <token>" form if the key matches).
const AUTH_HEADER = /(\bauthorization\s*[:=]\s*)((?:Bearer|Basic|Token|ApiKey)\s+[^\s,;]+)/gi;
const URL_CREDENTIALS = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/?#]+)@/g;

export function redactIngestLog(text: string): string {
  if (!text) return text;
  let result = text.replace(AUTH_HEADER, (_match, prefix: string) => `${prefix}${REDACTED}`);
  result = result.replace(SINGLE_TOKEN_VALUE, (_match, prefix: string) => `${prefix}${REDACTED}`);
  result = result.replace(
    URL_CREDENTIALS,
    (_match, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`
  );
  return result;
}

function normalizeRun(run: IngestRun): IngestRun {
  const stdout = typeof run.stdout === "string"
    ? clamp(redactIngestLog(run.stdout)) ?? run.stdout
    : run.stdout;
  const stderr = typeof run.stderr === "string"
    ? clamp(redactIngestLog(run.stderr)) ?? run.stderr
    : run.stderr;
  return { ...run, stdout, stderr };
}

function buildLastByConnection(runs: IngestRun[]): Record<string, IngestRun> {
  const out: Record<string, IngestRun> = {};
  // Runs are stored oldest-first; iterate in reverse so the first match per
  // connection (i.e. the most recent finished) wins.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.status === "running") continue;
    if (!out[run.connectionId]) {
      out[run.connectionId] = run;
    }
  }
  return out;
}

function buildResponse(runs: IngestRun[]): IngestRunsResponse {
  return {
    runs,
    lastByConnection: buildLastByConnection(runs)
  };
}

export async function readIngestRuns(projectRoot: string): Promise<IngestRunsResponse> {
  try {
    const text = await readFile(path.join(projectRoot, REL_PATH), "utf8");
    const file = normalize(JSON.parse(text) as unknown);
    return buildResponse(file.runs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyResponse();
    }
    throw error;
  }
}

export async function appendIngestRun(
  projectRoot: string,
  run: IngestRun
): Promise<IngestRunsResponse> {
  const current = await readIngestRuns(projectRoot);
  // Append to the end and drop the oldest entries when the cap is exceeded.
  const next: IngestRun[] = [...current.runs, normalizeRun(run)].slice(-MAX_RUNS);
  const file: IngestRunsFile = { version: 1, runs: next };
  await safeWrite(projectRoot, REL_PATH, `${JSON.stringify(file, null, 2)}\n`);
  return buildResponse(next);
}

export function ingestFailureHint(
  _connectionId: string,
  _schema: string | undefined,
  output: string
): string {
  if (!output) return "ktx ingest 未返回任何日志，请检查 KTX 运行时与连接配置。";
  const lower = output.toLowerCase();
  if (/unknown database|does not exist|doesn't exist/.test(lower)) {
    return "物理库或 schema 名不存在，或当前账号缺少访问权限，请确认 ktx.yaml 中的 schemas 与实际数据库一致。";
  }
  if (/access denied|permission denied|privilege/.test(lower)) {
    return "当前账号可能缺少 SHOW TABLES 或读 schema 的权限，请联系 DBA 授权。";
  }
  if (/connection .* is not configured/.test(lower)) {
    return "当前 WebUI 指向的项目根与连接配置不一致，请确认 KTX_PROJECT_ROOT 指向包含 ktx.yaml 的目录。";
  }
  if (/(no tables|^0 tables|0 table)/.test(lower)) {
    return "该 schema 下没有可见表，或当前权限只能看到 0 张表。";
  }
  return "ktx ingest 返回非 0 退出码，请展开下方 stdout/stderr 查看 ktx 原始日志。";
}
