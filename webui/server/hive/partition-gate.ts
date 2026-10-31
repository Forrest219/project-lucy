/**
 * Hive partition predicate gate (execution-wave M2).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md HQ-D3–HQ-D8
 */

import {
  expandPhysicalTables,
  parseHiveSql,
  splitHiveConjuncts,
  unwrapHiveExpr,
  type HiveExpr,
  type HiveQuery
} from "./ast-check.js";
import type { HivePartitionKey, HivePartitionProfile, HivePartitionStatus } from "./partition-profile.js";

export type HivePartitionGateReason =
  | "hive_partition_status_unknown"
  | "hive_partition_predicate_required"
  | "hive_partition_predicate_skip_level"
  | "hive_partition_sql_unparseable";

export type HivePartitionGateInput = {
  sql: string;
  profilesByPhysicalTable: Map<string, HivePartitionProfile>;
  ignoreMissingProfiles?: boolean;
};

export type HivePartitionGateResult =
  | { ok: true }
  | { ok: false; reason: HivePartitionGateReason; detail: string };

function columnLeafName(expr: HiveExpr): string | null {
  const node = unwrapHiveExpr(expr);
  if (node.kind !== "column" || node.parts.length === 0) return null;
  return node.parts[node.parts.length - 1]!.toLowerCase();
}

function isConstantLiteral(expr: HiveExpr): boolean {
  const node = unwrapHiveExpr(expr);
  return node.kind === "literal" && node.literalType !== "null";
}

function allConstantLiterals(exprs: HiveExpr[]): boolean {
  return exprs.length > 0 && exprs.every(isConstantLiteral);
}

/** Spec §2.1: equality, IN (non-empty constants), or closed BETWEEN. */
export function conjunctBoundsPartitionKey(conjunct: HiveExpr, keyName: string): boolean {
  const target = keyName.toLowerCase();
  const node = unwrapHiveExpr(conjunct);

  if (node.kind === "binary") {
    const op = node.operator;
    if (op === "=" || op === "==") {
      const left = columnLeafName(node.left);
      const right = columnLeafName(node.right);
      if (left === target && isConstantLiteral(node.right)) return true;
      if (right === target && isConstantLiteral(node.left)) return true;
      return false;
    }
    return false;
  }

  if (node.kind === "in" && !node.negated) {
    const leaf = columnLeafName(node.operand);
    return leaf === target && allConstantLiterals(node.values);
  }

  if (node.kind === "between" && !node.negated) {
    const leaf = columnLeafName(node.operand);
    return leaf === target && isConstantLiteral(node.low) && isConstantLiteral(node.high);
  }

  return false;
}

function collectWhereConjuncts(query: HiveQuery): HiveExpr[] {
  const conjuncts = splitHiveConjuncts(query.where);
  for (const cte of query.ctes) {
    conjuncts.push(...collectWhereConjuncts(cte.query));
  }
  if (query.from.kind === "subquery") {
    conjuncts.push(...collectWhereConjuncts(query.from.query));
  }
  for (const join of query.joins) {
    if (join.ref.kind === "subquery") {
      conjuncts.push(...collectWhereConjuncts(join.ref.query));
    }
  }
  return conjuncts;
}

/**
 * HQ-D5: contiguous prefix from the leftmost key. Zero bounded levels → reject.
 * Skip-level (e.g. only p2) → reject.
 */
export function evaluatePartitionPrefix(
  keys: readonly HivePartitionKey[],
  conjuncts: readonly HiveExpr[]
): { ok: true } | { ok: false; reason: HivePartitionGateReason; detail: string } {
  if (keys.length === 0) return { ok: true };

  const bounded = keys.map((key) =>
    conjuncts.some((conjunct) => conjunctBoundsPartitionKey(conjunct, key.name))
  );

  let prefixLength = 0;
  while (prefixLength < bounded.length && bounded[prefixLength]) {
    prefixLength += 1;
  }

  for (let index = prefixLength; index < bounded.length; index += 1) {
    if (bounded[index]) {
      return {
        ok: false,
        reason: "hive_partition_predicate_skip_level",
        detail: `Partition key '${keys[index]!.name}' is constrained without a contiguous prefix from '${keys[0]!.name}'`
      };
    }
  }

  if (prefixLength === 0) {
    return {
      ok: false,
      reason: "hive_partition_predicate_required",
      detail: `Partitioned table requires a bounded predicate on at least '${keys[0]!.name}' before JDBC`
    };
  }

  return { ok: true };
}

export function checkHivePartitionGate(input: HivePartitionGateInput): HivePartitionGateResult {
  const parsed = parseHiveSql(input.sql);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "hive_partition_sql_unparseable",
      detail: parsed.detail
    };
  }

  const query = parsed.statement.query;
  const conjuncts = collectWhereConjuncts(query);
  const tables = [...new Set(expandPhysicalTables(query))];

  for (const table of tables) {
    const profile = input.profilesByPhysicalTable.get(table);
    if (!profile) {
      if (input.ignoreMissingProfiles) continue;
      return {
        ok: false,
        reason: "hive_partition_status_unknown",
        detail: `No partition profile for physical table '${table}'`
      };
    }

    const status: HivePartitionStatus = profile.status;
    if (status === "unknown") {
      return {
        ok: false,
        reason: "hive_partition_status_unknown",
        detail: `Partition status for '${table}' is unknown; refusing query`
      };
    }
    if (status === "unpartitioned") continue;

    const prefix = evaluatePartitionPrefix(profile.keys, conjuncts);
    if (!prefix.ok) {
      return { ok: false, reason: prefix.reason, detail: `${prefix.detail} (table '${table}')` };
    }
  }

  return { ok: true };
}
