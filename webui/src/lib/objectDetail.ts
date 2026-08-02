// M36: Object Detail Drawer URL state.
//
// The drawer is URL-driven so any module can open the same drawer by
// updating query params. Keeping parsing / building in one place lets
// callers (Catalog, AgentList, RunList, Audit, ...) share a stable contract
// without re-implementing the param layout.

export type ObjectDetailKind = "table" | "agent" | "evalRun" | "auditEvent";

export const SUPPORTED_OBJECT_KINDS: ObjectDetailKind[] = [
  "table",
  "agent",
  "evalRun",
  "auditEvent"
];

export type ObjectDetailTarget =
  | { kind: "table"; conn: string; schema: string; table: string }
  | { kind: "agent"; agentId: string }
  | { kind: "evalRun"; runId: number }
  | { kind: "auditEvent"; eventId: number };

const QUERY_OBJECT = "object";
const QUERY_CONN = "conn";
const QUERY_SCHEMA = "schema";
const QUERY_TABLE = "table";
const QUERY_AGENT = "agentId";
const QUERY_RUN = "runId";
const QUERY_EVENT = "eventId";

/**
 * Parse a `window.location.search` style string into a typed drawer target.
 * Returns `null` when the search string does not carry a recognised object
 * kind — callers should treat that as "drawer closed".
 */
export function parseObjectDetailSearch(search: string): ObjectDetailTarget | null {
  if (!search || search === "?") return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const kind = params.get(QUERY_OBJECT);
  if (!kind) return null;
  switch (kind) {
    case "table": {
      const conn = params.get(QUERY_CONN);
      const schema = params.get(QUERY_SCHEMA);
      const table = params.get(QUERY_TABLE);
      if (!conn || !schema || !table) return null;
      return { kind: "table", conn, schema, table };
    }
    case "agent": {
      const agentId = params.get(QUERY_AGENT);
      if (!agentId) return null;
      return { kind: "agent", agentId };
    }
    case "evalRun": {
      const raw = params.get(QUERY_RUN);
      if (!raw) return null;
      const runId = Number.parseInt(raw, 10);
      if (!Number.isFinite(runId)) return null;
      return { kind: "evalRun", runId };
    }
    case "auditEvent": {
      const raw = params.get(QUERY_EVENT);
      if (!raw) return null;
      const eventId = Number.parseInt(raw, 10);
      if (!Number.isFinite(eventId)) return null;
      return { kind: "auditEvent", eventId };
    }
    default:
      return null;
  }
}

function buildObjectDetailParams(target: ObjectDetailTarget): URLSearchParams {
  const params = new URLSearchParams();
  params.set(QUERY_OBJECT, target.kind);
  switch (target.kind) {
    case "table":
      params.set(QUERY_CONN, target.conn);
      params.set(QUERY_SCHEMA, target.schema);
      params.set(QUERY_TABLE, target.table);
      break;
    case "agent":
      params.set(QUERY_AGENT, target.agentId);
      break;
    case "evalRun":
      params.set(QUERY_RUN, String(target.runId));
      break;
    case "auditEvent":
      params.set(QUERY_EVENT, String(target.eventId));
      break;
  }
  return params;
}

/**
 * Build a query string (with leading `?`) that opens the drawer for the
 * given target. The string can be passed to `?object=...` style navigation
 * helpers or merged into an existing search.
 */
export function buildObjectDetailSearch(target: ObjectDetailTarget): string {
  return `?${buildObjectDetailParams(target).toString()}`;
}

/**
 * Build a URLSearchParams that preserves existing params but overrides the
 * drawer-related ones. Returns a fresh URLSearchParams so callers can pass
 * the result straight to `setSearchParams`.
 */
export function mergeObjectDetailSearch(
  existing: URLSearchParams,
  target: ObjectDetailTarget
): URLSearchParams {
  const next = new URLSearchParams(existing.toString());
  for (const key of [QUERY_OBJECT, QUERY_CONN, QUERY_SCHEMA, QUERY_TABLE, QUERY_AGENT, QUERY_RUN, QUERY_EVENT]) {
    next.delete(key);
  }
  for (const [key, value] of buildObjectDetailParams(target).entries()) {
    next.set(key, value);
  }
  return next;
}

/**
 * Returns the search string with all drawer-related params stripped.
 * Use this when the user closes the drawer so the URL no longer carries
 * an `object=` payload.
 */
export function clearObjectDetailSearch(search: string): string {
  if (!search) return "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of [QUERY_OBJECT, QUERY_CONN, QUERY_SCHEMA, QUERY_TABLE, QUERY_AGENT, QUERY_RUN, QUERY_EVENT]) {
    params.delete(key);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

/**
 * Title shown at the top of the drawer. Centralised so we can keep "table
 * name" / "agent id" / "run #42" / "audit event #12" consistent across the
 * MVP and any future drawer payload.
 */
export function objectDetailTitle(target: ObjectDetailTarget): string {
  switch (target.kind) {
    case "table":
      return target.table;
    case "agent":
      return target.agentId;
    case "evalRun":
      return `Run #${target.runId}`;
    case "auditEvent":
      return `审计事件 #${target.eventId}`;
  }
}
