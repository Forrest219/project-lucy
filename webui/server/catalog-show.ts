import { readFile } from "node:fs/promises";
import path from "node:path";
import { createConnection, type ConnectionOptions } from "mysql2";
import { parse } from "yaml";
import { CATALOG_SCAN_TIMEOUT_MS } from "./catalog-database";
import { safeReadSecretPasswordBytesIfExists } from "./fs-safe";
import type { SqlResult } from "./ktx";

/** Callback connection keeps a destroyable handle even while authentication is pending. */
export type CatalogShowConnection = {
  connect(callback: (error: Error | null) => void): void;
  query(
    options: { sql: string; timeout: number; rowsAsArray: true },
    callback: (error: Error | null, rows?: unknown, fields?: Array<{ name: string }>) => void
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  destroy(): void;
};

type DriverDeps = {
  createConnectionImpl?: (options: ConnectionOptions) => CatalogShowConnection;
};

const DEADLINE_MS = CATALOG_SCAN_TIMEOUT_MS;
const IDENT = "`(?:``|[^`\\0\\r\\n])+`";
const SHOW = new RegExp(`^SHOW (?:DATABASES FROM ${IDENT}|TABLES FROM ${IDENT}\\.${IDENT})$`);

const PUBLIC_MESSAGES = new Set([
  "Unsupported catalog statement",
  "Invalid catalog connection configuration",
  "Invalid catalog port",
  "Catalog password must use a file reference",
  "Catalog password file is missing"
]);

function safeMessage(error: unknown, password: string): string {
  const text = error instanceof Error ? error.message : "读取表结构失败。";
  if (!password) return PUBLIC_MESSAGES.has(text) ? text : "读取表结构失败。";
  return text.split(password).join("[REDACTED]");
}

/** Read only the two generated metadata statements. No KTX, default database, or multi-statements. */
export async function runCatalogShow(
  projectRoot: string,
  connectionId: string,
  sql: string,
  options: { maxRows?: number; timeoutMs?: number } = {},
  deps: DriverDeps = {}
): Promise<SqlResult> {
  const started = Date.now();
  let password = "";
  let connection: CatalogShowConnection | undefined;
  const base = { command: "mysql SHOW", args: [] as string[], stdout: "" };
  try {
    if (!SHOW.test(sql)) throw new Error("Unsupported catalog statement");
    const config = parse(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")) as {
      connections?: Record<string, { host?: unknown; port?: unknown; username?: unknown; password?: unknown }>;
    };
    const conn = config?.connections?.[connectionId];
    if (!conn || typeof conn.host !== "string" || !conn.host.trim() || typeof conn.username !== "string" || !conn.username.trim()) {
      throw new Error("Invalid catalog connection configuration");
    }
    const port = Number(conn.port ?? 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid catalog port");
    if (typeof conn.password !== "string" || !conn.password.startsWith("file:")) {
      throw new Error("Catalog password must use a file reference");
    }
    const ref = conn.password.slice("file:".length);
    const relative = path.isAbsolute(ref) ? path.relative(path.resolve(projectRoot), ref) : ref;
    const bytes = await safeReadSecretPasswordBytesIfExists(projectRoot, relative.replaceAll(path.sep, "/"));
    if (bytes === null) throw new Error("Catalog password file is missing");
    password = bytes.toString("utf8");
    const factory = deps.createConnectionImpl ?? ((params: ConnectionOptions) => createConnection(params) as unknown as CatalogShowConnection);
    connection = factory({
      host: conn.host,
      port,
      user: conn.username,
      password,
      connectTimeout: options.timeoutMs ?? DEADLINE_MS,
      multipleStatements: false,
      rowsAsArray: true
    });

    const deadline = <T>(start: (done: (error: Error | null, value?: T) => void) => void): Promise<T> => new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Catalog connection/query timed out")), options.timeoutMs ?? DEADLINE_MS);
      const finish = (error: Error | null, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value as T);
      };
      connection?.on("error", (error) => finish(error));
      try {
        start(finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Catalog query failed"));
      }
    });

    await deadline<void>((done) => connection!.connect((error) => done(error)));
    const answer = await deadline<{ rows: unknown[][]; headers: string[] }>((done) => {
      connection!.query({ sql, timeout: options.timeoutMs ?? DEADLINE_MS, rowsAsArray: true }, (error, rows, fields) => {
        if (error) return done(error);
        if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) return done(new Error("Invalid catalog rows"));
        done(null, { rows: rows as unknown[][], headers: (fields ?? []).map((field) => field.name) });
      });
    });
    const maxRows = options.maxRows ?? 10_000;
    if (answer.rows.length >= maxRows) {
      throw new Error("读取结果超过一次可读取的上限。");
    }
    return {
      ...base,
      ok: true,
      exitCode: 0,
      stderr: "",
      latencyMs: Date.now() - started,
      json: { headers: answer.headers, rows: answer.rows }
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      exitCode: 1,
      stderr: safeMessage(error, password),
      latencyMs: Date.now() - started,
      json: null
    };
  } finally {
    try {
      connection?.destroy();
    } catch {
      // A driver error here can contain the password. Drop it.
    }
  }
}
