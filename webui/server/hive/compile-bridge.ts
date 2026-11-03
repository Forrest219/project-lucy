/**
 * Hive compile bridge — a thin, fail-closed call into the unmodified KTX
 * `ktx-daemon semantic-query` subcommand.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.2, §4.4
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H4)
 *
 * Design decisions that are load-bearing:
 *
 * - **Self-written thin subprocess call, not KTX's private bridge.** KTX ships
 *   `dist/context/daemon/semantic-layer-compute.js`, which lives in a private
 *   npm subpath. The implementation boundary for P1-4 forbids importing npm
 *   private subpaths, so the bridge is written here. The KTX bridge also has
 *   no deadline, no output byte cap, no environment isolation and no stderr
 *   redaction — all four are required by Spec §4.2 and all four are
 *   implemented here.
 *
 * - **The request never touches argv.** `semantic-query` is the only
 *   argument; the payload travels over stdin and the response comes back
 *   over stdout. Nothing that belongs in a request can leak into a process
 *   listing.
 *
 * - **The compile process never holds database credentials.** The request
 *   model forbids extra fields, and this bridge additionally refuses to send
 *   a payload that contains a connection id or a credential field at all
 *   (Spec §4.2, H-D6).
 *
 * - **Exit codes are classified, not flattened.** The unmodified daemon
 *   returns `3` when the compute layer refuses a well-formed request as
 *   invalid, and `1` (or a signal) when the process itself fails. Callers
 *   must be able to tell those apart, so the two outcomes are different
 *   kinds, never the same "error".
 *
 * - **Compilation is not execution.** The response `plan` is the *semantic*
 *   plan, not an HS2 physical execution plan. A successful compile says
 *   nothing about whether HiveServer2 can run the statement — for example
 *   `DATE_TRUNC('MONTH', ts)` compiles cleanly but its executability on a
 *   given HS2 is only proven by a real EXPLAIN (Spec V04, still
 *   `blocked_environment`).
 */

import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The unmodified daemon's "input rejected" exit code (`INPUT_REJECTED_EXIT_CODE`). */
export const DAEMON_INPUT_REJECTED_EXIT_CODE = 3;

/** The only dialect this bridge compiles for. */
export const HIVE_COMPILE_DIALECT = "hive";

export const DEFAULT_COMPILE_DEADLINE_MS = 20_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/**
 * How long the bridge waits for a killed child to report its terminal state
 * (`close`) before it gives up waiting.
 *
 * A kill request is not an observation: the process is only gone once it has
 * reported `close`. Without this grace period a child that never reports
 * `close` would hang the request forever.
 */
export const DEFAULT_CLOSE_GRACE_MS = 5_000;
const MAX_DIAGNOSTIC_CHARS = 500;

// ── request contract ─────────────────────────────────────────────────────────

/** Top-level keys the compute request may carry. */
const ENVELOPE_KEYS = new Set(["sources", "query", "dialect"]);

/** Keys the compute query may carry (the `SemanticQuery` contract). */
const QUERY_KEYS = new Set([
  "measures",
  "dimensions",
  "filters",
  "segments",
  "order_by",
  "limit",
  "include_empty",
  "predefined_measures_only"
]);

/** Keys a resolved source may carry (the `SourceDefinition` contract). */
const SOURCE_KEYS = new Set([
  "name",
  "description",
  "descriptions",
  "table",
  "sql",
  "grain",
  "columns",
  "joins",
  "measures",
  "segments",
  "default_time_dimension",
  "tags",
  "freshness"
]);

/**
 * Field names that would carry a connection identity or a credential.
 *
 * The schema allowlists above already exclude them; this list is the
 * defence-in-depth pass that turns "the payload shape changed" into an
 * explicit rejection instead of a silent hand-off to the compute layer.
 */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "connectionid",
  "connection_id",
  "connection",
  "connections",
  "credentials",
  "credential",
  "password",
  "password_ref",
  "passwordref",
  "secret",
  "secrets",
  "token",
  "auth",
  "authtype",
  "host",
  "port",
  "username",
  "principal",
  "keytab",
  "keytab_ref",
  "keytabref",
  "trust_material_ref",
  "trustmaterialref",
  "tls",
  "jdbc_url",
  "jdbcurl",
  "url",
  "database",
  "databases",
  "transport",
  "http_path"
]);

export type HiveCompileRejectionReason =
  | "hive_compile_dialect_forbidden"
  | "hive_compile_request_invalid"
  | "hive_compile_credential_in_request";

export type HiveCompileFaultReason =
  | "hive_compile_timeout"
  | "hive_compile_output_too_large"
  | "hive_compile_process_failed"
  | "hive_compile_malformed_response"
  | "hive_compile_dialect_mismatch"
  | "hive_compile_spawn_failed"
  | "hive_compile_daemon_unavailable";

export type HiveCompileResult =
  | {
      ok: true;
      sql: string;
      dialect: string;
      columns: Array<Record<string, unknown>>;
      plan: Record<string, unknown>;
      durationMs: number;
    }
  | {
      ok: false;
      /** `input_rejected` = the request was refused; `process_fault` = the bridge failed. */
      kind: "input_rejected" | "process_fault";
      reason: HiveCompileRejectionReason | HiveCompileFaultReason;
      detail: string;
      exitCode?: number | null;
    };

// ── process abstraction (injectable so tests never spawn a real process) ────

export interface HiveCompileChild {
  write(payload: string): void;
  end(): void;
  onStdout(listener: (chunk: Buffer) => void): void;
  onStderr(listener: (chunk: Buffer) => void): void;
  onClose(listener: (code: number | null, signal: string | null) => void): void;
  onError(listener: (error: Error) => void): void;
  kill(signal?: string): void;
}

export type HiveSpawner = (input: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}) => HiveCompileChild;

/** Default spawner: a real child process with piped stdio. */
export const defaultHiveSpawner: HiveSpawner = ({ command, args, env, cwd }) => {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return {
    write: (payload) => child.stdin?.write(payload),
    end: () => child.stdin?.end(),
    onStdout: (listener) => child.stdout?.on("data", (chunk: Buffer) => listener(chunk)),
    onStderr: (listener) => child.stderr?.on("data", (chunk: Buffer) => listener(chunk)),
    onClose: (listener) => child.on("close", (code, signal) => listener(code, signal)),
    onError: (listener) => child.on("error", (error) => listener(error)),
    kill: (signal) => child.kill((signal as NodeJS.Signals | undefined) ?? "SIGKILL")
  };
};

// ── daemon resolution ────────────────────────────────────────────────────────

export type HiveDaemonCommand = {
  command: string;
  /** Arguments that precede the subcommand. */
  args: string[];
};

export type HiveDaemonResolution =
  | { ok: true; command: HiveDaemonCommand; source: "env" | "ktx_status" | "runtime_manifest" }
  | { ok: false; reason: HiveCompileFaultReason; detail: string };

/** Environment variables forwarded to the compile process. */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "WINDIR"
] as const;

/**
 * Build the isolated environment for the compile process.
 *
 * Only an explicit allowlist is forwarded: the Lucy process environment can
 * hold proxy tokens and session material, and none of it belongs in a
 * compile subprocess. The fixed entries make the run deterministic and keep
 * the process off the network.
 */
export function buildCompileEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  env.PYTHONHASHSEED = "0";
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.PYTHONNOUSERSITE = "1";
  // The compile step must never reach for a package index.
  env.PIP_NO_INDEX = "1";
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  env.NO_PROXY = "*";
  env.no_proxy = "*";
  return env;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function runtimeRoot(env: NodeJS.ProcessEnv): string {
  const explicit = env.KTX_RUNTIME_ROOT?.trim();
  if (explicit) return explicit;
  return path.join(homedir(), ".ktx", "runtime");
}

/**
 * Resolve the `ktx-daemon` executable from the managed runtime.
 *
 * The path is never hard-coded: it is read from the runtime manifest that
 * `ktx admin runtime install` writes. Three sources are tried in order:
 * an operator override, the `ktx admin runtime status --json` report, and a
 * scan of the runtime root for an installed manifest.
 */
export async function resolveHiveDaemonCommand(
  options: { env?: NodeJS.ProcessEnv; execFileImpl?: typeof execFileAsync } = {}
): Promise<HiveDaemonResolution> {
  const env = options.env ?? process.env;

  const override = env.LUCY_HIVE_KTX_DAEMON?.trim();
  if (override) {
    if (!(await fileExists(override))) {
      return {
        ok: false,
        reason: "hive_compile_daemon_unavailable",
        detail: "LUCY_HIVE_KTX_DAEMON points at a file that does not exist"
      };
    }
    return { ok: true, command: { command: override, args: [] }, source: "env" };
  }

  const exec = options.execFileImpl ?? execFileAsync;
  try {
    const { stdout } = await exec("ktx", ["admin", "runtime", "status", "--json"], {
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      env
    });
    const parsed = JSON.parse(stdout) as {
      kind?: string;
      manifest?: { python?: { daemonExecutable?: string; executable?: string } };
      layout?: { daemonPath?: string; pythonPath?: string };
    };
    const daemonExecutable = parsed.manifest?.python?.daemonExecutable;
    if (daemonExecutable && (await fileExists(daemonExecutable))) {
      return {
        ok: true,
        command: { command: daemonExecutable, args: [] },
        source: "ktx_status"
      };
    }
    const pythonExecutable = parsed.manifest?.python?.executable;
    if (pythonExecutable && (await fileExists(pythonExecutable))) {
      return {
        ok: true,
        command: { command: pythonExecutable, args: ["-m", "ktx_daemon"] },
        source: "ktx_status"
      };
    }
  } catch {
    // Fall through to the manifest scan below.
  }

  const root = runtimeRoot(env);
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    entries = [];
  }
  for (const version of entries.sort().reverse()) {
    const manifestPath = path.join(root, version, "manifest.json");
    let manifest: {
      python?: { daemonExecutable?: string; executable?: string };
    };
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
    } catch {
      continue;
    }
    const daemonExecutable = manifest.python?.daemonExecutable;
    if (daemonExecutable && (await fileExists(daemonExecutable))) {
      return {
        ok: true,
        command: { command: daemonExecutable, args: [] },
        source: "runtime_manifest"
      };
    }
    const pythonExecutable = manifest.python?.executable;
    if (pythonExecutable && (await fileExists(pythonExecutable))) {
      return {
        ok: true,
        command: { command: pythonExecutable, args: ["-m", "ktx_daemon"] },
        source: "runtime_manifest"
      };
    }
  }

  return {
    ok: false,
    reason: "hive_compile_daemon_unavailable",
    detail:
      "The managed KTX Python runtime could not be located. Run 'ktx admin runtime install --yes --feature core' in the image build, or set LUCY_HIVE_KTX_DAEMON to the ktx-daemon executable."
  };
}

// ── payload validation ──────────────────────────────────────────────────────

function containsForbiddenKey(value: unknown, trail: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenKey(item, trail);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_PAYLOAD_KEYS.has(normalized)) {
      return trail ? `${trail}.${key}` : key;
    }
    const found = containsForbiddenKey(child, trail ? `${trail}.${key}` : key);
    if (found) return found;
  }
  return undefined;
}

/**
 * Validate the request envelope against the compute contract.
 *
 * The allowlists are the schema layer that makes "the compile request can
 * never carry a connection id or a credential" true rather than aspirational.
 */
export function validateCompileEnvelope(
  envelope: Record<string, unknown>
): { ok: true } | { ok: false; reason: HiveCompileRejectionReason; detail: string } {
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) {
      return {
        ok: false,
        reason: "hive_compile_request_invalid",
        detail: `Unknown request field '${key}'`
      };
    }
  }
  const forbidden = containsForbiddenKey(envelope, "");
  if (forbidden) {
    return {
      ok: false,
      reason: "hive_compile_credential_in_request",
      detail: `The compile request must not carry connection or credential fields ('${forbidden}')`
    };
  }
  if (!Array.isArray(envelope.sources)) {
    return {
      ok: false,
      reason: "hive_compile_request_invalid",
      detail: "Field 'sources' must be an array"
    };
  }
  for (const source of envelope.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {
        ok: false,
        reason: "hive_compile_request_invalid",
        detail: "Every entry of 'sources' must be an object"
      };
    }
    for (const key of Object.keys(source)) {
      if (!SOURCE_KEYS.has(key)) {
        return {
          ok: false,
          reason: "hive_compile_request_invalid",
          detail: `Unknown source field '${key}'`
        };
      }
    }
  }
  const query = envelope.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return {
      ok: false,
      reason: "hive_compile_request_invalid",
      detail: "Field 'query' must be an object"
    };
  }
  for (const key of Object.keys(query)) {
    if (!QUERY_KEYS.has(key)) {
      return {
        ok: false,
        reason: "hive_compile_request_invalid",
        detail: `Unknown query field '${key}'`
      };
    }
  }
  return { ok: true };
}

// ── diagnostics redaction ───────────────────────────────────────────────────

const SECRET_ASSIGNMENT_RE = /\b(password|passwd|secret|token|keytab|passphrase|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;
const URL_CREDENTIALS_RE = /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g;

/**
 * Redact a compile diagnostic before it leaves the bridge.
 *
 * The daemon's stderr can echo the request it refused. A refused request can
 * contain a predicate value; a fault can contain a path. Neither belongs in a
 * user-visible error or an audit record verbatim.
 */
export function redactCompileDiagnostic(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  const masked = trimmed
    .replace(URL_CREDENTIALS_RE, "$1***:***@")
    .replace(SECRET_ASSIGNMENT_RE, (_match, key: string) => `${key}=***`);
  return masked.length > MAX_DIAGNOSTIC_CHARS
    ? `${masked.slice(0, MAX_DIAGNOSTIC_CHARS)}…`
    : masked;
}

// ── the bridge ───────────────────────────────────────────────────────────────

export type HiveServerQueryPolicy = {
  /**
   * Whether the compute layer must refuse runtime-composed measures. This is
   * a SERVER decision: the bridge always overwrites the request value, so an
   * Agent can never supply an authoritative value.
   */
  predefinedMeasuresOnly: boolean;
  /** The maximum LIMIT the server accepts for this request. */
  maxLimit: number;
};

export type HiveCompileOptions = {
  sources: Array<Record<string, unknown>>;
  /** The caller-normalized query. `predefined_measures_only` is overwritten. */
  query: Record<string, unknown>;
  policy: HiveServerQueryPolicy;
  deadlineMs?: number;
  maxOutputBytes?: number;
  /**
   * How long the bridge waits for the killed child to report `close` after the
   * deadline fired. Defaults to {@link DEFAULT_CLOSE_GRACE_MS}.
   */
  closeGraceMs?: number;
  spawner?: HiveSpawner;
  /** Pre-resolved daemon command; when omitted the bridge resolves it. */
  daemon?: HiveDaemonCommand;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => number;
};

/**
 * Compile one semantic query for Hive.
 *
 * Never executes SQL, never connects to a database, never falls back to a
 * different dialect.
 */
export async function compileHiveQuery(
  options: HiveCompileOptions
): Promise<HiveCompileResult> {
  const started = (options.now ?? Date.now)();

  if (options.policy.predefinedMeasuresOnly !== true && options.policy.predefinedMeasuresOnly !== false) {
    return {
      ok: false,
      kind: "input_rejected",
      reason: "hive_compile_request_invalid",
      detail: "The server query policy must define 'predefinedMeasuresOnly'"
    };
  }

  const requestedLimit = typeof options.query.limit === "number" ? options.query.limit : undefined;
  const effectiveLimit =
    requestedLimit === undefined
      ? options.policy.maxLimit
      : Math.min(requestedLimit, options.policy.maxLimit);

  // The server owns these two values; whatever the caller passed is dropped.
  const query: Record<string, unknown> = {
    ...options.query,
    limit: effectiveLimit,
    predefined_measures_only: options.policy.predefinedMeasuresOnly
  };
  delete query.forced_filters;
  delete query.forcedFilters;

  const envelope: Record<string, unknown> = {
    sources: options.sources,
    query,
    dialect: HIVE_COMPILE_DIALECT
  };

  const validated = validateCompileEnvelope(envelope);
  if (!validated.ok) {
    return {
      ok: false,
      kind: "input_rejected",
      reason: validated.reason,
      detail: validated.detail
    };
  }

  let daemon: HiveDaemonCommand;
  if (options.daemon) {
    daemon = options.daemon;
  } else {
    const resolved = await resolveHiveDaemonCommand({ env: options.env });
    if (!resolved.ok) {
      return {
        ok: false,
        kind: "process_fault",
        reason: resolved.reason,
        detail: resolved.detail
      };
    }
    daemon = resolved.command;
  }

  const spawner = options.spawner ?? defaultHiveSpawner;
  const deadlineMs = options.deadlineMs ?? DEFAULT_COMPILE_DEADLINE_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const closeGraceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;

  return new Promise<HiveCompileResult>((resolve) => {
    let settled = false;
    // The timer is declared before `finish` can run: a spawner that throws
    // synchronously must not hit a temporal-dead-zone reference here.
    let timer: NodeJS.Timeout | undefined;
    /** The secondary timer that ends the wait for a child that never closes. */
    let closeGraceTimer: NodeJS.Timeout | undefined;
    /** Set when the deadline fired — the timeout result is then authoritative. */
    let timeoutResult: HiveCompileResult | undefined;
    const finish = (result: HiveCompileResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (closeGraceTimer) clearTimeout(closeGraceTimer);
      resolve(result);
    };

    let child: HiveCompileChild;
    try {
      child = spawner({
        command: daemon.command,
        // argv carries the subcommand only — never the request.
        args: [...daemon.args, "semantic-query"],
        env: buildCompileEnv(options.env),
        cwd: options.cwd
      });
    } catch (error) {
      finish({
        ok: false,
        kind: "process_fault",
        reason: "hive_compile_spawn_failed",
        detail: redactCompileDiagnostic(error instanceof Error ? error.message : String(error))
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrText = "";
    let outputTooLarge = false;

    timer = setTimeout(() => {
      const result: HiveCompileResult = {
        ok: false,
        kind: "process_fault",
        reason: "hive_compile_timeout",
        detail: `The compile process exceeded its ${deadlineMs} ms deadline`
      };
      timeoutResult = result;
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already be gone.
      }
      // The kill request is NOT the terminal state. The bridge waits for the
      // child to report `close` before it hands the timeout back, so the
      // caller learns the process is really gone instead of assuming it.
      // The secondary timer keeps a child that never reports `close` from
      // hanging the request forever.
      closeGraceTimer = setTimeout(() => {
        finish(result);
      }, closeGraceMs);
    }, deadlineMs);

    child.onStdout((chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        outputTooLarge = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.onStderr((chunk) => {
      if (stderrText.length < MAX_DIAGNOSTIC_CHARS * 4) {
        stderrText += chunk.toString("utf8");
      }
    });

    child.onError((error) => {
      // A fault reported after the deadline fired does not replace the
      // timeout: the request already failed for the reason the caller cares
      // about.
      if (timeoutResult) {
        finish(timeoutResult);
        return;
      }
      finish({
        ok: false,
        kind: "process_fault",
        reason: "hive_compile_spawn_failed",
        detail: redactCompileDiagnostic(error instanceof Error ? error.message : String(error))
      });
    });

    child.onClose((code) => {
      // The terminal state was observed: the timeout is now certain, not
      // assumed. The reason code stays `hive_compile_timeout`.
      if (timeoutResult) {
        finish(timeoutResult);
        return;
      }

      if (outputTooLarge) {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_output_too_large",
          detail: `The compile process produced more than ${maxOutputBytes} bytes of output`
        });
        return;
      }

      const diagnostic = redactCompileDiagnostic(stderrText);

      if (code === DAEMON_INPUT_REJECTED_EXIT_CODE) {
        // The compute layer refused the request. This is an expected outcome,
        // not a bridge fault — the caller must not retry it as a process error.
        finish({
          ok: false,
          kind: "input_rejected",
          reason: "hive_compile_process_failed",
          detail: diagnostic || "The compute layer rejected the request",
          exitCode: code
        });
        return;
      }

      if (code !== 0) {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_process_failed",
          detail: diagnostic || `The compile process exited with code ${code ?? "unknown"}`,
          exitCode: code
        });
        return;
      }

      const stdoutText = Buffer.concat(stdoutChunks).toString("utf8").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdoutText);
      } catch {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_malformed_response",
          detail: "The compile process did not return a JSON object"
        });
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_malformed_response",
          detail: "The compile process did not return a JSON object"
        });
        return;
      }
      const response = parsed as {
        sql?: unknown;
        dialect?: unknown;
        columns?: unknown;
        plan?: unknown;
      };
      if (typeof response.sql !== "string" || response.sql.trim().length === 0) {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_malformed_response",
          detail: "The compile response carries no SQL"
        });
        return;
      }
      if (typeof response.dialect !== "string" || response.dialect !== HIVE_COMPILE_DIALECT) {
        finish({
          ok: false,
          kind: "process_fault",
          reason: "hive_compile_dialect_mismatch",
          detail: `The compile response reports dialect '${String(response.dialect)}' instead of '${HIVE_COMPILE_DIALECT}'`
        });
        return;
      }

      finish({
        ok: true,
        sql: response.sql,
        dialect: response.dialect,
        columns: Array.isArray(response.columns)
          ? (response.columns.filter(
              (column) => column && typeof column === "object" && !Array.isArray(column)
            ) as Array<Record<string, unknown>>)
          : [],
        plan:
          response.plan && typeof response.plan === "object" && !Array.isArray(response.plan)
            ? (response.plan as Record<string, unknown>)
            : {},
        durationMs: (options.now ?? Date.now)() - started
      });
    });

    try {
      child.write(`${JSON.stringify(envelope)}\n`);
      child.end();
    } catch (error) {
      finish({
        ok: false,
        kind: "process_fault",
        reason: "hive_compile_spawn_failed",
        detail: redactCompileDiagnostic(error instanceof Error ? error.message : String(error))
      });
    }
  });
}
