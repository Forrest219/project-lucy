/**
 * Hive JDBC worker surface (execution-wave M3).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md HQ-D9 / HQ-13–HQ-16
 *
 * Real HS2 drivers are environment-bound. This module defines the contract and
 * a synthetic worker for module acceptance. Production wiring may inject a
 * driver-backed implementation without changing the gate or MCP bridge.
 */

export type HiveJdbcColumn = {
  name: string;
  /** Wire type hint; decimal/bigint must remain strings when precision matters. */
  type: "string" | "number" | "boolean" | "decimal" | "bigint" | "null";
};

export type HiveJdbcRow = Record<string, string | number | boolean | null>;

export type HiveJdbcExecuteRequest = {
  connectionId: string;
  sql: string;
  deadlineMs: number;
  maxRows: number;
  correlationId?: string;
};

export type HiveJdbcExecuteSuccess = {
  columns: HiveJdbcColumn[];
  rows: HiveJdbcRow[];
  truncated: boolean;
  canceled: boolean;
  /** Present when the worker observed a cancel/timeout path. */
  terminalState: "completed" | "canceled" | "timeout" | "unknown";
};

export type HiveJdbcExecuteFailure = {
  reason:
    | "hive_jdbc_not_configured"
    | "hive_jdbc_rejected"
    | "hive_jdbc_timeout"
    | "hive_jdbc_canceled"
    | "hive_jdbc_internal";
  detail: string;
  terminalState: "canceled" | "timeout" | "unknown" | "failed";
};

export type HiveJdbcExecuteResult =
  | { ok: true; value: HiveJdbcExecuteSuccess }
  | { ok: false; failure: HiveJdbcExecuteFailure };

export type HiveJdbcWorker = {
  readonly kind: "synthetic" | "driver" | "unconfigured";
  execute(request: HiveJdbcExecuteRequest): Promise<HiveJdbcExecuteResult>;
  /** Test/helper: request cancel for the in-flight operation if any. */
  cancel?(correlationId: string): void;
};

export function unconfiguredHiveJdbcWorker(): HiveJdbcWorker {
  return {
    kind: "unconfigured",
    async execute() {
      return {
        ok: false,
        failure: {
          reason: "hive_jdbc_not_configured",
          detail: "No Hive JDBC worker is configured for this process",
          terminalState: "failed"
        }
      };
    }
  };
}

export type SyntheticHiveTable = {
  columns: HiveJdbcColumn[];
  /** Rows keyed for simple equality filters on listed columns. */
  rows: HiveJdbcRow[];
};

/**
 * In-process worker for HQ acceptance. Understands a tiny subset of SELECT
 * with equality filters — enough to prove gate→execute wiring and oracle rows.
 */
export function createSyntheticHiveJdbcWorker(tables: Map<string, SyntheticHiveTable>): HiveJdbcWorker {
  const canceled = new Set<string>();
  return {
    kind: "synthetic",
    cancel(correlationId: string) {
      canceled.add(correlationId);
    },
    async execute(request) {
      if (request.correlationId && canceled.has(request.correlationId)) {
        return {
          ok: false,
          failure: {
            reason: "hive_jdbc_canceled",
            detail: "Operation canceled before execute",
            terminalState: "canceled"
          }
        };
      }
      if (request.deadlineMs <= 0) {
        return {
          ok: false,
          failure: {
            reason: "hive_jdbc_timeout",
            detail: "Deadline already exhausted",
            terminalState: "timeout"
          }
        };
      }

      const match = /^\s*select\s+([\s\S]+?)\s+from\s+([a-zA-Z0-9_."`]+)(?:\s+where\s+([\s\S]+?))?(?:\s+limit\s+(\d+))?\s*$/i.exec(
        request.sql
      );
      if (!match) {
        return {
          ok: false,
          failure: {
            reason: "hive_jdbc_rejected",
            detail: "Synthetic worker only accepts simple SELECT … FROM … [WHERE …] [LIMIT n]",
            terminalState: "failed"
          }
        };
      }

      const tableToken = match[2]!.replace(/[`"]/g, "");
      const table = tables.get(tableToken) ?? tables.get(tableToken.toLowerCase());
      if (!table) {
        return {
          ok: false,
          failure: {
            reason: "hive_jdbc_rejected",
            detail: `Unknown synthetic table '${tableToken}'`,
            terminalState: "failed"
          }
        };
      }

      let rows = [...table.rows];
      const where = match[3]?.trim();
      if (where) {
        const eq = /^([a-zA-Z0-9_."`]+)\s*=\s*'((?:\\'|[^'])*)'$/i.exec(where);
        if (!eq) {
          // Multiple AND equalities: dt = 'x' AND region = 'y'
          const parts = where.split(/\s+and\s+/i);
          for (const part of parts) {
            const one = /^([a-zA-Z0-9_."`]+)\s*=\s*'((?:\\'|[^'])*)'$/i.exec(part.trim());
            if (!one) {
              return {
                ok: false,
                failure: {
                  reason: "hive_jdbc_rejected",
                  detail: `Unsupported WHERE clause for synthetic worker: ${where}`,
                  terminalState: "failed"
                }
              };
            }
            const col = one[1]!.replace(/[`"]/g, "").toLowerCase();
            const value = one[2]!.replace(/\\'/g, "'");
            rows = rows.filter((row) => String(row[col] ?? row[one[1]!] ?? "") === value);
          }
        } else {
          const col = eq[1]!.replace(/[`"]/g, "").toLowerCase();
          const value = eq[2]!.replace(/\\'/g, "'");
          rows = rows.filter((row) => String(row[col] ?? row[eq[1]!] ?? "") === value);
        }
      }

      const limitFromSql = match[4] ? Number(match[4]) : undefined;
      const limit = Math.min(request.maxRows, limitFromSql ?? request.maxRows);
      const truncated = rows.length > limit;
      const sliced = rows.slice(0, limit);

      if (request.correlationId && canceled.has(request.correlationId)) {
        return {
          ok: true,
          value: {
            columns: table.columns,
            rows: sliced,
            truncated,
            canceled: true,
            terminalState: "canceled"
          }
        };
      }

      return {
        ok: true,
        value: {
          columns: table.columns,
          rows: sliced,
          truncated,
          canceled: false,
          terminalState: "completed"
        }
      };
    }
  };
}
