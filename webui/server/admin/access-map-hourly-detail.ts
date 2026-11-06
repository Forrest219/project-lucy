/**
 * Access-map hourly detail table (Spec lucy-20261104-access-map-hourly-detail).
 *
 * Builds per-hour × five-tuple × inquiryKind × accessGrade buckets from the same
 * E∪D call set as the sankey access layer. Conservation uses global call-ID sets
 * — never Σ allowCalls as |E|.
 */
import type { InquiryKind } from "./audit-inquiry-kind.js";
import { accessGrade, type AccessGrade } from "../proxy/usage-classification.js";

/** Minimal audit row shape needed for hourly buckets (avoids circular import). */
export type HourlyDetailAuditRow = {
  callId: string;
  userId: string;
  matchedRoleId: string | null;
  roleIds: string[];
  outcome: string;
  ts: string;
  connectionId: string;
  schemaName: string;
  sourceName: string;
  tool?: string | null;
  inquiryKind?: InquiryKind | null;
};

export type AccessMapNodeKind =
  | "agent"
  | "role"
  | "connection"
  | "schema"
  | "table"
  | "token";

/** Scope／paging fields used by detail projection. */
export type HourlyDetailQueryScope = {
  agent: string | null;
  role: string | null;
  connection: string | null;
  table: string | null;
};

const UNRESOLVED_ROLE_ID = "<unresolved>";

function attributeRoles(row: {
  matchedRoleId: string | null;
  roleIds: string[];
}): string[] {
  const matched = typeof row.matchedRoleId === "string" ? row.matchedRoleId.trim() : "";
  if (matched) return [matched];
  if (row.roleIds.length > 0) return [...new Set(row.roleIds)];
  return [UNRESOLVED_ROLE_ID];
}

function splitTableParam(
  raw: string
): { connectionId: string; schema: string; sourceName: string } | null {
  const parts = raw.split("::");
  if (parts.length !== 3) return null;
  const [connectionId, schema, sourceName] = parts.map((part) => part.trim());
  if (!connectionId || !schema || !sourceName) return null;
  return { connectionId, schema, sourceName };
}

export type AccessMapHourlyDetailRow = {
  hour: string;
  agentId: string;
  roleId: string;
  connectionId: string;
  schema: string;
  table: string;
  inquiryKind: InquiryKind | null;
  accessGrade: AccessGrade;
  allowCalls: number;
  denyCalls: number;
};

export type AccessMapHourlyDetail = {
  rows: AccessMapHourlyDetailRow[];
  hasMore: boolean;
  totalRowCount: number;
  limit: number;
  offset: number;
};

export type HourlyDetailBucketMeta = {
  hour: string;
  agentId: string;
  roleId: string;
  connectionId: string;
  schema: string;
  table: string;
  inquiryKind: InquiryKind | null;
  accessGrade: AccessGrade;
};

export type HourlyDetailBucket = {
  meta: HourlyDetailBucketMeta;
  allow: Set<string>;
  deny: Set<string>;
};

export type HourlyDetailCallRow = {
  callId: string;
  userId: string;
  ts: string;
  tool: string | null;
  matchedRoleId: string | null;
  roleIds: string[];
  sources: Array<{ connectionId: string; schema: string; table: string }>;
  inquiryKind: InquiryKind | null;
};

export type DetailFocusEntity = {
  kind: AccessMapNodeKind;
  agentId?: string;
  roleId?: string;
  connectionId?: string;
  schema?: string;
  table?: string;
};

export type DetailFocusContext = {
  accessCallIds: Set<string>;
  entity: DetailFocusEntity | null;
};

export const ACCESS_MAP_DETAIL_DEFAULT_LIMIT = 200;
export const ACCESS_MAP_DETAIL_MAX_LIMIT = 2000;

export type DetailPaginationParseResult =
  | { ok: true; detailLimit: number; detailOffset: number }
  | { ok: false; param: "detailLimit" | "detailOffset"; message: string };

/**
 * Parse detailLimit / detailOffset from query params.
 * Non-integer → fail; limit > 2000 → clamp; offset < 0 → 0.
 */
export function parseDetailPagination(
  input: URLSearchParams | Record<string, string | string[] | undefined>
): DetailPaginationParseResult {
  const read = (key: string): string | null => {
    if (input instanceof URLSearchParams) {
      const raw = input.get(key);
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    const raw = input[key];
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const limitRaw = read("detailLimit");
  let detailLimit = ACCESS_MAP_DETAIL_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^-?\d+$/.test(limitRaw)) {
      return {
        ok: false,
        param: "detailLimit",
        message: "detailLimit 必须是整数"
      };
    }
    detailLimit = Number(limitRaw);
    if (detailLimit > ACCESS_MAP_DETAIL_MAX_LIMIT) {
      detailLimit = ACCESS_MAP_DETAIL_MAX_LIMIT;
    }
  }

  const offsetRaw = read("detailOffset");
  let detailOffset = 0;
  if (offsetRaw !== null) {
    if (!/^-?\d+$/.test(offsetRaw)) {
      return {
        ok: false,
        param: "detailOffset",
        message: "detailOffset 必须是整数"
      };
    }
    detailOffset = Number(offsetRaw);
    if (detailOffset < 0) detailOffset = 0;
  }

  return { ok: true, detailLimit, detailOffset };
}

/** Asia/Shanghai hour-floor: `YYYY-MM-DDTHH:00:00+08:00`. */
export function shanghaiHourFloor(tsIso: string): string {
  const date = new Date(tsIso);
  if (Number.isNaN(date.getTime())) {
    return "1970-01-01T00:00:00+08:00";
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00:00+08:00`;
}

export function packHourlyDetailKey(meta: HourlyDetailBucketMeta): string {
  return [
    meta.hour,
    meta.agentId,
    meta.roleId,
    meta.connectionId,
    meta.schema,
    meta.table,
    meta.inquiryKind ?? "",
    meta.accessGrade
  ].join("\u0001");
}

function dimOrUnknown(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : "unknown";
}

/**
 * Group flat audit rows (one source per row) into call records for E∪D.
 */
export function groupAuditRowsToHourlyCalls(input: {
  rows: HourlyDetailAuditRow[];
  E: Set<string>;
  D: Set<string>;
}): Map<string, HourlyDetailCallRow> {
  const { rows, E, D } = input;
  const calls = new Map<string, HourlyDetailCallRow>();
  for (const row of rows) {
    if (!E.has(row.callId) && !D.has(row.callId)) continue;
    let call = calls.get(row.callId);
    if (!call) {
      call = {
        callId: row.callId,
        userId: row.userId,
        ts: row.ts,
        tool: row.tool ?? null,
        matchedRoleId: row.matchedRoleId,
        roleIds: row.roleIds,
        sources: [],
        inquiryKind: row.inquiryKind ?? null
      };
      calls.set(row.callId, call);
    }
    const connectionId = dimOrUnknown(row.connectionId);
    const schema = dimOrUnknown(row.schemaName);
    const table = dimOrUnknown(row.sourceName);
    if (
      !call.sources.some(
        (src) =>
          src.connectionId === connectionId && src.schema === schema && src.table === table
      )
    ) {
      call.sources.push({ connectionId, schema, table });
    }
  }
  for (const call of calls.values()) {
    if (call.sources.length === 0) {
      call.sources.push({ connectionId: "unknown", schema: "unknown", table: "unknown" });
    }
  }
  return calls;
}

/**
 * Test seam: full row-key → {allow, deny} ID sets.
 * Multi-role × multi-source expansion; ID sets never use Σ counts as |E|.
 */
export function buildHourlyDetailBuckets(input: {
  E: Set<string>;
  D: Set<string>;
  calls: Map<string, HourlyDetailCallRow>;
}): Map<string, HourlyDetailBucket> {
  const { E, D, calls } = input;
  const buckets = new Map<string, HourlyDetailBucket>();
  const unionIds = new Set<string>([...E, ...D]);

  for (const callId of unionIds) {
    const call = calls.get(callId);
    if (!call) continue;
    const hour = shanghaiHourFloor(call.ts);
    const grade = accessGrade(call.tool);
    const kind = call.inquiryKind;
    const roles = attributeRoles({
      matchedRoleId: call.matchedRoleId,
      roleIds: call.roleIds
    });

    for (const roleId of roles) {
      for (const src of call.sources) {
        const meta: HourlyDetailBucketMeta = {
          hour,
          agentId: call.userId,
          roleId,
          connectionId: src.connectionId,
          schema: src.schema,
          table: src.table,
          inquiryKind: kind,
          accessGrade: grade
        };
        const key = packHourlyDetailKey(meta);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { meta, allow: new Set(), deny: new Set() };
          buckets.set(key, bucket);
        }
        if (E.has(callId)) bucket.allow.add(callId);
        if (D.has(callId)) bucket.deny.add(callId);
      }
    }
  }

  return buckets;
}

/** Derive E／D from access-layer audit rows (already band-filtered to B). */
export function bandSetsFromAuditRows(rows: HourlyDetailAuditRow[]): {
  E: Set<string>;
  D: Set<string>;
} {
  const E = new Set<string>();
  const D = new Set<string>();
  for (const row of rows) {
    if (row.outcome === "allow") E.add(row.callId);
    else D.add(row.callId);
  }
  return { E, D };
}

/**
 * Scope on detail rows: exact field match (same params as applyScopeFilters).
 */
export function applyScopeToDetailBuckets(
  buckets: Iterable<HourlyDetailBucket>,
  query: HourlyDetailQueryScope
): HourlyDetailBucket[] {
  const list = [...buckets];
  return list.filter((bucket) => {
    const { meta } = bucket;
    if (query.agent !== null && meta.agentId !== query.agent) return false;
    if (query.role !== null && meta.roleId !== query.role) return false;
    if (query.connection !== null && meta.connectionId !== query.connection) return false;
    if (query.table !== null) {
      const parsed = splitTableParam(query.table);
      if (!parsed) return false;
      if (
        meta.connectionId !== parsed.connectionId ||
        meta.schema !== parsed.schema ||
        meta.table !== parsed.sourceName
      ) {
        return false;
      }
    }
    return true;
  });
}

function detailRowMatchesFocusEntity(
  meta: HourlyDetailBucketMeta,
  entity: DetailFocusEntity | null
): boolean {
  if (!entity) return false;
  switch (entity.kind) {
    case "agent":
      return entity.agentId != null && meta.agentId === entity.agentId;
    case "role":
      return entity.roleId != null && meta.roleId === entity.roleId;
    case "connection":
      return entity.connectionId != null && meta.connectionId === entity.connectionId;
    case "schema":
      return (
        entity.connectionId != null &&
        entity.schema != null &&
        meta.connectionId === entity.connectionId &&
        meta.schema === entity.schema
      );
    case "table":
      return (
        entity.connectionId != null &&
        entity.schema != null &&
        entity.table != null &&
        meta.connectionId === entity.connectionId &&
        meta.schema === entity.schema &&
        meta.table === entity.table
      );
    default:
      return false;
  }
}

/**
 * Focus projection: keep buckets intersecting focused access-edge call IDs;
 * for Agent／role／connection／schema／table focus also keep matching deny-only rows.
 */
export function projectDetailBucketsWithFocus(
  buckets: HourlyDetailBucket[],
  focus: DetailFocusContext | null
): HourlyDetailBucket[] {
  if (!focus) return buckets;
  return buckets.filter((bucket) => {
    for (const id of bucket.allow) {
      if (focus.accessCallIds.has(id)) return true;
    }
    for (const id of bucket.deny) {
      if (focus.accessCallIds.has(id)) return true;
    }
    // Deny-only (or any) rows matching the focused entity key fields.
    return detailRowMatchesFocusEntity(bucket.meta, focus.entity);
  });
}

function compareNullableInquiry(
  a: InquiryKind | null,
  b: InquiryKind | null
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Spec §5.4 total order (stable). */
export function sortHourlyDetailBuckets(list: HourlyDetailBucket[]): HourlyDetailBucket[] {
  return [...list].sort((left, right) => {
    const a = left.meta;
    const b = right.meta;
    if (a.hour !== b.hour) return a.hour < b.hour ? -1 : 1;
    if (a.agentId !== b.agentId) return a.agentId < b.agentId ? -1 : 1;
    if (a.roleId !== b.roleId) return a.roleId < b.roleId ? -1 : 1;
    if (a.connectionId !== b.connectionId) return a.connectionId < b.connectionId ? -1 : 1;
    if (a.schema !== b.schema) return a.schema < b.schema ? -1 : 1;
    if (a.table !== b.table) return a.table < b.table ? -1 : 1;
    const kindCmp = compareNullableInquiry(a.inquiryKind, b.inquiryKind);
    if (kindCmp !== 0) return kindCmp;
    if (a.accessGrade !== b.accessGrade) return a.accessGrade < b.accessGrade ? -1 : 1;
    return 0;
  });
}

export function pageHourlyDetail(
  buckets: HourlyDetailBucket[],
  pagination: { limit: number; offset: number }
): AccessMapHourlyDetail {
  const sorted = sortHourlyDetailBuckets(buckets);
  const totalRowCount = sorted.length;
  const limit = pagination.limit;
  const offset = pagination.offset;
  const slice = sorted.slice(offset, offset + limit);
  return {
    rows: slice.map((bucket) => ({
      ...bucket.meta,
      allowCalls: bucket.allow.size,
      denyCalls: bucket.deny.size
    })),
    hasMore: offset + slice.length < totalRowCount,
    totalRowCount,
    limit,
    offset
  };
}

/** End-to-end detail build from access rows + optional focus (after scope). */
export function buildAccessMapHourlyDetail(input: {
  rows: HourlyDetailAuditRow[];
  query: HourlyDetailQueryScope;
  focus: DetailFocusContext | null;
  detailLimit: number;
  detailOffset: number;
}): AccessMapHourlyDetail {
  const { E, D } = bandSetsFromAuditRows(input.rows);
  const calls = groupAuditRowsToHourlyCalls({ rows: input.rows, E, D });
  const buckets = buildHourlyDetailBuckets({ E, D, calls });
  const scoped = applyScopeToDetailBuckets(buckets.values(), input.query);
  const projected = projectDetailBucketsWithFocus(scoped, input.focus);
  return pageHourlyDetail(projected, {
    limit: input.detailLimit,
    offset: input.detailOffset
  });
}
