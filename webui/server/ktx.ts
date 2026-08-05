import { execFile, type ExecFileException } from "node:child_process";

export type Issue = {
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  issues?: Issue[];
};

export class KtxCliError extends Error {
  code = "KTX_CLI_ERROR";
  statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = "KtxCliError";
  }
}

type ExecFileImpl = typeof execFile;

function issuesFromOutput(stdout: string, stderr: string): Issue[] {
  return `${stderr}\n${stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((message) => ({ message }));
}

export type ConnectionTestResult = {
  status: "ok" | "error";
  latencyMs?: number;
  detail?: string;
  reason?: string;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type IngestResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function testConnection(
  projectRoot: string,
  connId: string,
  execFileImpl: ExecFileImpl = execFile
): Promise<ConnectionTestResult> {
  const start = Date.now();
  const args = ["connection", "test", connId];
  const command = `ktx ${args.join(" ")}`;
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      args,
      { cwd: projectRoot, timeout: 30_000, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const latencyMs = Date.now() - start;
        const out = stdout.toString();
        const err = stderr.toString();
        if (!error) {
          resolve({
            status: "ok",
            latencyMs,
            detail: out.trim() || undefined,
            command,
            args,
            exitCode: 0,
            stdout: out,
            stderr: err
          });
          return;
        }
        if (error.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : 1;
        resolve({
          status: "error",
          latencyMs,
          reason: (err || out).trim() || "Connection failed",
          command,
          args,
          exitCode,
          stdout: out,
          stderr: err
        });
      }
    );
  });
}

export async function runIngest(
  projectRoot: string,
  connId: string,
  execFileImpl: ExecFileImpl = execFile
): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      ["ingest", connId],
      { cwd: projectRoot, timeout: 120_000, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = stdout.toString();
        const err = stderr.toString();
        if (error?.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }
        const exitCode = !error ? 0 : (typeof error.code === "number" ? error.code : 1);
        resolve({ exitCode, stdout: out, stderr: err });
      }
    );
  });
}

export async function validateSource(
  projectRoot: string,
  conn: string,
  _schema: string,
  table: string,
  execFileImpl: ExecFileImpl = execFile
): Promise<ValidationResult> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      ["sl", "validate", table, "--connection-id", conn],
      { cwd: projectRoot, timeout: 60_000, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = stdout.toString();
        const err = stderr.toString();
        if (!error) {
          resolve({ ok: true, exitCode: 0, stdout: out, stderr: err, issues: [] });
          return;
        }

        if (error.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }

        const exitCode = typeof error.code === "number" ? error.code : 1;
        resolve({
          ok: false,
          exitCode,
          stdout: out,
          stderr: err,
          issues: issuesFromOutput(out, err)
        });
      }
    );
  });
}

// M19: reindexProject shells out to `ktx admin reindex` for the M19 async
// post-publish step. WebUI must NEVER call this without first promoting
// validated YAML to the formal PVC. The MVP uses incremental reindex; pass
// `force: true` only when the API explicitly demands a full rebuild.
export async function reindexProject(
  projectRoot: string,
  options: { force?: boolean; execFileImpl?: ExecFileImpl } = {}
): Promise<IngestResult> {
  const execFileImpl = options.execFileImpl ?? execFile;
  const args = ["admin", "reindex"];
  if (options.force) {
    args.push("--force");
  }
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      args,
      { cwd: projectRoot, timeout: 180_000, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = stdout.toString();
        const err = stderr.toString();
        if (error?.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }
        const exitCode = !error ? 0 : (typeof error.code === "number" ? error.code : 1);
        resolve({ exitCode, stdout: out, stderr: err });
      }
    );
  });
}

export type SqlResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  latencyMs: number;
  command: string;
  args: string[];
  /** Parsed `--json` payload when present; otherwise null. */
  json: unknown | null;
};

function extractJsonPayload(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  // ktx may print daemon startup lines before the JSON object.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export async function runSql(
  projectRoot: string,
  connId: string,
  sql: string,
  options: { maxRows?: number; timeoutMs?: number; execFileImpl?: ExecFileImpl } = {}
): Promise<SqlResult> {
  const execFileImpl = options.execFileImpl ?? execFile;
  const maxRows = options.maxRows ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const args = ["sql", "-c", connId, "--json", "--max-rows", String(maxRows), sql];
  const command = `ktx ${args.join(" ")}`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      args,
      { cwd: projectRoot, timeout: timeoutMs, env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1" } },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const latencyMs = Date.now() - start;
        const out = stdout.toString();
        const err = stderr.toString();
        if (error?.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }
        const exitCode = !error ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({
          ok: !error,
          exitCode,
          stdout: out,
          stderr: err,
          latencyMs,
          command,
          args,
          json: extractJsonPayload(out)
        });
      }
    );
  });
}
