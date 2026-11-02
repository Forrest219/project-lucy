/**
 * Spec 20261101 §4.1 / D27 — `gov.*` 过滤器解析与剥离。
 *
 * Proxy 在 lucy_query 进入语义／KTX 之前必须剥光全部 `gov.*`（SC-22）。
 * 旧源 `ops_calls`／`ops_call_tables` 出现任一 `gov.*` → invalid_arguments（N01）。
 */

import {
  buildCalendarDayWindow,
  buildMetricWindow,
  GOVERNANCE_CALENDAR_TZ,
  type MetricWindow
} from "../admin/metric-window.js";
import {
  isOpsEvidenceLegacySource,
  OPS_EVIDENCE_CONNECTION_ID
} from "./contract.js";

export const GOV_WINDOW_HOURS = new Set([24, 168]);
export const GOV_CALENDAR_DAYS = new Set([7, 30]);
export const GOV_TRUST_VALUES = new Set(["confirmed", "include_candidate"]);

export type GovTrust = "confirmed" | "include_candidate";

export interface GovFocus {
  agent?: string;
  role?: string;
  table?: string;
  tokenLabel?: string;
}

export interface ParsedGovFilters {
  window: MetricWindow;
  /** Which window kind was selected (or default). */
  windowKind: "window_hours" | "calendar_days" | "iso_range" | "default_calendar_30";
  trust: GovTrust;
  focus: GovFocus;
  /** Remaining non-gov filters (array form). */
  rowFilters: unknown[];
}

export type GovFilterError = { code: "invalid_arguments"; reason: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function filterFieldName(item: unknown): string | undefined {
  if (typeof item === "string") {
    const trimmed = item.trim();
    // String filters like `gov.calendar_days = 30` — take left of operator.
    const match = trimmed.match(/^([A-Za-z0-9_.$]+)/);
    return match?.[1];
  }
  if (isPlainRecord(item) && typeof item.field === "string") {
    return item.field.trim();
  }
  return undefined;
}

function isGovField(field: string | undefined): boolean {
  return typeof field === "string" && field.startsWith("gov.");
}

function scalarValue(item: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(item, "value")) return item.value;
  if (Array.isArray(item.values) && item.values.length > 0) return item.values[0];
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

function normalizeFilterItems(filters: unknown): unknown[] {
  if (filters === undefined || filters === null) return [];
  return Array.isArray(filters) ? [...filters] : [filters];
}

/**
 * 从 filters 中剥离全部 `gov.*`，校验名单／互斥，并解析窗／trust／focus。
 *
 * @returns ParsedGovFilters 或 invalid_arguments
 */
export function parseAndStripGovFilters(
  filters: unknown,
  options: {
    connectionId?: string | null;
    sourceName?: string | null;
    asOf?: Date;
    defaultTrust?: GovTrust;
  } = {}
): ParsedGovFilters | GovFilterError {
  const items = normalizeFilterItems(filters);
  const govItems: Array<Record<string, unknown>> = [];
  const rowFilters: unknown[] = [];

  for (const item of items) {
    const field = filterFieldName(item);
    if (isGovField(field)) {
      if (!isPlainRecord(item) || typeof item.field !== "string") {
        return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_filter_must_be_object" };
      }
      govItems.push(item);
    } else {
      rowFilters.push(item);
    }
  }

  const connectionId =
    typeof options.connectionId === "string" ? options.connectionId.trim() : "";
  const sourceName =
    typeof options.sourceName === "string" ? options.sourceName.trim() : "";
  const isLucyOps = connectionId === OPS_EVIDENCE_CONNECTION_ID;
  const hasGov = govItems.length > 0;

  // 非 lucy-ops：若仍带 gov.* → invalid（避免泄漏到其它连接）。
  if (!isLucyOps) {
    if (hasGov) {
      return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_filters_only_on_lucy_ops" };
    }
    return {
      window: buildCalendarDayWindow(30, GOVERNANCE_CALENDAR_TZ, options.asOf ?? new Date()),
      windowKind: "default_calendar_30",
      trust: options.defaultTrust ?? "confirmed",
      focus: {},
      rowFilters: items
    };
  }

  // 旧源：任何 gov.* → invalid；跳过快照路径。
  if (isOpsEvidenceLegacySource(sourceName)) {
    if (hasGov) {
      return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_filters_not_allowed_on_legacy_ops_source" };
    }
    return {
      window: buildCalendarDayWindow(30, GOVERNANCE_CALENDAR_TZ, options.asOf ?? new Date()),
      windowKind: "default_calendar_30",
      trust: options.defaultTrust ?? "confirmed",
      focus: {},
      rowFilters
    };
  }

  // 治理源或缺省：解析 gov.*
  const asOf = options.asOf ?? new Date();
  let windowHours: number | undefined;
  let calendarDays: number | undefined;
  let calendarTz = GOVERNANCE_CALENDAR_TZ;
  let startIso: string | undefined;
  let endIso: string | undefined;
  let trust: GovTrust = options.defaultTrust ?? "confirmed";
  const focus: GovFocus = {};

  for (const item of govItems) {
    const field = String(item.field).trim();
    const value = scalarValue(item);
    switch (field) {
      case "gov.window_hours": {
        const n = asNumber(value);
        if (n === undefined || !GOV_WINDOW_HOURS.has(n)) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_window_hours_invalid" };
        }
        windowHours = n;
        break;
      }
      case "gov.calendar_days": {
        const n = asNumber(value);
        if (n === undefined || !GOV_CALENDAR_DAYS.has(n)) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_calendar_days_invalid" };
        }
        calendarDays = n;
        break;
      }
      case "gov.calendar_tz": {
        const tz = asNonEmptyString(value);
        if (!tz) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_calendar_tz_invalid" };
        }
        calendarTz = tz;
        break;
      }
      case "gov.start_iso": {
        const iso = asNonEmptyString(value);
        if (!iso || Number.isNaN(Date.parse(iso))) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_start_iso_invalid" };
        }
        startIso = new Date(iso).toISOString();
        break;
      }
      case "gov.end_iso": {
        const iso = asNonEmptyString(value);
        if (!iso || Number.isNaN(Date.parse(iso))) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_end_iso_invalid" };
        }
        endIso = new Date(iso).toISOString();
        break;
      }
      case "gov.trust": {
        const t = asNonEmptyString(value);
        if (!t || !GOV_TRUST_VALUES.has(t)) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_trust_invalid" };
        }
        trust = t as GovTrust;
        break;
      }
      case "gov.focus_agent": {
        const v = asNonEmptyString(value);
        if (!v) return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_focus_agent_invalid" };
        focus.agent = v;
        break;
      }
      case "gov.focus_role": {
        const v = asNonEmptyString(value);
        if (!v) return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_focus_role_invalid" };
        focus.role = v;
        break;
      }
      case "gov.focus_table": {
        const v = asNonEmptyString(value);
        if (!v) return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_focus_table_invalid" };
        focus.table = v;
        break;
      }
      case "gov.focus_token_label": {
        const v = asNonEmptyString(value);
        if (!v) {
          return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_focus_token_label_invalid" };
        }
        focus.tokenLabel = v;
        break;
      }
      default:
        return {
          code: "invalid_arguments",
          reason: `invalid_arguments:lucy_query:unknown_gov_filter:${field}`
        };
    }
  }

  // calendar_tz without calendar_days when no other window → invalid
  const hasCalendarTzOnly =
    govItems.some((item) => String(item.field).trim() === "gov.calendar_tz") &&
    calendarDays === undefined &&
    windowHours === undefined &&
    startIso === undefined &&
    endIso === undefined;
  if (hasCalendarTzOnly) {
    return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_calendar_tz_requires_calendar_days" };
  }

  const kinds =
    (windowHours !== undefined ? 1 : 0) +
    (calendarDays !== undefined ? 1 : 0) +
    (startIso !== undefined || endIso !== undefined ? 1 : 0);

  if (kinds > 1) {
    return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_window_kinds_conflict" };
  }

  if ((startIso !== undefined) !== (endIso !== undefined)) {
    return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_iso_range_must_be_paired" };
  }

  let window: MetricWindow;
  let windowKind: ParsedGovFilters["windowKind"];

  if (windowHours !== undefined) {
    window = buildMetricWindow(windowHours, asOf);
    windowKind = "window_hours";
  } else if (calendarDays !== undefined) {
    window = buildCalendarDayWindow(calendarDays, calendarTz, asOf);
    windowKind = "calendar_days";
  } else if (startIso !== undefined && endIso !== undefined) {
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      return { code: "invalid_arguments", reason: "invalid_arguments:lucy_query:gov_iso_range_empty" };
    }
    window = { startIso, endIso, asOf: asOf.toISOString() };
    windowKind = "iso_range";
  } else {
    // 缺省窗：治理源 calendar_days=30 上海（D24）
    window = buildCalendarDayWindow(30, GOVERNANCE_CALENDAR_TZ, asOf);
    windowKind = "default_calendar_30";
  }

  return { window, windowKind, trust, focus, rowFilters };
}

/** Assert stripped filters contain no gov.* (SC-22). Throws if any remain. */
export function assertNoGovFiltersRemain(filters: unknown): void {
  for (const item of normalizeFilterItems(filters)) {
    const field = filterFieldName(item);
    if (isGovField(field)) {
      throw new Error(`gov filter leaked to upstream: ${field}`);
    }
  }
}

/**
 * Apply strip result onto a lucy_query args record.
 * Returns new args with filters replaced by rowFilters only.
 */
export function applyStrippedGovFilters(
  args: Record<string, unknown>,
  parsed: ParsedGovFilters
): Record<string, unknown> {
  const next = { ...args };
  if (parsed.rowFilters.length === 0) {
    delete next.filters;
  } else if (parsed.rowFilters.length === 1 && !Array.isArray(args.filters)) {
    next.filters = parsed.rowFilters[0];
  } else {
    next.filters = parsed.rowFilters;
  }
  assertNoGovFiltersRemain(next.filters);
  return next;
}
