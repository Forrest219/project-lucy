import { createConnection, type ConnectionOptions } from "mysql2";
import { CATALOG_SHOW_STATEMENT, readDirectConnectionConfig, safeMessage, type CatalogShowConnection, type DriverDeps } from "./catalog-show";
import { CATALOG_SCAN_TIMEOUT_MS } from "./catalog-database";

/** The direct metadata channel cannot serve this connection; the caller reads the legacy way. */
export class MetadataChannelUnavailable extends Error {
  constructor(message = "Metadata channel unavailable") {
    super(message);
    this.name = "MetadataChannelUnavailable";
  }
}

export type MetadataAnswer = { rows: unknown[][]; truncated: boolean };

/**
 * One direct MySQL connection that serves several metadata statements, then closes.
 * `run` accepts only the metadata grammar below; a full page of rows is reported as `truncated`.
 */
export type MetadataChannel = {
  run(sql: string, options: { maxRows: number; timeoutMs: number }): Promise<MetadataAnswer>;
  close(): void;
};

// Quoted literal without backslashes or control characters, so no literal can break out of its quotes.
const LITERAL = "'(?:[^'\\\\\\0\\r\\n]|'')+'";
const LITERAL_LIST = `${LITERAL}(?:,${LITERAL})*`;
const INFORMATION_SCHEMA_TABLES = new RegExp(
  `^SELECT table_name FROM information_schema\\.tables WHERE table_schema = ${LITERAL} AND table_type = 'BASE TABLE' AND LOWER\\(table_name\\) IN \\(${LITERAL_LIST}\\)$`
);
const INFORMATION_SCHEMA_TABLE_NAMES = new RegExp(
  `^SELECT table_name FROM information_schema\\.tables WHERE table_schema = ${LITERAL} AND table_type = 'BASE TABLE' ORDER BY table_name$`
);
const INFORMATION_SCHEMA_COLUMNS = new RegExp(
  "^SELECT table_name, column_name, data_type, is_nullable, column_key, column_comment " +
    `FROM information_schema\\.columns WHERE table_schema = ${LITERAL} AND table_name IN \\(${LITERAL_LIST}\\) ORDER BY table_name, ordinal_position$`
);

function allowed(sql: string): boolean {
  return CATALOG_SHOW_STATEMENT.test(sql) || INFORMATION_SCHEMA_TABLES.test(sql) ||
    INFORMATION_SCHEMA_TABLE_NAMES.test(sql) ||
    INFORMATION_SCHEMA_COLUMNS.test(sql);
}

export async function openMetadataChannel(
  projectRoot: string,
  connectionId: string,
  deps: DriverDeps = {}
): Promise<MetadataChannel> {
  let config;
  try {
    config = await readDirectConnectionConfig(projectRoot, connectionId);
  } catch {
    throw new MetadataChannelUnavailable();
  }
  if (config.unsupportedOptions.length > 0) throw new MetadataChannelUnavailable();
  const { password } = config;
  const factory =
    deps.createConnectionImpl ??
    ((params: ConnectionOptions) => createConnection(params) as unknown as CatalogShowConnection);
  const connection = factory({
    host: config.host,
    port: config.port,
    user: config.user,
    password,
    connectTimeout: CATALOG_SCAN_TIMEOUT_MS,
    multipleStatements: false,
    rowsAsArray: true
  });
  let connected: Promise<void> | undefined;
  let closed = false;
  // One listener for the whole channel; the statement in flight, if any, fails with the driver error.
  let failInFlight: ((error: Error) => void) | null = null;
  connection.on("error", (error) => failInFlight?.(error));

  const withDeadline = <T>(timeoutMs: number, start: (done: (error: Error | null, value?: T) => void) => void): Promise<T> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        failInFlight = null;
        if (error) reject(new Error(safeMessage(error, password)));
        else resolve(value as T);
      };
      const timer = setTimeout(() => finish(new Error("Catalog connection/query timed out")), timeoutMs);
      failInFlight = (error) => finish(error);
      try {
        start(finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Catalog query failed"));
      }
    });

  return {
    async run(sql, options) {
      if (!allowed(sql)) throw new Error("Unsupported catalog statement");
      if (closed) throw new Error("Metadata channel is closed");
      connected ??= withDeadline<void>(options.timeoutMs, (done) => connection.connect((error) => done(error)));
      await connected;
      const answer = await withDeadline<{ rows: unknown[][] }>(options.timeoutMs, (done) => {
        connection.query({ sql, timeout: options.timeoutMs, rowsAsArray: true }, (error, rows) => {
          if (error) return done(error);
          if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) return done(new Error("Invalid catalog rows"));
          done(null, { rows: rows as unknown[][] });
        });
      });
      return { rows: answer.rows, truncated: answer.rows.length >= options.maxRows };
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        connection.destroy();
      } catch {
        // A driver error here can contain the password. Drop it.
      }
    }
  };
}
