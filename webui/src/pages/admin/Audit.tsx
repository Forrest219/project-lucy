import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { apiGet } from "../../lib/apiClient";
import { copyTextWithToast } from "../../lib/clipboard";
import { formatConfigAuditTs } from "../../lib/configAuditLabels";
import { mergeObjectDetailSearch } from "../../lib/objectDetail";
import { useUrlMirroredField } from "../../lib/useUrlMirroredField";
import type {
  Agent,
  AuditLogEntry,
  AuditPrimaryStatus,
  AuditResponse,
  AuditTurnDetailResponse,
  AuditTurnEntry,
  AuditTurnsResponse
} from "../../lib/types";
import { callMonitorWindow } from "../../lib/callMonitorWindow";
import { PageHeader } from "../../components/PageHeader";
import { DecisionReasonCell } from "../../components/DecisionReasonCell";
import {
  AssociationRevisionTimeline,
  AuditStatusTriad,
  AuditTopMetaBar,
  ClientCoveragePill,
  CredentialPrincipalCell,
  ReadonlySqlRowset,
  type AssociationRevisionTimelineItem
} from "../../components/audit-trust";
import {
  associationAxisFrom,
  coverageAxisFrom,
  executionAxisFrom,
  LEGACY_OUTCOME_LABELS,
  PRIMARY_STATUS_ORDER,
  primaryStatusLabel,
  primaryStatusPalette,
  sqlRowsetStatusFrom
} from "../../lib/auditTrust";

// 202608-01 — Trace / Evidence Kernel read model
type LucySpanTypeView =
  | "reindex"
  | "mcp_initialize"
  | "mcp_tools_list"
  | "mcp_tools_call"
  | "policy_decision"
  | "ktx_retrieval"
  | "sql_plan"
  | "sql_execute"
  | "eval_run"
  | "publish_gate"
  | "copilot_candidate";

type LucySpanStatusView = "ok" | "error" | "denied" | "running";

interface PolicyDecisionView {
  allowed: boolean;
  reason?: string;
  toolName?: string;
  permissionSnapshotHash?: string;
  matchedRule?: string;
  source?: "access_policy" | "rate_limit" | "tool_exposure" | "wiki_acl" | "other";
}

interface TraceEventView {
  id: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  spanType: LucySpanTypeView;
  actorKind: string;
  actorId?: string;
  status: LucySpanStatusView;
  startedAt: string;
  endedAt?: string;
  sessionId?: string;
  turnId?: string;
  requestId?: string;
  policyDecision?: PolicyDecisionView;
  artifactHashes: string[];
  metadata: Record<string, unknown>;
}

interface TraceEvidenceView {
  id: number;
  traceEventId?: number;
  traceId: string;
  evidenceKind: string;
  evidenceRef: string;
  evidenceVersion?: string;
  evidenceHash?: string;
  relation: "observed" | "used" | "denied_by" | "superseded" | "reviewer_override" | "promoted";
  metadata: Record<string, unknown>;
}

interface TraceResponse {
  ok: boolean;
  data?: { events: TraceEventView[]; evidence: TraceEvidenceView[] };
}

const STATUS_LABEL: Record<LucySpanStatusView, string> = {
  ok: "成功",
  error: "错误",
  denied: "拒绝",
  running: "进行中"
};

const RELATION_LABEL: Record<TraceEvidenceView["relation"], string> = {
  observed: "观测到",
  used: "被使用",
  denied_by: "被拒绝依据",
  superseded: "已替代",
  reviewer_override: "审核覆盖",
  promoted: "已晋升"
};

/**
 * Detect a metadata value that has already been redacted at write time by
 * the trace/evidence kernel. The kernel writes the literal string
 * "[REDACTED]" for sensitive keys (e.g. password, secret) and for value-side
 * patterns (e.g. "password=…", "Bearer …"). The viewer uses this to render
 * a tooltip on redacted entries so admins know the field was scrubbed,
 * without ever re-reading or re-displaying the underlying value.
 */
function isRedactedMarker(value: unknown): value is string {
  return typeof value === "string" && value === "[REDACTED]";
}

function isRedactedMetaKey(key: string): boolean {
  return (
    /(password|passwd|pwd|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)/i.test(key) ||
    // Raw payload keys are also redacted in metadata, matching the
    // evidence_events.kind blacklist (raw_sql_ast | raw_token |
    // raw_result_row | full_question_payload) — keeping the surface
    // consistent so the kernel's "never store raw payloads" rule
    // also applies to span metadata.
    /^(raw_sql_ast|raw_token|raw_result_row|full_question_payload)$/i.test(key) ||
    // Token-like keys: redact any field whose name contains "token"
    // except the well-known semantic fields ("token_usage", "tokenCount",
    // "tokenLabel") which the kernel guarantees do not carry secrets.
    (/\btoken\b/i.test(key) &&
      !/token_(usage|count|label)|tokenusage|tokencount|tokenlabel/i.test(key))
  );
}

function formatPolicySource(source: PolicyDecisionView["source"]): string {
  if (!source) return "—";
  switch (source) {
    case "access_policy":
      return "访问策略";
    case "rate_limit":
      return "限流";
    case "tool_exposure":
      return "工具暴露控制";
    case "wiki_acl":
      return "Wiki ACL";
    case "other":
      return "其他";
    default:
      return source;
  }
}

function orderSpansByTopology(events: TraceEventView[]): TraceEventView[] {
  // Order: root spans first (parentSpanId == null) sorted by startedAt,
  // then descendants by startedAt. Within a sibling group preserve
  // startedAt order so the timeline reads top-to-bottom.
  const byId = new Map<string, TraceEventView>();
  for (const ev of events) byId.set(ev.spanId, ev);
  const sorted = [...events].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const childrenOf = new Map<string | null, TraceEventView[]>();
  for (const ev of sorted) {
    const key = ev.parentSpanId && byId.has(ev.parentSpanId) ? ev.parentSpanId : null;
    const list = childrenOf.get(key) ?? [];
    list.push(ev);
    childrenOf.set(key, list);
  }
  const ordered: TraceEventView[] = [];
  const visit = (parentKey: string | null) => {
    const list = childrenOf.get(parentKey) ?? [];
    for (const ev of list) {
      ordered.push(ev);
      visit(ev.spanId);
    }
  };
  visit(null);
  return ordered;
}

function groupEvidenceByKind(evidence: TraceEvidenceView[]): Array<[string, TraceEvidenceView[]]> {
  const grouped = new Map<string, TraceEvidenceView[]>();
  for (const ev of evidence) {
    const list = grouped.get(ev.evidenceKind) ?? [];
    list.push(ev);
    grouped.set(ev.evidenceKind, list);
  }
  // Sort: largest group first, then alpha
  return Array.from(grouped.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });
}

function MetaEntryRow({ entryKey, value }: { entryKey: string; value: unknown }) {
  return (
    <>
      <span className="pl-trace-detail-meta-key">{entryKey}</span>
      <MetaValue value={value} keyName={entryKey} />
    </>
  );
}

function MetaValue({ value, keyName }: { value: unknown; keyName: string }) {
  if (isRedactedMarker(value) || isRedactedMetaKey(keyName)) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="pl-trace-detail-meta-redacted" data-testid={`trace-meta-redacted-${keyName}`}>
            [REDACTED]
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="rounded bg-fg-default px-2 py-1 text-xs text-bg-base shadow-card"
            sideOffset={4}
            data-testid={`trace-meta-redacted-tooltip-${keyName}`}
          >
            敏感字段已在写入 trace 时脱敏,无法在此查看原值。
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }
  if (value === null || value === undefined) {
    return <span className="pl-trace-detail-meta-value text-fg-muted">—</span>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="pl-trace-detail-meta-value">{String(value)}</span>;
  }
  return (
    <code className="pl-trace-detail-meta-value break-all rounded bg-bg-muted px-1.5 py-0.5 text-[11px]">
      {JSON.stringify(value)}
    </code>
  );
}

function PolicyBlock({ policy }: { policy: PolicyDecisionView }) {
  const allowedClass = policy.allowed
    ? "pl-trace-detail-policy-allowed"
    : "pl-trace-detail-policy-denied";
  return (
    <div className="pl-trace-detail-policy" data-testid="trace-span-policy">
      <div className="pl-trace-detail-policy-title text-xs font-semibold text-fg-muted">策略裁决</div>
      <div className={allowedClass} data-testid="trace-span-policy-allowed">
        {policy.allowed ? "✓ 允许" : "✗ 拒绝"}
      </div>
      {policy.source ? (
        <div className="pl-trace-detail-policy-row">
          <span className="pl-trace-detail-policy-key">来源</span>
          <span className="pl-trace-detail-policy-value" data-testid="trace-span-policy-source">
            {formatPolicySource(policy.source)}
          </span>
        </div>
      ) : null}
      {policy.matchedRule ? (
        <div className="pl-trace-detail-policy-row">
          <span className="pl-trace-detail-policy-key">规则</span>
          <span className="pl-trace-detail-policy-value">{policy.matchedRule}</span>
        </div>
      ) : null}
      {policy.reason ? (
        <div className="pl-trace-detail-policy-row">
          <span className="pl-trace-detail-policy-key">原因</span>
          <span className="pl-trace-detail-policy-value">{policy.reason}</span>
        </div>
      ) : null}
      {policy.toolName ? (
        <div className="pl-trace-detail-policy-row">
          <span className="pl-trace-detail-policy-key">工具</span>
          <span className="pl-trace-detail-policy-value">{policy.toolName}</span>
        </div>
      ) : null}
      {policy.permissionSnapshotHash ? (
        <div className="pl-trace-detail-policy-row">
          <span className="pl-trace-detail-policy-key">快照</span>
          <span className="pl-trace-detail-policy-value">{policy.permissionSnapshotHash}</span>
        </div>
      ) : null}
    </div>
  );
}

function SpanBlock({ event, isRoot }: { event: TraceEventView; isRoot: boolean }) {
  const statusClass =
    event.status === "ok"
      ? "pl-status-done"
      : event.status === "denied"
        ? "pl-status-partial"
        : event.status === "error"
          ? "pl-status-validation_failed"
          : "pl-status-pending";
  const artifactHashes = event.artifactHashes ?? [];
  const metaEntries = Object.entries(event.metadata ?? {});
  return (
    <div
      className={isRoot ? "pl-trace-detail-span-root" : "pl-trace-detail-span"}
      data-testid={`trace-span-${event.spanId}`}
      data-span-type={event.spanType}
      data-span-status={event.status}
    >
      <div className="pl-trace-detail-span-header">
        <span className="pl-trace-detail-span-type notranslate" translate="no">
          {event.spanType}
        </span>
        <span className={`pl-status-badge ${statusClass}`}>{STATUS_LABEL[event.status]}</span>
        <span className="text-fg-muted font-mono notranslate" translate="no">
          {event.spanId}
        </span>
        {event.actorId ? (
          <span className="text-fg-muted">
            · <span className="notranslate" translate="no">{event.actorKind}</span>{" "}
            <span className="notranslate" translate="no">
              {event.actorId}
            </span>
          </span>
        ) : null}
        <span className="ml-auto text-fg-muted">
          {event.startedAt ? new Date(event.startedAt).toLocaleString("zh-CN") : "—"}
          {event.endedAt ? ` → ${new Date(event.endedAt).toLocaleTimeString("zh-CN")}` : ""}
        </span>
      </div>
      {event.policyDecision ? <PolicyBlock policy={event.policyDecision} /> : null}
      {artifactHashes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" data-testid="trace-span-artifacts">
          <span className="text-fg-muted">Artifact:</span>
          {artifactHashes.map((hash) => (
            <span key={hash} className="pl-trace-detail-hash notranslate" translate="no" title={hash}>
              {hash.slice(0, 16)}…
            </span>
          ))}
        </div>
      ) : null}
      {metaEntries.length > 0 ? (
        <div className="pl-trace-detail-meta-grid">
          {metaEntries.map(([key, value]) => (
            <MetaEntryRow key={key} entryKey={key} value={value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Read-only trace inspector. Renders the kernel view model in a right-side
 * Drawer; never raw args, raw SQL AST, or full question payload. P0-CLOSE-01
 * upgrades the inline disclosure to a Drawer so admins can explain a single
 * access decision (allowed/denied) from the audit page alone, without
 * falling back to the API. Pairs with /api/admin/trace/events.
 */
export function TraceLink({ traceId }: { traceId: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["admin", "trace", "events", traceId],
    queryFn: () => apiGet<TraceResponse>(`/api/admin/trace/events?traceId=${encodeURIComponent(traceId)}`),
    enabled: open && Boolean(traceId)
  });

  const orderedSpans = useMemo(
    () => (query.data?.data ? orderSpansByTopology(query.data.data.events) : []),
    [query.data]
  );
  const evidenceGroups = useMemo(
    () => (query.data?.data ? groupEvidenceByKind(query.data.data.evidence) : []),
    [query.data]
  );
  const totalSpans = query.data?.data?.events.length ?? 0;
  const totalEvidence = query.data?.data?.evidence.length ?? 0;

  return (
    <span className="ml-2">
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid={`audit-trace-link-${traceId}`}
          >
            查看 Trace
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="pl-trace-detail-overlay" />
          <Dialog.Content
            className="pl-trace-detail-content"
            aria-describedby={`trace-detail-${traceId}-desc`}
            data-testid={`audit-trace-drawer-${traceId}`}
          >
            <header className="pl-trace-detail-header pl-trace-detail-header--toolbar">
              <div>
                <Dialog.Title className="pl-trace-detail-title" data-testid="trace-detail-title">
                  Trace 详情
                </Dialog.Title>
                <p
                  className="pl-trace-detail-trace-id notranslate font-mono text-xs text-fg-muted"
                  translate="no"
                  data-testid="trace-detail-trace-id"
                >
                  {traceId}
                </p>
                <Dialog.Description
                  id={`trace-detail-${traceId}-desc`}
                  className="pl-trace-detail-subtitle"
                >
                  只读核查链路 · {totalSpans}{" "}
                  <span className="notranslate" translate="no">
                    Span
                  </span>{" "}
                  · {totalEvidence}{" "}
                  <span className="notranslate" translate="no">
                    Evidence
                  </span>
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost pl-trace-detail-close text-xs"
                  data-testid="trace-detail-close"
                  aria-label="关闭 Trace 详情"
                >
                  关闭
                </button>
              </Dialog.Close>
            </header>

            {query.isLoading ? (
              <div className="pl-notice" data-testid="trace-detail-loading">加载中…</div>
            ) : null}
            {query.error ? (
              <div className="pl-notice pl-status-validation_failed" data-testid="trace-detail-error">
                Trace 加载失败:{(query.error as Error).message}
              </div>
            ) : null}
            {query.data?.data ? (
              <>
                {orderedSpans.length === 0 && evidenceGroups.length === 0 ? (
                  <div className="pl-audit-drawer-empty" data-testid="trace-detail-empty">
                    该 Trace 暂无 Span 或 Evidence 记录。
                  </div>
                ) : null}
                {orderedSpans.length > 0 ? (
                  <section className="pl-trace-detail-section" data-testid="trace-detail-spans">
                    <h3 className="pl-trace-detail-section-title">有序 Span</h3>
                    {orderedSpans.map((event) => (
                      <SpanBlock
                        key={event.spanId}
                        event={event}
                        isRoot={!event.parentSpanId}
                      />
                    ))}
                  </section>
                ) : null}
                {evidenceGroups.length > 0 ? (
                  <section className="pl-trace-detail-section" data-testid="trace-detail-evidence">
                    <h3 className="pl-trace-detail-section-title">
                      <span className="notranslate" translate="no">
                        Evidence Ref
                      </span>
                    </h3>
                    {evidenceGroups.map(([kind, list]) => (
                      <div key={kind} className="pl-trace-detail-evidence-group">
                        <h4 className="text-xs font-semibold text-fg-muted">
                          <span className="notranslate" translate="no">
                            {kind}
                          </span>{" "}
                          · {list.length}
                        </h4>
                        {list.map((ev) => (
                          <div
                            key={ev.id}
                            className="pl-trace-detail-evidence-row"
                            data-testid={`trace-evidence-${ev.id}`}
                          >
                            <span
                              className="pl-trace-detail-evidence-kind notranslate"
                              translate="no"
                            >
                              {ev.evidenceKind}
                            </span>
                            <span className="pl-trace-detail-evidence-relation">
                              {RELATION_LABEL[ev.relation] ?? ev.relation}
                            </span>
                            <span
                              className="pl-trace-detail-evidence-ref notranslate"
                              translate="no"
                              title={ev.evidenceRef}
                            >
                              {ev.evidenceRef}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                ) : null}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}

/**
 * 旧三桶 outcome。**只作 legacy 直方图**，不作为执行状态展示
 * （B27 / Spec §4.3(a) 规则 9：旧 `outcome=ok` 不推定成功）。
 * 执行状态一律用八桶 `primaryStatus` + 三条独立判断轴。
 */
const OUTCOME_LABELS = LEGACY_OUTCOME_LABELS;
const PAGE_SIZE = 50;

function playgroundReplayHref(entry: Pick<AuditLogEntry, "userId" | "tool" | "argsSummary">): string {
  const params = new URLSearchParams({
    agentId: entry.userId,
    tool: entry.tool,
    mode: "dry-run"
  });
  if (entry.argsSummary && typeof entry.argsSummary === "object") {
    try {
      params.set("args", JSON.stringify(entry.argsSummary));
    } catch {
      // ignore non-serializable args
    }
  }
  return `/admin/mcp-playground?${params.toString()}`;
}
type AuditTab = "turns" | "calls";
type WindowHours = 1 | 24 | 168 | 720;
type RangePreset = "1h" | "24h" | "7d" | "30d";
type TimePreset = "1h" | "24h" | "7d" | "30d" | "today" | "custom";

const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  "1h": "近 1 小时",
  "24h": "近 24 小时",
  "7d": "近 7 天",
  "30d": "近 30 天",
  "today": "今日",
  "custom": "自定义"
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

function formatStatsTimeLabel(statsAt: Date | null, now: Date): string {
  if (!statsAt) return "未知";
  const diffMs = now.getTime() - statsAt.getTime();
  if (diffMs < 5_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} 秒前`;
  if (diffMs < 15 * 60_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(statsAt.getHours())}:${pad(statsAt.getMinutes())}:${pad(statsAt.getSeconds())}`;
}

/** Spec 106 + Spec 165: prefer `range=1h|24h|7d|30d`; accept legacy `hours=1|24|168|720`. */
function parseRangePreset(searchParams: URLSearchParams): RangePreset {
  const range = searchParams.get("range");
  if (range === "1h" || range === "24h" || range === "7d" || range === "30d") return range;
  const hours = searchParams.get("hours");
  if (hours === "1") return "1h";
  if (hours === "24") return "24h";
  if (hours === "720") return "30d";
  return "7d";
}

function rangeToHours(range: RangePreset): WindowHours {
  if (range === "1h") return 1;
  if (range === "24h") return 24;
  if (range === "30d") return 720;
  return 168;
}

function sinceForRange(range: RangePreset, now = new Date()): string {
  if (range === "30d") {
    return toLocalDateTimeValue(new Date(callMonitorWindow("30d", now).since));
  }
  return sinceLocalFromHours(rangeToHours(range), now);
}

/** Spec 106: prefer `view=turns|calls`; accept legacy `tab=`. */
function parseAuditView(searchParams: URLSearchParams): AuditTab {
  const view = searchParams.get("view");
  if (view === "calls" || view === "turns") return view;
  const tab = searchParams.get("tab");
  return tab === "calls" ? "calls" : "turns";
}

/** Local `YYYY-MM-DDTHH:mm` for datetime-local inputs (browser timezone). */
function toLocalDateTimeValue(date: Date): string {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function sinceLocalFromHours(hours: WindowHours, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setHours(d.getHours() - hours, 0, 0, 0);
  return toLocalDateTimeValue(d);
}

/** Convert datetime-local value to UTC ISO for API / CSV. */
function localDateTimeValueToIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function AuditDateTime({ value }: { value: string }) {
  const formatted = formatConfigAuditTs(value);
  const lastSpace = formatted.lastIndexOf(" ");
  const date = lastSpace > 0 ? formatted.slice(0, lastSpace) : formatted;
  const time = lastSpace > 0 ? formatted.slice(lastSpace + 1) : "—";
  return (
    <span className="pl-audit-date-time">
      <span data-part="date">{date}</span>
      <span data-part="time">{time}</span>
    </span>
  );
}

function formatAgentLabel(agentId: string, nameById: Map<string, string>): string {
  const name = nameById.get(agentId);
  if (!name || name === agentId) return agentId;
  return `${name} (${agentId})`;
}

/** Resolve filter text to a single agent id when name/id uniquely matches. */
function resolveAgentFilterParam(input: string, agents: Agent[]): string {
  const needle = input.trim().toLowerCase();
  if (!needle) return "";
  const exactId = agents.find((agent) => agent.id.toLowerCase() === needle);
  if (exactId) return exactId.id;
  const exactName = agents.find((agent) => agent.name.toLowerCase() === needle);
  if (exactName) return exactName.id;
  const partial = agents.filter(
    (agent) => agent.id.toLowerCase().includes(needle) || agent.name.toLowerCase().includes(needle)
  );
  if (partial.length === 1) return partial[0].id;
  return input.trim();
}

function CopyableId({ value, testId, label, shortDisplay = false }: { value: string; testId: string; label: string; shortDisplay?: boolean }) {
  const displayValue = shortDisplay && value.length > 14
    ? `${value.slice(0, 12)}…`
    : value;
  return (
    <button
      type="button"
      className="pl-audit-id-copy notranslate font-mono text-xs text-fg-body"
      translate="no"
      title={value}
      aria-label={`复制${label} ${value}`}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        void copyTextWithToast(value, {
          successMessage: `已复制${label}`,
          failureMessage: "复制失败，请重试"
        });
      }}
    >
      {displayValue}
    </button>
  );
}

/**
 * 涉及数据表清单。
 *
 * E7：**不截断**、不写「等 N 个」——完整清单必须可见（可复制）。
 * 单表直接显示；多表用换行 + 分隔符逐个列出。
 */
function formatTablesCell(sources: AuditTurnEntry["sources"]): string {
  const tables = sources.map((s) => s.physicalTable).filter(Boolean);
  if (tables.length === 0) return "—";
  return tables.join("、");
}

/**
 * 问询行的八桶主状态（非零桶，按八桶固定顺序）。
 *
 * 一次问询聚合多次调用，因此**不合成单一结论** —— 逐桶列出真实计数。
 * 历史行没有 primary_status 时，八桶全部落在 `unknown`。
 */
function turnStatusBuckets(entry: AuditTurnEntry): Array<{ bucket: AuditPrimaryStatus; count: number }> {
  const counts = entry.primaryStatusSummary;
  if (!counts) return [];
  return PRIMARY_STATUS_ORDER.map((bucket) => ({ bucket, count: counts[bucket] ?? 0 })).filter(
    (item) => item.count > 0
  );
}

const TURN_SOURCE_FILTER_TITLE =
  "来源类型：用户原始问询为客户端上报。没有原文的查数问询摘要固定为「未上报问询原文」，会话访问以「会话建立：」开头。两者都不等同于用户原话。";

/** Spec 135: ID-like input routes to `key`; free text routes to turnSearch / tableSearch. */
function looksLikeIdQuery(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (/^lucy_/i.test(value)) return true;
  if (/^(inf_|turn_)/i.test(value)) return true;
  if (/^\d+$/.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return true;
  }
  return false;
}

function TurnSourceBadge({ source }: { source: AuditTurnEntry["source"] }) {
  if (source === "reported") {
    return <span className="pl-status-badge pl-status-done">已上报问询</span>;
  }
  return (
    <span className="pl-status-badge pl-status-partial" title="没有客户端上报的原文，不等同于用户原话">
      推断问询
    </span>
  );
}

function TurnDetailDrawer({
  turnId,
  hours,
  open,
  onOpenChange,
  agentNameById
}: {
  turnId: string | null;
  hours: WindowHours;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentNameById: Map<string, string>;
}) {
  const query = useQuery({
    queryKey: ["admin", "audit", "turn", turnId, hours],
    queryFn: () => apiGet<AuditTurnDetailResponse>(`/api/admin/audit/turns/${encodeURIComponent(turnId ?? "")}?hours=${hours}`),
    enabled: open && Boolean(turnId)
  });
  const detail = query.data;
  const drawerSources = Array.isArray(detail?.sources)
    ? (detail.sources as Array<{ connectionId?: string; physical_table?: string; physicalTable?: string }>)
    : [];
  // 关联修订（只读）。历史更正**不改写原始账本**，因此这里展示时间线，
  // 最新一条是生效视图，更早的是历史。
  const revisionsQuery = useQuery({
    queryKey: ["admin", "audit", "association-revisions", turnId],
    queryFn: () =>
      apiGet<{ data: AssociationRevisionTimelineItem[] }>(
        `/api/admin/audit/association-revisions?originalTurnId=${encodeURIComponent(turnId ?? "")}&limit=50`
      ),
    enabled: open && Boolean(turnId)
  });
  const revisions = revisionsQuery.data?.data ?? [];
  // 最早一条修订的 pre-image = 准入时记录的原始关联状态（不可变）。
  const originalAssociation = revisions.length > 0 ? revisions[revisions.length - 1]?.originalAssociationStatus ?? null : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-trace-detail-overlay" />
        <Dialog.Content className="pl-trace-detail-content" data-testid="audit-turn-drawer">
          <header className="pl-trace-detail-header pl-trace-detail-header--toolbar">
            <div>
              <Dialog.Title className="pl-trace-detail-title">问询详情</Dialog.Title>
              <Dialog.Description className="pl-trace-detail-subtitle">
                {detail?.userId ? (
                  <>
                    <span className="notranslate" translate="no">{formatAgentLabel(detail.userId, agentNameById)}</span>
                    {detail.source ? <> · <TurnSourceBadge source={detail.source} /></> : null}
                  </>
                ) : "加载中…"}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="pl-btn pl-btn--ghost pl-trace-detail-close text-xs" aria-label="关闭问询详情" data-testid="audit-turn-drawer-close">
                关闭
              </button>
            </Dialog.Close>
          </header>

          {query.isLoading ? <div className="pl-notice">加载中…</div> : null}
          {query.error ? (
            <div className="pl-notice pl-status-validation_failed">{(query.error as Error).message}</div>
          ) : null}

          {detail ? (
            <>
              {detail.source === "inferred" ? (
                <section className="pl-card text-xs text-fg-muted" data-testid="audit-turn-inferred-disclaimer">
                  没有客户端上报的原文。问询摘要不是用户原话，涉及的数据表见明细。
                </section>
              ) : null}

              <section className="pl-card grid gap-2 text-xs" data-testid="audit-turn-meta-card">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
                  {detail.startedAt || detail.createdAt ? (
                    <span>开始 {formatConfigAuditTs(detail.startedAt ?? detail.createdAt ?? "")}</span>
                  ) : null}
                  {detail.endedAt ? <span>结束 {formatConfigAuditTs(detail.endedAt)}</span> : null}
                  {detail.client ? (
                    <span>客户端 <span className="notranslate" translate="no">{detail.client}</span></span>
                  ) : null}
                  {detail.sessionId ? (
                    <span>会话 ID <span className="notranslate" translate="no">{detail.sessionId}</span></span>
                  ) : null}
                  {typeof detail.linkedCallCount === "number" ? (
                    <span>关联调用 {detail.linkedCallCount}</span>
                  ) : null}
                  {typeof detail.businessCallCount === "number" ? (
                    <span>工具调用 {detail.businessCallCount}</span>
                  ) : null}
                </div>
              </section>

              {(detail.questionSummary || detail.questionPreview) ? (
                <section className="pl-card grid gap-2" data-testid="audit-turn-summary-card">
                  <h3 className="text-sm font-semibold text-fg-default">问询摘要</h3>
                  <p className="text-sm text-fg-muted">{detail.questionPreview ?? detail.questionSummary}</p>
                </section>
              ) : null}

              {/* 关联修订时间线（只读）。历史更正**不改写原始账本**：
                  生效视图与历史修订分开展示，准入时的原始状态单列。 */}
              <section className="pl-card grid gap-2" data-testid="audit-turn-association-revisions">
                <h3 className="text-sm font-semibold text-fg-default">关联修订</h3>
                <AssociationRevisionTimeline
                  revisions={revisions}
                  originalFromAccessLog={originalAssociation}
                />
              </section>

              {drawerSources.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="audit-turn-tables-inline">
                  <span className="text-fg-muted whitespace-nowrap">触达表：</span>
                  {/* E7：默认**全部展开**，不再截断为前 4 个、不写「+N 更多」。
                      完整清单必须可见（管理员要据此判断范围）。 */}
                  {drawerSources.map((source, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 rounded bg-bg-muted px-2 py-0.5 font-mono text-fg-default notranslate"
                      translate="no"
                    >
                      {source.connectionId ? <span className="text-fg-muted">{source.connectionId} ·</span> : null}
                      <span>{source.physicalTable ?? source.physical_table ?? "—"}</span>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs h-6 px-1.5"
                    data-testid="audit-turn-tables-copy"
                    onClick={() => {
                      void copyTextWithToast(
                        drawerSources
                          .map((source) => `${source.connectionId ? `${source.connectionId} · ` : ""}${source.physicalTable ?? source.physical_table ?? ""}`)
                          .join("、"),
                        { successMessage: "已复制触达表清单", failureMessage: "复制失败，请重试" }
                      );
                    }}
                  >
                    复制清单
                  </button>
                </div>
              ) : null}

              <section className="pl-card grid gap-3" data-testid="audit-turn-calls-card">
                <h3 className="text-sm font-semibold text-fg-default">调用明细</h3>
                <div className="overflow-x-auto">
                  <table className="pl-data-grid pl-data-table pl-audit-table w-full" data-testid="audit-turn-calls-table">
                    <thead>
                      <tr>
                        <th className="w-14 whitespace-nowrap">序号</th>
                        <th className="whitespace-nowrap">时间</th>
                        <th className="whitespace-nowrap">数据库连接</th>
                        <th>涉及数据表</th>
                        <th className="whitespace-nowrap min-w-[80px]">状态</th>
                        <th className="whitespace-nowrap min-w-[140px]">耗时</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.accessLogs.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-fg-muted">暂无调用记录</td></tr>
                      ) : (
                        detail.accessLogs.map((log, index) => (
                          <tr key={log.id}>
                            <td className="pl-audit-table-num">{index + 1}</td>
                            <td className="pl-audit-table-muted whitespace-nowrap">{formatConfigAuditTs(log.ts)}</td>
                            <td className="notranslate whitespace-nowrap" translate="no">{log.connectionId ?? "—"}</td>
                            <td className="pl-audit-table-muted notranslate" translate="no">{log.tables?.join(", ") ?? "—"}</td>
                            <td className="whitespace-nowrap">
                              <span className={`pl-status-badge ${log.outcome === "ok" ? "pl-status-done" : log.outcome === "denied" ? "pl-status-partial" : "pl-status-validation_failed"}`}>
                                {OUTCOME_LABELS[log.outcome as keyof typeof OUTCOME_LABELS] ?? log.outcome}
                              </span>
                            </td>
                            <td className="whitespace-nowrap min-w-[140px]">
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <span className="tabular-nums font-mono">{log.durationMs} ms</span>
                                {log.isSlowCall ? (
                                  <span className="pl-status-badge pl-status-partial text-[11px] px-1.5 whitespace-nowrap">慢于多数请求</span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              {log.traceId ? <TraceLink traceId={log.traceId} /> : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * localStorage key for the Audit page's last-used filter snapshot. We
 * persist only the "non-shareable" filter values (the most-recent tab and
 * the last non-empty filter values) so users can come back to the page
 * and see what they were investigating, but URL params still drive the
 * shareable surface.
 */
const AUDIT_FILTER_STORAGE_KEY = "lucy:webui:audit:filters:v3";
const FILTER_PERSIST_FIELDS = [
  "view",
  "range",
  "user",
  "tool",
  "outcome",
  "tokenHashPrefix",
  "tableSearch",
  "key",
  "sessionId",
  "turnId",
  "platform",
  "turnSource",
  "turnSearch",
  "callSource",
  "clientIp",
  "deviceName"
] as const;
/** Reserved lucy_platform value for MCP 调试台受控试调 (must match server MCP_PLAYGROUND_PLATFORM). */
const MCP_PLAYGROUND_PLATFORM = "mcp-playground";

function formatCallOriginLabel(platform: string | undefined): { kind: "playground" | "agent"; label: string } {
  if (platform === MCP_PLAYGROUND_PLATFORM) {
    return { kind: "playground", label: "受控试调" };
  }
  return { kind: "agent", label: "Agent 接入调用" };
}
type FilterSnapshot = Partial<Record<(typeof FILTER_PERSIST_FIELDS)[number], string>>;

function readFilterSnapshot(): FilterSnapshot {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AUDIT_FILTER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as FilterSnapshot;
  } catch {
    return {};
  }
}

function writeFilterSnapshot(snapshot: FilterSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIT_FILTER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage may be disabled (e.g. private mode); fall back to URL-only.
  }
}

/**
 * Persist one filter field into the last-used snapshot. The stored value is
 * the **raw** text the user typed — the URL keeps the raw text too, so the
 * snapshot and the URL stay in sync (Spec §7.1).
 */
function persistFilterSnapshot(key: string, value: string) {
  if (!(FILTER_PERSIST_FIELDS as readonly string[]).includes(key)) return;
  const snapshot = readFilterSnapshot();
  if (value) snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]] = value;
  else delete snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]];
  writeFilterSnapshot(snapshot);
}
const SENSITIVE_KEY = /(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)/i;
const SENSITIVE_PAIR = /\b(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)\b\s*[:=]\s*([^,\s;]+)/gi;

function buildQuery(params: Record<string, string | undefined | number | boolean>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(nested)
      ])
    );
  }
  return value;
}

function redactErrorDetail(detail: string) {
  const firstLine = detail.split("\n")[0] ?? detail;
  return firstLine.replace(SENSITIVE_PAIR, "$1=[REDACTED]");
}

const USER_AGENT_LIST_MAX = 40;

function truncateUserAgent(value: string, max = USER_AGENT_LIST_MAX): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function AuditDetailField({
  label,
  children,
  labelClassName
}: {
  label: ReactNode;
  children: ReactNode;
  labelClassName?: string;
}) {
  return (
    <div className="pl-audit-detail-field">
      <div className={`pl-audit-detail-label ${labelClassName ?? ""}`}>{label}</div>
      <div className="pl-audit-detail-value">{children}</div>
    </div>
  );
}

function AuditDetailSection({
  title,
  children,
  testId,
  wide
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <section className={`pl-audit-detail-section${wide ? " pl-audit-detail-section--wide" : ""}`} data-testid={testId}>
      <h4 className="pl-audit-detail-section-title">{title}</h4>
      <div className="pl-audit-detail-section-body">{children}</div>
    </section>
  );
}

function AccessContextCell({
  clientIp,
  userAgent,
  testId
}: {
  clientIp?: string;
  userAgent?: string;
  testId?: string;
}) {
  return (
    <div className="pl-audit-access-context" data-testid={testId}>
      <span className="pl-audit-access-context-ip notranslate font-mono" translate="no">
        {clientIp || "—"}
      </span>
      <span
        className="pl-audit-access-context-ua notranslate"
        translate="no"
        title={userAgent || undefined}
      >
        {userAgent ? truncateUserAgent(userAgent) : "—"}
      </span>
    </div>
  );
}

function EntryRow({
  entry,
  index,
  agentNameById,
  onOpenTurn
}: {
  entry: AuditLogEntry;
  index: number;
  agentNameById: Map<string, string>;
  onOpenTurn: (turnId: string) => void;
}) {
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  // 八桶主状态（不是旧三桶 outcome）。历史行 → unknown。
  const primaryStatus = entry.primaryStatus ?? "unknown";
  const redactedArgs = entry.argsSummary ? redactValue(entry.argsSummary) : null;
  const callOrigin = formatCallOriginLabel(entry.lucyPlatform);
  const auditEventHref = {
    search: mergeObjectDetailSearch(searchParams, { kind: "auditEvent", eventId: entry.id }).toString()
  };
  const agentHref = {
    search: mergeObjectDetailSearch(searchParams, { kind: "agent", agentId: entry.userId }).toString()
  };
  const clientLabel =
    entry.client
      ? `${entry.client}${entry.clientVersion ? ` ${entry.clientVersion}` : ""}`
      : null;
  const hasQueryAudit = Boolean(entry.queryHash || entry.queryPreview);
  const hasResponseScale =
    entry.responseBytes !== undefined
    || entry.responseRowCount !== undefined
    || entry.responseColumnCount !== undefined;

  return (
    <>
      <tr className="pl-audit-row" onClick={() => setExpanded(!expanded)}>
        <td className="pl-audit-table-num">{index}</td>
        <td className="pl-audit-table-muted whitespace-nowrap">
          <AuditDateTime value={entry.ts} />
        </td>
        <td className="pl-audit-table-mono">
          <div className="flex flex-col items-start gap-1">
            <CopyableId value={String(entry.id)} testId={`audit-event-id-${entry.id}`} label="事件 ID" />
            <Link
              to={auditEventHref}
              state={{ initialAuditEntry: entry }}
              className="pl-inline-link notranslate text-xs"
              translate="no"
              aria-label={`查看审计事件 #${entry.id} 的对象详情`}
              data-testid={`audit-row-detail-${entry.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              查看详情
            </Link>
          </div>
        </td>
        <td className="pl-audit-table-mono whitespace-nowrap">
          {entry.lucyTurnId ? (
            <button
              type="button"
              className="pl-inline-link notranslate font-mono text-xs"
              translate="no"
              data-testid={`audit-call-turn-id-${entry.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenTurn(entry.lucyTurnId!);
              }}
            >
              {entry.lucyTurnId}
            </button>
          ) : entry.inferredTurnId ? (
            <button
              type="button"
              className="pl-inline-link notranslate font-mono text-xs"
              translate="no"
              title="推断问询 ID"
              data-testid={`audit-call-inferred-turn-id-${entry.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenTurn(entry.inferredTurnId!);
              }}
            >
              {entry.inferredTurnId}
            </button>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </td>
        <td className="notranslate" translate="no" data-testid={`audit-call-agent-${entry.id}`}>
          {/* 原 Agent 列保留**产品 Agent 含义**；「凭证主体」并列说明，
              不用 token 备注替换 Agent（20261019 §5）。 */}
          <div className="flex flex-col items-start gap-1">
            <span>{formatAgentLabel(entry.userId, agentNameById)}</span>
            <CredentialPrincipalCell
              userId={entry.credentialPrincipalId ?? entry.userId}
              hint={
                entry.credentialPrincipalId && entry.credentialPrincipalId !== entry.userId
                  ? "凭证主体"
                  : "凭证主体（未单独登记，等同 Agent 主体）"
              }
            />
          </div>
        </td>
        <td>
          <AccessContextCell
            clientIp={entry.clientIp}
            userAgent={entry.userAgent}
            testId={`audit-access-context-${entry.id}`}
          />
          <ClientCoveragePill
            observed={coverageAxisFrom(entry) === "observed"}
            reason={coverageAxisFrom(entry) === "observed" ? undefined : "no_client_observation"}
          />
        </td>
        <td>
          <div className="flex flex-col items-start gap-1" data-testid={`audit-status-cell-${entry.id}`}>
            {/* 八桶主状态（B27）。旧 outcome 只作 legacy 说明，不是执行状态。 */}
            <span
              className={`pl-status-badge ${primaryStatusPalette(primaryStatus)}`}
              data-testid={`audit-primary-status-${entry.id}`}
              data-primary-status={primaryStatus}
            >
              {primaryStatusLabel(primaryStatus)}
            </span>
            {/* 三条独立判断轴：执行 / 关联 / 覆盖互不推导。
                执行成功**不会**让关联或覆盖变成绿色已完成。 */}
            <AuditStatusTriad
              execution={executionAxisFrom(entry)}
              association={associationAxisFrom(entry.associationStatus)}
              coverage={coverageAxisFrom(entry)}
            />
          </div>
        </td>
        <td className="pl-audit-table-muted">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="tabular-nums">{entry.durationMs}ms</span>
            {entry.usageSlowCall ? (
              <span
                className="pl-status-badge pl-status-partial text-[11px] px-1.5 whitespace-nowrap"
                data-testid={`audit-usage-slow-${entry.id}`}
              >
                问询慢标记
              </span>
            ) : null}
          </span>
        </td>
        <td className="pl-audit-table-mono">{entry.tool}</td>
        <td className="pl-audit-table-muted">{entry.tables?.join(", ")}</td>
        <td className="pl-audit-table-muted">
          <DecisionReasonCell code={entry.decisionReason} />
          {entry.outcome === "denied" ? (
            <Link
              to={playgroundReplayHref(entry)}
              className="pl-inline-link notranslate mt-1 inline-block text-xs"
              translate="no"
              data-testid={`audit-replay-playground-${entry.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              在调试台复现
            </Link>
          ) : null}
        </td>
        <td>
          {callOrigin.kind === "playground" ? (
            <span className="pl-status-badge pl-status-partial" data-testid={`audit-call-source-playground-${entry.id}`}>
              {callOrigin.label}
            </span>
          ) : (
            <span className="text-fg-muted notranslate" translate="no" data-testid={`audit-call-source-agent-${entry.id}`}>
              {callOrigin.label}
            </span>
          )}
        </td>
        <td className="pl-audit-generated-sql max-w-md">
          {entry.generatedSql ? (
            <code
              className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-xs notranslate"
              translate="no"
              data-testid={`audit-generated-sql-${entry.id}`}
            >
              {entry.generatedSql}
            </code>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
          {/* 返回规模：行 / 列 / 字节。缺值按**六值空值原因**展示，
              未知不得写成 0（20261019 §4.4 / U2）。
              组件与既有「生成 SQL」入口**并存**，不替换其可发现性。 */}
          <ReadonlySqlRowset
            rows={entry.responseRowCount ?? null}
            cols={entry.responseColumnCount ?? null}
            bytes={entry.responseBytes ?? null}
            status={sqlRowsetStatusFrom(
              entry.responseRowCount !== undefined && entry.responseRowCount !== null,
              entry.nullReason
            )}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={13} className="px-3 py-3 text-xs">
            <div className="pl-audit-detail-panels" data-testid={`audit-detail-panels-${entry.id}`}>
              <AuditDetailSection title="调用方" testId={`audit-detail-caller-${entry.id}`}>
                <AuditDetailField
                  label={
                    <>
                      关联 <span className="notranslate" translate="no">Agent</span>
                    </>
                  }
                >
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Link
                      to={agentHref}
                      className="pl-inline-link notranslate"
                      translate="no"
                      aria-label={`查看 Agent ${entry.userId} 的对象详情`}
                      data-testid={`audit-related-agent-${entry.id}`}
                    >
                      查看 Agent 详情
                    </Link>
                    {entry.userId ? (
                      <span className="font-mono text-fg-muted notranslate" translate="no">
                        ({entry.userId})
                      </span>
                    ) : null}
                  </span>
                </AuditDetailField>
                <AuditDetailField
                  label={<span className="notranslate" translate="no">Token</span>}
                >
                  <span className="text-fg-muted">
                    {entry.tokenLabel || entry.tokenHashPrefix ? (
                      <>
                        {entry.tokenLabel ?? "—"}
                        {entry.tokenHashPrefix ? (
                          <span className="font-mono"> ({entry.tokenHashPrefix}…)</span>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </AuditDetailField>
                <AuditDetailField label="访问 IP">
                  <span className="font-mono notranslate" translate="no">{entry.clientIp || "—"}</span>
                </AuditDetailField>
                <AuditDetailField
                  label={<span className="notranslate" translate="no">User-Agent</span>}
                >
                  <span className="notranslate break-all" translate="no">{entry.userAgent || "—"}</span>
                </AuditDetailField>
                <AuditDetailField label="客户端">
                  {clientLabel ? (
                    <span className="notranslate" translate="no">{clientLabel}</span>
                  ) : (
                    "—"
                  )}
                </AuditDetailField>
                <AuditDetailField label="最近设备名">
                  {entry.deviceName ? (
                    <span className="notranslate" translate="no">{entry.deviceName}</span>
                  ) : (
                    "—"
                  )}
                </AuditDetailField>
              </AuditDetailSection>

              <AuditDetailSection title="裁决与权限" testId={`audit-detail-decision-${entry.id}`}>
                <AuditDetailField label="角色">
                  <span className="text-fg-muted">{entry.roleIds?.join(", ") || "—"}</span>
                </AuditDetailField>
                <AuditDetailField label="权限快照">
                  <span className="text-fg-muted">
                    {entry.permissionSnapshotHash ? (
                      <span className="font-mono">{entry.permissionSnapshotHash.slice(0, 16)}…</span>
                    ) : (
                      "—"
                    )}
                    {entry.effectiveTablesCount !== undefined ? ` · ${entry.effectiveTablesCount} 张有效表` : ""}
                  </span>
                </AuditDetailField>
                {entry.outcome === "denied" ? (
                  <div>
                    <Link
                      to={playgroundReplayHref(entry)}
                      className="pl-inline-link notranslate"
                      translate="no"
                    >
                      在调试台复现
                    </Link>
                  </div>
                ) : null}
              </AuditDetailSection>

              <AuditDetailSection title="请求与结果" testId={`audit-detail-request-${entry.id}`} wide>
                <AuditDetailField label="Args">
                  {redactedArgs !== null ? (
                    <code>{JSON.stringify(redactedArgs)}</code>
                  ) : (
                    "—"
                  )}
                </AuditDetailField>
                <AuditDetailField label="错误" labelClassName={entry.errorDetail ? "text-danger" : undefined}>
                  {entry.errorDetail ? (
                    <span className="text-fg-muted">{redactErrorDetail(entry.errorDetail)}</span>
                  ) : (
                    "—"
                  )}
                </AuditDetailField>
                {hasQueryAudit ? (
                  <AuditDetailField label="Query 审计">
                    <span className="text-fg-muted">
                      {entry.queryOperation ?? "unknown"}
                      {entry.queryLength !== undefined ? ` · ${entry.queryLength} chars` : ""}
                      {entry.queryHash ? <span className="font-mono"> · {entry.queryHash.slice(0, 16)}…</span> : ""}
                    </span>
                    {entry.queryPreview ? <code className="mt-1 block">{entry.queryPreview}</code> : null}
                  </AuditDetailField>
                ) : null}
                <AuditDetailField label="返回规模">
                  {hasResponseScale ? (
                    <span className="text-fg-muted">
                      {entry.responseBytes !== undefined ? `${entry.responseBytes} bytes` : "—"}
                      {entry.responseRowCount !== undefined ? ` · ${entry.responseRowCount} rows` : ""}
                      {entry.responseColumnCount !== undefined ? ` · ${entry.responseColumnCount} cols` : ""}
                      {entry.responseTruncated ? " · truncated" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </AuditDetailField>
              </AuditDetailSection>

              <AuditDetailSection title="关联取证" testId={`audit-detail-forensics-${entry.id}`}>
                <AuditDetailField label="请求 ID">
                  <span className="inline-flex flex-wrap items-center gap-2 font-mono text-fg-muted">
                    {entry.requestId}
                    {entry.traceId ? <TraceLink traceId={entry.traceId} /> : null}
                  </span>
                </AuditDetailField>
                <AuditDetailField label="关联会话">
                  <span className="text-fg-muted">
                    {entry.lucyPlatform ? (
                      <>
                        <span
                          className={entry.lucyPlatform === MCP_PLAYGROUND_PLATFORM ? undefined : "notranslate"}
                          translate={entry.lucyPlatform === MCP_PLAYGROUND_PLATFORM ? undefined : "no"}
                        >
                          {entry.lucyPlatform === MCP_PLAYGROUND_PLATFORM
                            ? formatCallOriginLabel(entry.lucyPlatform).label
                            : entry.lucyPlatform}
                        </span>
                        {" · "}
                      </>
                    ) : null}
                    {entry.lucySessionId ? <span className="font-mono">{entry.lucySessionId}</span> : "—"}
                    {entry.lucyTurnId ? <span className="font-mono"> / {entry.lucyTurnId}</span> : ""}
                  </span>
                </AuditDetailField>
              </AuditDetailSection>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Audit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [hasHydratedFromStorage, setHasHydratedFromStorage] = useState(false);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(searchParams.get("turnId"));
  const [turnDrawerOpen, setTurnDrawerOpen] = useState(Boolean(searchParams.get("turnId")));
  const [now, setNow] = useState(() => new Date());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /**
   * 刷新状态。暂停时**冻结**筛选与序列上界：后台不得换范围、不得把更新的
   * 数据悄悄塞进来（20261019 §5「暂停固定筛选和序列上界，不能后台换范围」）。
   */
  const [refreshPaused, setRefreshPaused] = useState(false);
  const [timePreset, setTimePreset] = useState<TimePreset>(() => parseRangePreset(searchParams));

  const user = searchParams.get("user") ?? "";
  const tool = searchParams.get("tool") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const tokenHashPrefix = searchParams.get("tokenHashPrefix") ?? "";
  const tableSearch = searchParams.get("tableSearch") ?? "";
  const sessionId = searchParams.get("sessionId") ?? "";
  const clientIp = searchParams.get("clientIp") ?? "";
  const deviceNameFilter = searchParams.get("deviceName") ?? "";
  const keySearch = searchParams.get("key") ?? searchParams.get("turnIdFilter") ?? "";
  const platform = searchParams.get("platform") ?? "";
  const callSource = searchParams.get("callSource") ?? "";
  const turnSource = searchParams.get("turnSource") ?? "";
  const turnSearch = searchParams.get("turnSearch") ?? "";
  const includeProtocol = searchParams.get("includeProtocol") === "true" || callSource === "playground";
  const slowOnly = searchParams.get("slowOnly") === "1";
  const tab = parseAuditView(searchParams);
  const range = parseRangePreset(searchParams);
  const hours = rangeToHours(range);

  // ── 局部状态镜像（Spec §5.2／§5.3）──────────────────────────────────────
  //
  // 这 7 个筛选栏文本输入框的 `value` 一律由**本地 state** 驱动，URL 作为下游
  // 事实源跟随。直接把 `value={searchParams.get(...)}` 绑上去会让 React 在旧 URL 值
  // 渲染的那一帧写 `node.value`，Chrome 随即取消进行中的 IME 组合
  // （Spec §1.3）。反向同步走回声协议：只有 POP 与真正的外部 PUSH／REPLACE
  // 才写草稿，自身回声与晚到的旧值都不写（Spec §5.3）。
  const userMirror = useUrlMirroredField({
    read: (sp) => sp.get("user") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("user", raw);
      else next.delete("user");
      return next;
    },
    history: "push"
  });
  const toolMirror = useUrlMirroredField({
    read: (sp) => sp.get("tool") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("tool", raw);
      else next.delete("tool");
      return next;
    },
    history: "push"
  });
  const sessionIdMirror = useUrlMirroredField({
    read: (sp) => sp.get("sessionId") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("sessionId", raw);
      else next.delete("sessionId");
      return next;
    },
    history: "push"
  });
  const clientIpMirror = useUrlMirroredField({
    read: (sp) => sp.get("clientIp") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("clientIp", raw);
      else next.delete("clientIp");
      return next;
    },
    history: "push"
  });
  const deviceNameMirror = useUrlMirroredField({
    read: (sp) => sp.get("deviceName") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("deviceName", raw);
      else next.delete("deviceName");
      return next;
    },
    history: "push"
  });
  const tableSearchMirror = useUrlMirroredField({
    read: (sp) => sp.get("tableSearch") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("tableSearch", raw);
      else next.delete("tableSearch");
      return next;
    },
    history: "push"
  });
  /**
   * 统一搜索：一个输入框聚合 `key`（含遗留 `turnIdFilter`）／`turnSearch`／
   * `tableSearch`。`read` 保持既有聚合口径；`write` 仍按 `looksLikeIdQuery`
   * 与当前 tab 分派，但写入**原文**（不再 trim）。
   */
  const unifiedSearchMirror = useUrlMirroredField({
    read: (sp) => {
      const key = sp.get("key") ?? sp.get("turnIdFilter") ?? "";
      const turnSearch = sp.get("turnSearch") ?? "";
      const tableSearchValue = sp.get("tableSearch") ?? "";
      return key || (tab === "turns" ? turnSearch : tableSearchValue);
    },
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      next.delete("key");
      next.delete("turnIdFilter");
      next.delete("turnSearch");
      if (tab === "calls") next.delete("tableSearch");
      if (raw) {
        if (looksLikeIdQuery(raw)) next.set("key", raw);
        else if (tab === "turns") next.set("turnSearch", raw);
        else next.set("tableSearch", raw);
      }
      return next;
    },
    history: "push"
  });

  useEffect(() => {
    if (hasHydratedFromStorage) return;
    if (searchParams.toString().length > 0) {
      setHasHydratedFromStorage(true);
      return;
    }
    const snapshot = readFilterSnapshot();
    if (Object.keys(snapshot).length === 0) {
      setHasHydratedFromStorage(true);
      return;
    }
    const next = new URLSearchParams(searchParams);
    for (const field of FILTER_PERSIST_FIELDS) {
      const value = snapshot[field];
      if (value) next.set(field, value);
    }
    // Migrate legacy snapshot keys
    const legacy = snapshot as Record<string, string>;
    if (legacy.tab && !next.get("view")) next.set("view", legacy.tab);
    if (legacy.hours === "24") next.set("range", "24h");
    else if (legacy.hours === "168") next.set("range", "7d");
    setSearchParams(next, { replace: true });
    setHasHydratedFromStorage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydratedFromStorage]);

  const sinceDefault = sinceForRange(range);
  const [since, setSince] = useState(sinceDefault);
  const [until, setUntil] = useState("");

  useEffect(() => {
    setSince(sinceForRange(range));
    setTimePreset(range);
    setPage(0);
  }, [hours, range]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function updateParam(key: string, value: string) {
    // 函数式更新：从 prev 拷贝后再改本字段，禁止闭包快照（Spec §5.2 写入契约）。
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      // Drop legacy aliases when writing canonical keys
      if (key === "view") next.delete("tab");
      if (key === "range") next.delete("hours");
      if (key === "key") next.delete("turnIdFilter");
      return next;
    });
    setPage(0);
    persistFilterSnapshot(key, value);
  }

  /**
   * Mirror-backed text change. The raw text goes into the local draft and into
   * the URL (no trim / case / split / filter — INV-2); the snapshot stores the
   * same raw text so URL and snapshot agree (Spec §7.1).
   */
  function applyMirroredText(
    mirror: { onChange: (raw: string) => void },
    raw: string,
    snapshotKey?: string
  ) {
    mirror.onChange(raw);
    setPage(0);
    if (snapshotKey) persistFilterSnapshot(snapshotKey, raw);
  }

  /**
   * Unified search snapshot. The dispatch mirrors the URL write: ID-like →
   * `key`, otherwise `turnSearch` (turns) / `tableSearch` (calls).
   */
  function persistUnifiedSearchSnapshot(raw: string) {
    const snapshot = readFilterSnapshot();
    delete snapshot.key;
    delete snapshot.turnSearch;
    if (tab === "calls") delete snapshot.tableSearch;
    if (raw) {
      if (looksLikeIdQuery(raw)) snapshot.key = raw;
      else if (tab === "turns") snapshot.turnSearch = raw;
      else snapshot.tableSearch = raw;
    }
    writeFilterSnapshot(snapshot);
  }

  /** Spec 135: single search box — ID-like → key; else turnSearch (turns) / tableSearch (calls). */
  function applyUnifiedSearch(raw: string) {
    unifiedSearchMirror.onChange(raw);
    setPage(0);
    persistUnifiedSearchSnapshot(raw);
  }

  function setCallSource(nextSource: string) {
    const next = new URLSearchParams(searchParams);
    if (nextSource) next.set("callSource", nextSource);
    else next.delete("callSource");
    if (nextSource === "playground") next.set("includeProtocol", "true");
    else next.delete("includeProtocol");
    setSearchParams(next);
    setPage(0);
    const snapshot = readFilterSnapshot();
    if (nextSource) snapshot.callSource = nextSource;
    else delete snapshot.callSource;
    writeFilterSnapshot(snapshot);
  }

  function applyTimePreset(preset: TimePreset) {
    setTimePreset(preset);
    if (preset === "1h") {
      setUntil("");
      updateParam("range", "1h");
    } else if (preset === "24h") {
      setUntil("");
      updateParam("range", "24h");
    } else if (preset === "7d") {
      setUntil("");
      updateParam("range", "7d");
    } else if (preset === "30d") {
      setUntil("");
      updateParam("range", "30d");
    } else if (preset === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
      setSince(toLocalDateTimeValue(todayStart));
      setUntil(toLocalDateTimeValue(todayEnd));
      setPage(0);
    } else if (preset === "custom") {
      // Show the custom datetime inputs; no auto-calculation
    }
  }

  const drawerTurnId = searchParams.get("turnId") ?? "";

  // Spec 129: on calls view, seed key from turnId once when key is absent.
  useEffect(() => {
    if (tab !== "calls") return;
    if (!drawerTurnId || keySearch) return;
    const next = new URLSearchParams(searchParams);
    next.set("key", drawerTurnId);
    next.delete("turnIdFilter");
    setSearchParams(next, { replace: true });
    const snapshot = readFilterSnapshot();
    snapshot.key = drawerTurnId;
    writeFilterSnapshot(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, drawerTurnId, keySearch]);

  function openTurnDrawer(turnId: string) {
    setSelectedTurnId(turnId);
    setTurnDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set("turnId", turnId);
    if (tab === "calls" && !(searchParams.get("key") ?? searchParams.get("turnIdFilter"))) {
      next.set("key", turnId);
      next.delete("turnIdFilter");
      const snapshot = readFilterSnapshot();
      snapshot.key = turnId;
      writeFilterSnapshot(snapshot);
    }
    setSearchParams(next);
  }

  function handleTurnDrawerOpenChange(open: boolean) {
    setTurnDrawerOpen(open);
    if (!open) {
      setSelectedTurnId(null);
      const next = new URLSearchParams(searchParams);
      next.delete("turnId");
      setSearchParams(next, { replace: true });
    }
  }

  const rangeDefaultSince = sinceForRange(range);
  const hasNonDefaultFilters = Boolean(
    user
      || tool
      || outcome
      || tokenHashPrefix
      || tableSearch
      || keySearch
      || sessionId
      || clientIp
      || deviceNameFilter
      || platform
      || callSource
      || turnSource
      || turnSearch
      || until
      || (since && since !== rangeDefaultSince)
      || slowOnly
      || (includeProtocol && callSource !== "playground")
  );

  function clearFilters() {
    setUntil("");
    setSince(sinceForRange(range));
    setPage(0);
    setAdvancedOpen(false);
    const next = new URLSearchParams();
    if (range) next.set("range", range);
    if (tab === "calls") next.set("view", "calls");
    const keepTurnId = searchParams.get("turnId");
    const keepObject = searchParams.get("object");
    const keepEventId = searchParams.get("eventId");
    if (keepTurnId) next.set("turnId", keepTurnId);
    if (keepObject) next.set("object", keepObject);
    if (keepEventId) next.set("eventId", keepEventId);
    setSearchParams(next);
    // ★ INV-3：只重建 URL 不够。若某个参数本来就是空的，urlValue 不变，反向同步
    // 的 effect 不会跑，输入框会留下旧文本。必须逐个把镜像草稿归零。
    userMirror.reset("");
    toolMirror.reset("");
    sessionIdMirror.reset("");
    clientIpMirror.reset("");
    deviceNameMirror.reset("");
    tableSearchMirror.reset("");
    unifiedSearchMirror.reset("");
    const snapshot = readFilterSnapshot();
    for (const field of FILTER_PERSIST_FIELDS) {
      if (field === "view" || field === "range" || field === "turnId") continue;
      delete snapshot[field];
    }
    if (tab === "calls") snapshot.view = "calls";
    else delete snapshot.view;
    snapshot.range = range;
    writeFilterSnapshot(snapshot);
  }

  const agentsQuery = useQuery({
    queryKey: ["admin", "agents", "names"],
    queryFn: () => apiGet<{ agents: Agent[] }>("/api/admin/agents"),
    staleTime: 60_000
  });

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data?.agents ?? []) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agentsQuery.data]);

  const resolvedUserFilter = resolveAgentFilterParam(user, agentsQuery.data?.agents ?? []);

  const turnsQueryStr = buildQuery({
    user: resolvedUserFilter || undefined,
    source: turnSource === "inferred" || turnSource === "reported" ? turnSource : "all",
    hours,
    since: localDateTimeValueToIso(since),
    until: localDateTimeValueToIso(until),
    // 消费点规范化：URL 与输入框保留原文，发请求前再 trim（SC-23）。
    tableSearch: tableSearch.trim() || undefined,
    turnId: keySearch.trim() || undefined,
    outcome: outcome || undefined,
    q: turnSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const turnsQuery = useQuery({
    queryKey: ["admin", "audit", "turns", turnsQueryStr],
    queryFn: () => apiGet<AuditTurnsResponse>(`/api/admin/audit/turns${turnsQueryStr}`),
    enabled: tab === "turns",
    refetchInterval: refreshPaused ? false : 30_000
  });

  const callsQueryStr = buildQuery({
    user: resolvedUserFilter || user || undefined,
    tokenHashPrefix: tokenHashPrefix || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined,
    since: localDateTimeValueToIso(since),
    until: localDateTimeValueToIso(until),
    tableSearch: tableSearch.trim() || undefined,
    sessionId: sessionId || undefined,
    clientIp: clientIp || undefined,
    deviceName: deviceNameFilter || undefined,
    key: keySearch.trim() || undefined,
    platform: platform || undefined,
    callSource: callSource || undefined,
    includeProtocol,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const callsQuery = useQuery({
    queryKey: ["admin", "audit", "calls", callsQueryStr, slowOnly],
    queryFn: () => apiGet<AuditResponse>(`/api/admin/audit${callsQueryStr}`),
    enabled: tab === "calls",
    refetchInterval: refreshPaused ? false : 30_000
  });

  const turnEntries = turnsQuery.data?.entries ?? [];
  const turnTotal = turnsQuery.data?.total ?? 0;
  const turnSummary = turnsQuery.data?.summary;
  const referenceLatency = turnsQuery.data?.referenceLatency;
  const p95Ms = referenceLatency?.p95Ms ?? 0;

  const filteredTurnEntries = useMemo(() => {
    let rows = turnEntries;
    const agentNeedle = user.trim().toLowerCase();
    if (agentNeedle && resolvedUserFilter === user.trim()) {
      rows = rows.filter((entry) => {
        const name = agentNameById.get(entry.userId) ?? "";
        return (
          entry.userId.toLowerCase().includes(agentNeedle) ||
          name.toLowerCase().includes(agentNeedle)
        );
      });
    }
    return rows;
  }, [turnEntries, user, resolvedUserFilter, agentNameById]);

  const callEntries = (callsQuery.data?.entries ?? []).filter((entry) => {
    if (!slowOnly || p95Ms <= 0) return true;
    return entry.durationMs > p95Ms;
  });
  const callTotal = callsQuery.data?.total ?? 0;
  const isCallsSlowFiltered = tab === "calls" && slowOnly;
  const totalPages = Math.ceil((tab === "turns" ? turnTotal : (isCallsSlowFiltered ? callEntries.length : callTotal)) / PAGE_SIZE) || 1;

  const statsUpdatedAtMs = tab === "turns" ? turnsQuery.dataUpdatedAt : callsQuery.dataUpdatedAt;
  const statsTimeLabel = formatStatsTimeLabel(statsUpdatedAtMs > 0 ? new Date(statsUpdatedAtMs) : null, now);

  // ── 顶部元条（20261019 §5）─────────────────────────────────────────────
  // 固定起止时间：就是**这一次查询实际用的窗口**（与请求参数同源），
  // 不是「最近 N 小时」的口头说法。
  const fixedStartIso = localDateTimeValueToIso(since) ?? sinceForRange(range);
  const fixedEndIso = localDateTimeValueToIso(until) ?? new Date(now).toISOString();
  const zone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
    } catch {
      return "本地时区";
    }
  }, []);
  const statsAtIso = statsUpdatedAtMs > 0 ? new Date(statsUpdatedAtMs).toISOString() : new Date(now).toISOString();
  // 审计同步延迟 = 最老未投影事件的滞留时长（服务端投影状态，真实观测值）。
  const projection = tab === "turns" ? turnsQuery.data?.projection : callsQuery.data?.projection;
  const syncLagMs = projection?.delayMs ?? 0;
  const projectionComplete = projection?.complete ?? false;

  // ── 八桶主状态汇总（B27；与列表 / CSV / v2 导出同源同函数）──────────────
  const primaryStatusCounts = callsQuery.data?.summary?.primaryStatus;

  const turnExportFilterQuery = buildQuery({
    user: resolvedUserFilter || undefined,
    source: turnSource === "inferred" || turnSource === "reported" ? turnSource : "all",
    hours,
    since: localDateTimeValueToIso(since),
    until: localDateTimeValueToIso(until),
    tableSearch: tableSearch.trim() || undefined,
    turnId: keySearch.trim() || undefined,
    outcome: outcome || undefined,
    q: turnSearch.trim() || undefined
  });
  const callExportFilterQuery = buildQuery({
    user: resolvedUserFilter || user || undefined,
    tokenHashPrefix: tokenHashPrefix || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined,
    since: localDateTimeValueToIso(since),
    until: localDateTimeValueToIso(until),
    tableSearch: tableSearch.trim() || undefined,
    sessionId: sessionId || undefined,
    clientIp: clientIp || undefined,
    deviceName: deviceNameFilter || undefined,
    key: keySearch.trim() || undefined,
    platform: platform || undefined,
    callSource: callSource || undefined,
    includeProtocol
  });
  const turnExportUrl = `/api/admin/audit/turns/export${turnExportFilterQuery}`;
  const callExportUrl = `/api/admin/audit/export${callExportFilterQuery}`;
  const exportPackUrl = `/api/admin/audit/export-pack${callExportFilterQuery}`;
  const metadataUrl = `/api/admin/audit/export-metadata?kind=${tab === "turns" ? "turns" : "calls"}`;
  const currentExport = tab === "turns"
    ? {
        href: turnExportUrl,
        title: "导出当前筛选的问询记录"
      }
    : {
        href: callExportUrl,
        title: "导出当前筛选的调用流水"
      };

  const tabLink = (nextTab: AuditTab) => {
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    if (nextTab === "turns") next.delete("view");
    else next.set("view", nextTab);
    if (!next.get("range") && !next.get("hours")) next.set("range", range);
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="访问日志"
        description={
          <>
            按问询和工具调用追溯 <span className="notranslate" translate="no">Agent</span> 访问行为、权限裁决与执行耗时。
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={currentExport.href}
              download
              className="pl-btn pl-btn--secondary text-sm"
              data-testid="audit-export-current"
              title={currentExport.title}
            >
              导出
            </a>
            <a
              href={exportPackUrl}
              download
              className="pl-inline-link"
              data-testid="audit-export-pack"
              title="下载审计证据包"
            >
              导出审计证据包
            </a>
          </div>
        }
      />

      <div
        className="pl-segmented-control pl-segmented-control--cols-2 w-fit"
        role="tablist"
        aria-label="访问日志视图"
        data-testid="audit-view-tabs"
      >
        <Link
          to={tabLink("turns")}
          role="tab"
          aria-selected={tab === "turns"}
          className={
            tab === "turns"
              ? "pl-segmented-control-item pl-segmented-control-item--active text-center no-underline"
              : "pl-segmented-control-item text-center no-underline"
          }
          data-testid="audit-tab-turns"
        >
          问询记录
        </Link>
        <Link
          to={tabLink("calls")}
          role="tab"
          aria-selected={tab === "calls"}
          className={
            tab === "calls"
              ? "pl-segmented-control-item pl-segmented-control-item--active text-center no-underline"
              : "pl-segmented-control-item text-center no-underline"
          }
          data-testid="audit-tab-calls"
        >
          调用流水
        </Link>
      </div>

      {/* 顶部元条：固定起止时间、时区、统计时间、刷新/暂停状态、审计同步延迟。
          暂停时筛选与序列上界被冻结，后台不得换范围。 */}
      <AuditTopMetaBar
        fixedStart={fixedStartIso}
        fixedEnd={fixedEndIso}
        zone={zone}
        statsAt={statsAtIso}
        refreshState={refreshPaused ? "paused" : "live"}
        pauseReason="筛选与序列上界已冻结"
        syncLagMs={syncLagMs}
        trailing={
          <div className="flex flex-wrap items-center gap-2">
            {!projectionComplete ? (
              <span
                className="pl-status-badge pl-status-warning"
                data-testid="audit-projection-lagging"
                title={projection?.reason ?? "审计投影尚未追平账本上界"}
              >
                审计投影未追平
              </span>
            ) : null}
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              data-testid="audit-refresh-toggle"
              aria-pressed={refreshPaused}
              onClick={() => setRefreshPaused((v) => !v)}
            >
              {refreshPaused ? "恢复刷新" : "暂停刷新"}
            </button>
          </div>
        }
      />

      <div className="pl-notice flex flex-wrap items-center justify-between gap-3" data-testid="audit-granularity-help">
        <span>
          {tab === "turns" ? (
            <>问询记录按一次用户问询聚合，适合查看整体结果、涉及数据表和慢调用概况。</>
          ) : (
            <>
              调用流水按一次工具调用展开，适合排查权限裁决、生成{" "}
              <span className="notranslate" translate="no">SQL</span>、访问上下文和单次耗时。
            </>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="pl-inline-link"
            href={metadataUrl}
            download
            data-testid="audit-export-metadata"
            title="下载当前页签 CSV 字段说明"
          >
            字段说明
          </a>
          <Link className="pl-inline-link" to="/help?section=admin-audit-turns-vs-calls">
            查看审计口径
          </Link>
        </div>
      </div>

      {/* Time range segmented control + stats meta */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="pl-segmented-control pl-segmented-control--auto"
          data-testid="audit-time-presets"
          role="group"
          aria-label="时间范围"
        >
          {(["1h", "24h", "7d", "30d", "today", "custom"] as TimePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={`pl-segmented-control-item${timePreset === preset ? " pl-segmented-control-item--active" : ""}`}
              data-testid={`audit-time-preset-${preset}`}
              aria-pressed={timePreset === preset}
              onClick={() => applyTimePreset(preset)}
            >
              {TIME_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <span className="text-xs text-fg-muted whitespace-nowrap" data-testid="audit-stats-time">
          统计时间：{statsTimeLabel}
        </span>
      </div>

      <div className="pl-admin-filterbar" data-testid="audit-shared-filters">
        {tab === "calls" && tokenHashPrefix ? (
          <div className="pl-badge flex items-center gap-2" data-testid="audit-token-filter">
            <span><span className="notranslate" translate="no">Token</span>：</span>
            <code className="notranslate" translate="no">{tokenHashPrefix}</code>
            <button
              type="button"
              className="pl-inline-link notranslate"
              translate="no"
              onClick={() => updateParam("tokenHashPrefix", "")}
              aria-label="清除 Token 筛选"
            >
              清除
            </button>
          </div>
        ) : null}
        <input
          className="pl-input w-44 notranslate"
          translate="no"
          placeholder="Agent 名称或 ID"
          aria-label="按 Agent 名称或 ID 筛选"
          value={userMirror.value}
          onChange={(e) => applyMirroredText(userMirror, e.target.value, "user")}
        />
        <select
          className="pl-input w-28"
          aria-label="结果状态"
          value={outcome}
          onChange={(e) => updateParam("outcome", e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="ok">成功</option>
          <option value="error">错误</option>
          <option value="denied">拒绝</option>
        </select>
        <input
          className="pl-input flex-1 min-w-[10rem] notranslate"
          translate="no"
          placeholder={tab === "turns" ? "搜索问询 ID / 摘要 / 表名" : "事件 ID / 问询 ID / 表名"}
          aria-label="统一搜索"
          data-testid="audit-key-search"
          value={unifiedSearchMirror.value}
          onChange={(e) => applyUnifiedSearch(e.target.value)}
        />
        {/* Hidden time inputs kept for test compatibility and custom mode */}
        <span
          className="sr-only"
          data-testid="audit-time-label"
        >
          时间
        </span>
        <input
          className={timePreset === "custom" ? "pl-input w-44" : "sr-only"}
          type="datetime-local"
          aria-label="开始时间"
          data-testid="audit-since"
          value={since}
          onChange={(e) => {
            setSince(e.target.value);
            setPage(0);
          }}
        />
        {timePreset === "custom" ? <span className="text-fg-muted self-center">—</span> : null}
        <input
          className={timePreset === "custom" ? "pl-input w-44" : "sr-only"}
          type="datetime-local"
          aria-label="结束时间"
          data-testid="audit-until"
          value={until}
          onChange={(e) => {
            setUntil(e.target.value);
            setPage(0);
          }}
        />
        <button
          type="button"
          className="pl-btn pl-btn--ghost text-sm"
          data-testid="audit-advanced-filters-toggle"
          aria-expanded={advancedOpen}
          aria-controls="audit-advanced-filters"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? "收起高级" : "高级筛选"}
        </button>
        {hasNonDefaultFilters ? (
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-sm"
            data-testid="audit-clear-filters"
            onClick={clearFilters}
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {advancedOpen ? (
        <div
          id="audit-advanced-filters"
          className="pl-admin-filterbar"
          data-testid="audit-advanced-filters"
        >
          {tab === "turns" ? (
            <>
              <select
                className="pl-input w-40"
                value={turnSource}
                title={TURN_SOURCE_FILTER_TITLE}
                aria-label="来源类型"
                onChange={(e) => updateParam("turnSource", e.target.value)}
              >
                <option value="">全部来源</option>
                <option value="reported">用户原始问询</option>
                <option value="inferred">系统推断问询</option>
              </select>
            </>
          ) : (
            <>
              <select
                className="pl-input w-44"
                value={callSource}
                aria-label="调用来源"
                data-testid="audit-call-source-filter"
                onChange={(e) => setCallSource(e.target.value)}
              >
                <option value="">全部来源</option>
                <option value="playground" className="notranslate" translate="no">
                  MCP 调试台受控试调
                </option>
                <option value="agent" className="notranslate" translate="no">
                  Agent 接入调用
                </option>
              </select>
              <input
                className="pl-input w-36 notranslate"
                translate="no"
                placeholder="工具名"
                aria-label="按工具名筛选"
                value={toolMirror.value}
                onChange={(e) => applyMirroredText(toolMirror, e.target.value, "tool")}
              />
              <input
                className="pl-input w-40 notranslate"
                translate="no"
                placeholder="Session ID"
                aria-label="按 Session ID 筛选"
                value={sessionIdMirror.value}
                onChange={(e) => applyMirroredText(sessionIdMirror, e.target.value, "sessionId")}
              />
              <input
                className="pl-input w-36 notranslate"
                translate="no"
                placeholder="访问 IP"
                value={clientIpMirror.value}
                aria-label="访问 IP"
                onChange={(e) => applyMirroredText(clientIpMirror, e.target.value, "clientIp")}
              />
              <input
                className="pl-input w-36 notranslate"
                translate="no"
                placeholder="最近设备名"
                value={deviceNameMirror.value}
                aria-label="最近设备名"
                onChange={(e) => applyMirroredText(deviceNameMirror, e.target.value, "deviceName")}
              />
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={includeProtocol} onChange={(e) => updateParam("includeProtocol", e.target.checked ? "true" : "")} />
                显示协议调用
              </label>
            </>
          )}
          {tab === "turns" ? (
            <input
              className="pl-input w-40 notranslate"
              translate="no"
              placeholder="表名"
              aria-label="按表名筛选"
              value={tableSearchMirror.value}
              onChange={(e) => applyMirroredText(tableSearchMirror, e.target.value, "tableSearch")}
            />
          ) : null}
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={slowOnly} onChange={(e) => updateParam("slowOnly", e.target.checked ? "1" : "")} />
            仅慢于多数请求
          </label>
        </div>
      ) : null}

      {tab === "turns" && (turnsQuery.isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : turnsQuery.error ? (
        <div className="pl-notice">加载失败：{(turnsQuery.error as Error).message}</div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="text-sm text-fg-muted">
              {turnTotal === 0 ? "共 0 条" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, turnTotal)} / 共 ${turnTotal} 条`}
            </div>
            {turnSummary ? (
              <div className="text-sm text-fg-muted" data-testid="audit-turns-coverage-summary">
                当前筛选：已上报问询 {turnSummary.reportedCount} · 推断问询 {turnSummary.inferredCount}
                {turnTotal > 0
                  ? ` · 上报占比 ${Math.round(turnSummary.reportedShare * 100)}%`
                  : null}
              </div>
            ) : null}
            {turnTotal === 0 || (turnSummary && turnSummary.reportedCount === 0) ? (
              <div className="text-xs text-fg-muted" data-testid="audit-turns-coverage-hint">
                未上报原文时按会话保留问询。
              </div>
            ) : null}
          </div>
          <section className="pl-data-grid-frame" data-testid="audit-turns-grid-frame">
            <div
              className="pl-data-grid-scroll pl-audit-grid-scroll"
              role="region"
              aria-label="问询记录表格，可横向和纵向滚动"
              tabIndex={0}
              data-testid="audit-turns-grid-scroll"
            >
            <table className="pl-data-grid pl-data-table pl-audit-table pl-audit-turns-table w-full" data-testid="audit-turns-table">
              <thead>
                <tr>
                  <th className="pl-audit-turns-col-index whitespace-nowrap">序号</th>
                  <th className="pl-audit-turns-col-id whitespace-nowrap">问询 ID</th>
                  <th className="pl-audit-turns-col-time whitespace-nowrap">开始时间</th>
                  <th className="pl-audit-turns-col-duration whitespace-nowrap">问询时长</th>
                  <th className="pl-audit-turns-col-agent whitespace-nowrap"><span className="notranslate" translate="no">Agent</span></th>
                  <th className="whitespace-nowrap">客户端</th>
                  <th className="whitespace-nowrap">会话 ID</th>
                  <th className="pl-audit-turns-col-summary whitespace-nowrap">问询摘要</th>
                  <th className="pl-audit-turns-col-calls whitespace-nowrap">关联调用数</th>
                  <th className="pl-audit-turns-col-tables whitespace-nowrap">涉及数据表</th>
                  <th className="pl-audit-turns-col-result whitespace-nowrap">结果</th>
                  <th className="pl-audit-turns-col-source pl-audit-turn-source-cell whitespace-nowrap">来源</th>
                </tr>
              </thead>
              <tbody>
                {filteredTurnEntries.length === 0 ? (
                  <tr><td colSpan={12} className="px-3 py-6 text-center text-fg-muted">暂无问询记录</td></tr>
                ) : (
                  filteredTurnEntries.map((entry, index) => {
                    // 「未下发」提示用 legacy outcome 的 denied 计数：它回答的是
                    // 「这次问询有没有被下发过表」，与「执行结果」不是同一维度。
                    // 执行结果一律看八桶（见下方 turnStatusBuckets）。
                    const denied = entry.outcomeSummary?.denied ?? 0;
                    return (
                      <tr
                        key={entry.id}
                        className="pl-audit-row cursor-pointer"
                        data-testid={`audit-turn-row-${entry.id}`}
                        onClick={() => openTurnDrawer(entry.id)}
                      >
                        <td className="pl-audit-table-num">{page * PAGE_SIZE + index + 1}</td>
                        <td className="pl-audit-table-mono pl-audit-turn-id-cell" onClick={(e) => e.stopPropagation()}>
                          <CopyableId value={entry.id} testId={`audit-turn-id-${entry.id}`} label="问询 ID" />
                        </td>
                        <td className="pl-audit-table-muted whitespace-nowrap tabular-nums">
                          {formatConfigAuditTs(entry.startedAt)}
                        </td>
                        <td className="pl-audit-turn-duration-cell">
                          {formatDurationMs(entry.turnSpanMs ?? 0)}
                          {(entry.totalCallDurationMs ?? 0) > 0 ? (
                            <span className="text-fg-muted"> · 执 {formatDurationMs(entry.totalCallDurationMs ?? 0)}</span>
                          ) : null}
                        </td>
                        <td className="notranslate" translate="no">{formatAgentLabel(entry.userId, agentNameById)}</td>
                        <td className="notranslate" translate="no">{entry.client || "—"}</td>
                        <td className="pl-audit-table-mono notranslate" translate="no">{entry.sessionId || "—"}</td>
                        <td className="pl-audit-turn-summary-cell">{entry.questionPreview ?? entry.questionSummary ?? "—"}</td>
                        <td className="pl-audit-table-num">{entry.linkedCallCount}</td>
                        <td className="pl-audit-table-muted pl-audit-turn-tables-cell notranslate" translate="no" title={entry.sources.map((s) => s.physicalTable).filter(Boolean).join(", ") || undefined}>
                          {entry.sources.length === 0 && denied > 0
                            ? <span className="text-fg-muted">未下发</span>
                            : formatTablesCell(entry.sources)}
                        </td>
                        <td>
                          {/* 八桶主状态（B27）。「成功」只在**全部**关联调用都落在
                              succeeded 桶时才成立；旧三桶（denied/error）不再
                              充当执行结论 —— 预算终止 / 未执行 / 未知都不是
                              「成功」，也不是「异常」。 */}
                          <span className="inline-flex flex-wrap items-center gap-1">
                            {turnStatusBuckets(entry).map(({ bucket, count }) => (
                              <span
                                key={bucket}
                                className={`pl-status-badge ${primaryStatusPalette(bucket)}`}
                                data-testid={`audit-turn-status-${entry.id}-${bucket}`}
                                data-bucket={bucket}
                              >
                                {primaryStatusLabel(bucket)} <span className="tabular-nums">{count}</span>
                              </span>
                            ))}
                            {turnStatusBuckets(entry).length === 0 ? (
                              <span className="text-fg-muted">无关联调用</span>
                            ) : null}
                            {(entry.slowCallCount ?? 0) > 0 ? (
                              <span className="pl-status-badge pl-status-partial">含 {entry.slowCallCount} 慢</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="pl-audit-turn-source-cell"><TurnSourceBadge source={entry.source} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </section>
        </>
      ))}

      {tab === "calls" && (callsQuery.isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : callsQuery.error ? (
        <div className="pl-notice">加载失败：{(callsQuery.error as Error).message}</div>
      ) : (
        <>
          <div className="text-sm text-fg-muted" data-testid="audit-calls-summary">
            {isCallsSlowFiltered
              ? `本页慢调用 ${callEntries.length} 条（筛选前共 ${callTotal} 条）`
              : (callTotal === 0 ? "共 0 条" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, callTotal)} / 共 ${callTotal} 条`)}
          </div>
          {/* 八桶主状态汇总（B27）。旧三桶 outcome 只作 legacy 直方图单列，
              不作为执行状态 —— 两者不混在同一处。 */}
          {primaryStatusCounts ? (
            <div
              className="flex flex-wrap items-center gap-2 text-xs"
              data-testid="audit-primary-status-summary"
              data-closed={callsQuery.data?.summary?.primaryStatusClosed ? "true" : "false"}
            >
              <span className="text-fg-muted whitespace-nowrap">主状态：</span>
              {PRIMARY_STATUS_ORDER.map((bucket) => (
                <span
                  key={bucket}
                  className={`pl-status-badge ${primaryStatusPalette(bucket)}`}
                  data-testid={`audit-primary-status-count-${bucket}`}
                  data-bucket={bucket}
                >
                  {primaryStatusLabel(bucket)} {primaryStatusCounts[bucket] ?? 0}
                </span>
              ))}
              {callsQuery.data?.summary?.legacyOutcome ? (
                <span
                  className="pl-status-badge pl-status-neutral"
                  data-testid="audit-legacy-outcome-histogram"
                  title="旧 outcome 直方图（legacy），不作为执行状态"
                >
                  旧 outcome（legacy）：{Object.entries(callsQuery.data.summary.legacyOutcome)
                    .filter(([key]) => key !== "null")
                    .map(([key, count]) => `${LEGACY_OUTCOME_LABELS[key] ?? key} ${count}`)
                    .join(" · ") || "无"}
                </span>
              ) : null}
            </div>
          ) : null}
          <section className="pl-data-grid-frame" data-testid="audit-calls-grid-frame">
            <div
              className="pl-data-grid-scroll pl-audit-grid-scroll"
              role="region"
              aria-label="调用流水表格，可横向和纵向滚动"
              tabIndex={0}
              data-testid="audit-calls-grid-scroll"
            >
            <table className="pl-data-grid pl-data-table pl-audit-table w-full" data-testid="audit-calls-table">
              <thead>
                <tr>
                  <th className="w-14 whitespace-nowrap">序号</th>
                  <th>时间</th>
                  <th className="whitespace-nowrap">事件 ID</th>
                  <th className="whitespace-nowrap">问询 ID</th>
                  <th><span className="notranslate" translate="no">Agent</span></th>
                  <th className="whitespace-nowrap">访问上下文</th>
                  <th>状态</th>
                  <th>耗时</th>
                  <th>工具</th>
                  <th>涉及数据表</th>
                  <th>裁决原因</th>
                  <th>调用来源</th>
                  <th>生成 SQL</th>
                </tr>
              </thead>
              <tbody>
                {callEntries.length === 0 ? (
                  <tr><td colSpan={13} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
                ) : (
                  callEntries.map((entry, index) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={page * PAGE_SIZE + index + 1}
                      agentNameById={agentNameById}
                      onOpenTurn={openTurnDrawer}
                    />
                  ))
                )}
              </tbody>
            </table>
            </div>
          </section>
        </>
      ))}

      <div className="flex justify-between items-center">
        <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ 上一页
        </button>
        <span className="text-sm text-fg-muted" data-testid="audit-pagination-summary">
          {isCallsSlowFiltered ? "慢调用筛选：仅统计当前页" : `${page + 1} / ${totalPages}`}
        </span>
        <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
          下一页 ›
        </button>
      </div>

      <TurnDetailDrawer
        turnId={selectedTurnId}
        hours={hours}
        open={turnDrawerOpen}
        onOpenChange={handleTurnDrawerOpenChange}
        agentNameById={agentNameById}
      />
    </div>
  );
}
