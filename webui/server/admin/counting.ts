/**
 * Lucy v0.25 P1 — one counting vocabulary.
 *
 * Authority:
 *   - P1-1 P1-D7      「同源不等于同数」
 *   - P1-2 §2.2       计数口径表
 *   - P1-3 §4.2       grantPaths / grantUsers / accessPaths / accessUsers / accessCalls
 *
 * The three surfaces count DIFFERENT things and the difference is the whole
 * point of this module:
 *
 *  - **table set**      — deduplicated canonical source keys. "How many tables?"
 *  - **grant path**     — `(Agent, Role, Connection, Schema, Table)` existence
 *                         instances. "How many authorization paths?"
 *  - **access path**    — deduplicated `(Agent, Role, Connection, Schema, Table)`
 *                         paths with at least one allowed call in the window.
 *                         "How many access paths?"
 *  - **call count**     — calls. "How many calls?"
 *
 * A grant path count is NOT a table count: one Agent holding two Roles over the
 * same table has 2 grant paths and 1 table. Presenting 2 where the question was
 * "how many tables" is the exact misread P1-3 §4.2 calls out ("不得把路径数
 * 显示成 Agent 数").
 *
 * Two more traps this module closes:
 *
 *  - `accessCalls` on a Role edge is counted AFTER role attribution, so summing
 *    it across Roles can double-count one call. The global call count must be
 *    deduplicated by a stable call id instead. See {@link globalCallCount}.
 *  - A table set must be deduplicated by canonical source key, not by
 *    `(connectionId, sourceName)` — the latter merges two Schemas of the same
 *    connection that happen to share a source name.
 */
import { sourceCountKey } from "./permission-display.js";

export type CanonicalSourceRef = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable?: string;
};

export type GrantPathRef = CanonicalSourceRef & {
  agentId: string;
  roleId: string;
};

export type AccessPathRef = GrantPathRef;

/**
 * Counting key for a table. Reuses the EXISTING admin counting key
 * (`permission-display.ts:sourceCountKey`) so P1 counts line up with the
 * authorized-source counts already shown on the Agent list — one vocabulary,
 * not two.
 */
export function tableCountKey(ref: CanonicalSourceRef): string {
  return sourceCountKey(ref.connectionId, ref.schema, ref.sourceName);
}

/** Display identity of a canonical source key (four-tuple). */
export function canonicalSourceKeyDisplay(ref: CanonicalSourceRef): string {
  return `${ref.connectionId}|${ref.schema}|${ref.sourceName}|${ref.physicalTable ?? ref.sourceName}`;
}

/**
 * Key of an authorization path: `(Agent, Role, Connection, Schema, Table)`.
 *
 * Five components, not three. The Agent and Role make it a *path*; the
 * connection and schema keep two same-named tables of different Schemas apart.
 */
export function grantPathKey(ref: GrantPathRef): string {
  return [
    ref.agentId,
    ref.roleId,
    ref.connectionId,
    ref.schema,
    ref.sourceName
  ].join("\u0000");
}

/** Key of an access path. Same shape as a grant path, by design: the two layers are comparable. */
export function accessPathKey(ref: AccessPathRef): string {
  return grantPathKey(ref);
}

/** Deduplicated table set. */
export function canonicalTableSet(refs: CanonicalSourceRef[]): Set<string> {
  return new Set(refs.map(tableCountKey));
}

/** Number of distinct tables. */
export function countTables(refs: CanonicalSourceRef[]): number {
  return canonicalTableSet(refs).size;
}

/** Number of distinct authorization paths. */
export function countGrantPaths(refs: GrantPathRef[]): number {
  return new Set(refs.map(grantPathKey)).size;
}

/** Number of distinct access paths. */
export function countAccessPaths(refs: AccessPathRef[]): number {
  return new Set(refs.map(accessPathKey)).size;
}

/** Distinct Agents flowing through a set of paths. */
export function countDistinctAgents(refs: Array<{ agentId: string }>): number {
  return new Set(refs.map((ref) => ref.agentId)).size;
}

export type CallCountInput = {
  /** Stable call identity (audit log id). Two Role edges of one call share it. */
  callId: string;
  /** The Role the call was attributed to on this edge. */
  roleId: string;
};

/**
 * Global call count.
 *
 * The per-edge `accessCalls` of every Role edge may count the SAME call twice
 * (a call attributed to two Roles expands into two edges). The global number
 * must therefore be deduplicated by the stable call id, never summed.
 */
export function globalCallCount(calls: CallCountInput[]): number {
  return new Set(calls.map((call) => call.callId)).size;
}

/**
 * Per-edge call counts, deduplicated within the edge.
 *
 * `accessCalls` is "calls on this edge", so one call attributed to two Roles
 * counts once on each edge — that is correct per edge, and is why the global
 * number needs {@link globalCallCount} instead of a sum.
 */
export function edgeCallCounts(calls: CallCountInput[]): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const call of calls) {
    const key = `${call.roleId}\u0000${call.callId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(call.roleId, (counts.get(call.roleId) ?? 0) + 1);
  }
  return counts;
}

export type CountingInvariantInput = {
  /** Deduplicated table set. */
  tables: Set<string>;
  /** Authorization paths. */
  grantPaths: number;
  /** Access paths. */
  accessPaths: number;
};

/**
 * Guard against the misread this module exists to prevent.
 *
 * Returns a list of human-readable violations; empty means the counts are
 * internally consistent. A path count LOWER than the table count is legal (one
 * table may carry no path); a path count used AS a table count is not, and the
 * surfaces must never substitute one for the other.
 */
export function assertCountingInvariant(input: CountingInvariantInput): string[] {
  const violations: string[] = [];
  if (input.grantPaths < input.tables.size) {
    violations.push(
      `grantPaths (${input.grantPaths}) < table count (${input.tables.size}); ` +
        "a table with no grant path is legal, but the two numbers must not be substituted for each other"
    );
  }
  if (input.accessPaths < 0 || input.grantPaths < 0) {
    violations.push("path counts must not be negative");
  }
  return violations;
}
