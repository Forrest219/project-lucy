import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { apiGet } from "../../lib/apiClient";
import { formatConfigAuditTs } from "../../lib/configAuditLabels";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import type {
  Agent,
  AuditLogEntry,
  AuditResponse,
  AuditTurnDetailResponse,
  AuditTurnEntry,
  AuditTurnsResponse
} from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { DecisionReasonCell } from "../../components/DecisionReasonCell";

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
        <span className="pl-trace-detail-span-type">{event.spanType}</span>
        <span className={`pl-status-badge ${statusClass}`}>{STATUS_LABEL[event.status]}</span>
        <span className="text-fg-muted font-mono">{event.spanId}</span>
        {event.actorId ? <span className="text-fg-muted">· {event.actorKind} {event.actorId}</span> : null}
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
            <span key={hash} className="pl-trace-detail-hash" title={hash}>
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
            <header className="pl-trace-detail-header">
              <Dialog.Title className="pl-trace-detail-title" data-testid="trace-detail-title">
                {traceId}
              </Dialog.Title>
              <Dialog.Description
                id={`trace-detail-${traceId}-desc`}
                className="pl-trace-detail-subtitle"
              >
                只读视图 · {totalSpans} spans · {totalEvidence} evidence
              </Dialog.Description>
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
                {orderedSpans.length === 0 ? (
                  <div className="pl-notice" data-testid="trace-detail-empty">该 trace 暂无 span 记录。</div>
                ) : (
                  <section className="pl-trace-detail-section" data-testid="trace-detail-spans">
                    <h3 className="pl-trace-detail-section-title">Ordered Spans</h3>
                    {orderedSpans.map((event) => (
                      <SpanBlock
                        key={event.spanId}
                        event={event}
                        isRoot={!event.parentSpanId}
                      />
                    ))}
                  </section>
                )}
                {evidenceGroups.length > 0 ? (
                  <section className="pl-trace-detail-section" data-testid="trace-detail-evidence">
                    <h3 className="pl-trace-detail-section-title">Evidence Refs</h3>
                    {evidenceGroups.map(([kind, list]) => (
                      <div key={kind} className="pl-trace-detail-evidence-group">
                        <h4 className="text-xs font-semibold text-fg-muted">{kind} · {list.length}</h4>
                        {list.map((ev) => (
                          <div
                            key={ev.id}
                            className="pl-trace-detail-evidence-row"
                            data-testid={`trace-evidence-${ev.id}`}
                          >
                            <span className="pl-trace-detail-evidence-kind">{ev.evidenceKind}</span>
                            <span className="pl-trace-detail-evidence-relation">
                              {RELATION_LABEL[ev.relation] ?? ev.relation}
                            </span>
                            <span className="pl-trace-detail-evidence-ref" title={ev.evidenceRef}>
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

const OUTCOME_LABELS = { ok: "成功", error: "错误", denied: "拒绝" };
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
type WindowHours = 24 | 168;

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

function parseWindowHours(raw: string | null): WindowHours {
  return raw === "24" ? 24 : 168;
}

function sinceIsoFromHours(hours: WindowHours): string {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d.toISOString();
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

function formatTablesCell(sources: AuditTurnEntry["sources"], max = 2): string {
  const tables = sources.map((s) => s.physicalTable).filter(Boolean);
  if (tables.length === 0) return "—";
  const shown = tables.slice(0, max);
  const suffix = tables.length > max ? "…" : "";
  return `${shown.join(", ")}${suffix}`;
}

const TURN_SOURCE_FILTER_TITLE =
  "来源类型：用户原始问询为客户端上报；系统推断问询由工具调用参数自动生成摘要，不等同于用户原文。";

function TurnSourceBadge({ source }: { source: AuditTurnEntry["source"] }) {
  if (source === "reported") {
    return <span className="pl-status-badge pl-status-done">已上报问询</span>;
  }
  return (
    <span className="pl-status-badge pl-status-partial" title="基于工具调用自动生成，不等同于用户原文">
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
                  推断问题摘要基于工具调用参数自动生成，不等同于用户原文。
                </section>
              ) : null}

              {(detail.questionSummary || detail.questionPreview) ? (
                <section className="pl-card grid gap-2" data-testid="audit-turn-summary-card">
                  <h3 className="text-sm font-semibold text-fg-default">问询摘要</h3>
                  <p className="text-sm text-fg-muted">{detail.questionPreview ?? detail.questionSummary}</p>
                </section>
              ) : null}

              <section className="pl-card grid gap-3" data-testid="audit-turn-calls-card">
                <h3 className="text-sm font-semibold text-fg-default">调用明细</h3>
                <div className="overflow-x-auto">
                  <table className="pl-data-grid pl-data-table pl-audit-table w-full" data-testid="audit-turn-calls-table">
                    <thead>
                      <tr>
                        <th className="w-12">序号</th>
                        <th>时间</th>
                        <th>数据库连接</th>
                        <th>涉及数据表</th>
                        <th>状态</th>
                        <th>耗时</th>
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
                            <td className="notranslate" translate="no">{log.connectionId ?? "—"}</td>
                            <td className="pl-audit-table-muted notranslate" translate="no">{log.tables?.join(", ") ?? "—"}</td>
                            <td>
                              <span className={`pl-status-badge ${log.outcome === "ok" ? "pl-status-done" : log.outcome === "denied" ? "pl-status-partial" : "pl-status-validation_failed"}`}>
                                {OUTCOME_LABELS[log.outcome as keyof typeof OUTCOME_LABELS] ?? log.outcome}
                              </span>
                            </td>
                            <td>
                              <span className="tabular-nums">{log.durationMs} ms</span>
                              {log.isSlowCall ? <span className="ml-2 pl-status-badge pl-status-partial">慢于多数请求</span> : null}
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

              {Array.isArray(detail.sources) && detail.sources.length > 0 ? (
                <section className="pl-card grid gap-2" data-testid="audit-turn-tables-card">
                  <h3 className="text-sm font-semibold text-fg-default">触达表汇总</h3>
                  <ul className="text-sm text-fg-muted grid gap-1">
                    {(detail.sources as Array<{ connectionId?: string; physical_table?: string; physicalTable?: string }>).map((source, index) => (
                      <li key={index} className="notranslate" translate="no">
                        {source.connectionId ? (
                          <span className="text-fg-default">{source.connectionId}</span>
                        ) : null}
                        {source.connectionId ? " · " : null}
                        <span className="font-mono">{source.physicalTable ?? source.physical_table ?? "—"}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
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
const AUDIT_FILTER_STORAGE_KEY = "lucy:webui:audit:filters:v2";
const FILTER_PERSIST_FIELDS = ["tab", "hours", "user", "tool", "outcome", "tableSearch", "sessionId", "turnId", "platform", "turnSource"] as const;
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

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeClass =
    entry.outcome === "ok" ? "pl-status-done" : entry.outcome === "denied" ? "pl-status-partial" : "pl-status-validation_failed";
  const redactedArgs = entry.argsSummary ? redactValue(entry.argsSummary) : null;

  return (
    <>
      <tr className="pl-audit-row" onClick={() => setExpanded(!expanded)}>
        <td className="pl-audit-table-muted whitespace-nowrap">{formatConfigAuditTs(entry.ts)}</td>
        <td>{entry.userId}</td>
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
          <span className={`pl-status-badge ${outcomeClass}`}>{OUTCOME_LABELS[entry.outcome]}</span>
        </td>
        <td className="pl-audit-table-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{entry.durationMs}ms</span>
            <Link
              to={buildObjectDetailSearch({ kind: "auditEvent", eventId: entry.id })}
              state={{ initialAuditEntry: entry }}
              className="pl-inline-link notranslate"
              translate="no"
              aria-label={`查看审计事件 #${entry.id} 的对象详情`}
              data-testid={`audit-row-detail-${entry.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              查看详情
            </Link>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={7} className="px-3 py-3 text-xs">
            <div className="pl-audit-detail-grid">
              <div>
                <span className="font-medium">关联 <span className="notranslate" translate="no">Agent</span>：</span>
                <span className="ml-2 inline-flex flex-wrap items-center gap-2">
                  <Link
                    to={buildObjectDetailSearch({ kind: "agent", agentId: entry.userId })}
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
              </div>
              {(entry.tokenLabel || entry.tokenHashPrefix) && (
                <div>
                  <span className="font-medium"><span className="notranslate" translate="no">Token</span>：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.tokenLabel ?? "—"} {entry.tokenHashPrefix ? <span className="font-mono">({entry.tokenHashPrefix}…)</span> : null}
                  </span>
                </div>
              )}
              {redactedArgs !== null && (
                <div>
                  <span className="font-medium">Args：</span>
                  <code className="ml-2">{JSON.stringify(redactedArgs)}</code>
                </div>
              )}
              {entry.errorDetail && (
                <div>
                  <span className="font-medium text-danger">错误：</span>
                  <span className="ml-2 text-fg-muted">{redactErrorDetail(entry.errorDetail)}</span>
                </div>
              )}
              <div>
                <span className="font-medium">请求 ID：</span>
                <span className="ml-2 text-fg-muted font-mono">{entry.requestId}</span>
                {entry.traceId ? <TraceLink traceId={entry.traceId} /> : null}
              </div>
              {entry.decisionReason && (
                <div>
                  <span className="font-medium">裁决原因：</span>
                  <div className="ml-2 inline-block align-top">
                    <DecisionReasonCell code={entry.decisionReason} />
                  </div>
                </div>
              )}
              {entry.outcome === "denied" && (
                <div>
                  <Link
                    to={playgroundReplayHref(entry)}
                    className="pl-inline-link notranslate"
                    translate="no"
                  >
                    在调试台复现
                  </Link>
                </div>
              )}
              {entry.roleIds && (
                <div>
                  <span className="font-medium">角色：</span>
                  <span className="ml-2 text-fg-muted">{entry.roleIds.join(", ") || "—"}</span>
                </div>
              )}
              {(entry.permissionSnapshotHash || entry.effectiveTablesCount !== undefined) && (
                <div>
                  <span className="font-medium">权限快照：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.permissionSnapshotHash ? <span className="font-mono">{entry.permissionSnapshotHash.slice(0, 16)}…</span> : "—"}
                    {entry.effectiveTablesCount !== undefined ? ` · ${entry.effectiveTablesCount} 张有效表` : ""}
                  </span>
                </div>
              )}
              {entry.client && (
                <div>
                  <span className="font-medium">客户端：</span>
                  <span className="ml-2 text-fg-muted">{entry.client}</span>
                </div>
              )}
              {(entry.lucySessionId || entry.lucyTurnId || entry.lucyPlatform) && (
                <div>
                  <span className="font-medium">关联会话：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.lucyPlatform ? `${entry.lucyPlatform} · ` : ""}
                    {entry.lucySessionId ? <span className="font-mono">{entry.lucySessionId}</span> : "—"}
                    {entry.lucyTurnId ? <span className="font-mono"> / {entry.lucyTurnId}</span> : ""}
                  </span>
                </div>
              )}
              {(entry.queryHash || entry.queryPreview) && (
                <div>
                  <span className="font-medium">Query 审计：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.queryOperation ?? "unknown"}
                    {entry.queryLength !== undefined ? ` · ${entry.queryLength} chars` : ""}
                    {entry.queryHash ? <span className="font-mono"> · {entry.queryHash.slice(0, 16)}…</span> : ""}
                  </span>
                  {entry.queryPreview ? <code className="ml-2">{entry.queryPreview}</code> : null}
                </div>
              )}
              {(entry.responseBytes !== undefined || entry.responseRowCount !== undefined || entry.responseColumnCount !== undefined) && (
                <div>
                  <span className="font-medium">返回规模：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.responseBytes !== undefined ? `${entry.responseBytes} bytes` : "—"}
                    {entry.responseRowCount !== undefined ? ` · ${entry.responseRowCount} rows` : ""}
                    {entry.responseColumnCount !== undefined ? ` · ${entry.responseColumnCount} cols` : ""}
                    {entry.responseTruncated ? " · truncated" : ""}
                  </span>
                </div>
              )}
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

  const user = searchParams.get("user") ?? "";
  const tool = searchParams.get("tool") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const tableSearch = searchParams.get("tableSearch") ?? "";
  const sessionId = searchParams.get("sessionId") ?? "";
  const turnIdFilter = searchParams.get("turnIdFilter") ?? "";
  const platform = searchParams.get("platform") ?? "";
  const turnSource = searchParams.get("turnSource") ?? "";
  const turnSearch = searchParams.get("turnSearch") ?? "";
  const includeProtocol = searchParams.get("includeProtocol") === "true";
  const slowOnly = searchParams.get("slowOnly") === "1";
  const tabParam = searchParams.get("tab");
  const tab: AuditTab = tabParam === "calls" ? "calls" : "turns";
  const hours = parseWindowHours(searchParams.get("hours"));

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
    setSearchParams(next, { replace: true });
    setHasHydratedFromStorage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydratedFromStorage]);

  const sinceDefault = sinceIsoFromHours(hours).slice(0, 16);
  const [since, setSince] = useState(sinceDefault);
  const [until, setUntil] = useState("");

  useEffect(() => {
    setSince(sinceIsoFromHours(hours).slice(0, 16));
    setPage(0);
  }, [hours]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
    setPage(0);
    if ((FILTER_PERSIST_FIELDS as readonly string[]).includes(key)) {
      const snapshot = readFilterSnapshot();
      if (value) snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]] = value;
      else delete snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]];
      writeFilterSnapshot(snapshot);
    }
  }

  function setHours(nextHours: WindowHours) {
    updateParam("hours", String(nextHours));
  }

  function openTurnDrawer(turnId: string) {
    setSelectedTurnId(turnId);
    setTurnDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set("turnId", turnId);
    setSearchParams(next);
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
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const turnsQuery = useQuery({
    queryKey: ["admin", "audit", "turns", turnsQueryStr],
    queryFn: () => apiGet<AuditTurnsResponse>(`/api/admin/audit/turns${turnsQueryStr}`),
    enabled: tab === "turns"
  });

  const callsQueryStr = buildQuery({
    user: user || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined,
    since: since || undefined,
    until: until || undefined,
    tableSearch: tableSearch || undefined,
    sessionId: sessionId || undefined,
    turnId: turnIdFilter || undefined,
    platform: platform || undefined,
    includeProtocol,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const callsQuery = useQuery({
    queryKey: ["admin", "audit", "calls", callsQueryStr, slowOnly],
    queryFn: () => apiGet<AuditResponse>(`/api/admin/audit${callsQueryStr}`),
    enabled: tab === "calls"
  });

  const turnEntries = turnsQuery.data?.entries ?? [];
  const turnTotal = turnsQuery.data?.total ?? 0;
  const referenceLatency = turnsQuery.data?.referenceLatency;
  const p95Ms = referenceLatency?.p95Ms ?? 0;

  const filteredTurnEntries = useMemo(() => {
    let rows = turnEntries;
    const agentNeedle = user.trim().toLowerCase();
    if (agentNeedle && resolvedUserFilter === user.trim()) {
      // Unresolved / multi-match: keep rows whose id or display name contains needle.
      rows = rows.filter((entry) => {
        const name = agentNameById.get(entry.userId) ?? "";
        return (
          entry.userId.toLowerCase().includes(agentNeedle) ||
          name.toLowerCase().includes(agentNeedle)
        );
      });
    }
    if (!turnSearch.trim()) return rows;
    const needle = turnSearch.trim().toLowerCase();
    return rows.filter((entry) => {
      const haystack = [
        entry.userId,
        agentNameById.get(entry.userId),
        entry.questionSummary,
        entry.questionPreview,
        entry.sources.map((s) => s.physicalTable).join(" ")
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [turnEntries, turnSearch, user, resolvedUserFilter, agentNameById]);

  const callEntries = (callsQuery.data?.entries ?? []).filter((entry) => {
    if (!slowOnly || p95Ms <= 0) return true;
    return entry.durationMs > p95Ms;
  });
  const callTotal = callsQuery.data?.total ?? 0;
  const isCallsSlowFiltered = tab === "calls" && slowOnly;
  const totalPages = Math.ceil((tab === "turns" ? turnTotal : (isCallsSlowFiltered ? callEntries.length : callTotal)) / PAGE_SIZE) || 1;

  const statsUpdatedAtMs = tab === "turns" ? turnsQuery.dataUpdatedAt : callsQuery.dataUpdatedAt;
  const statsTimeLabel = formatStatsTimeLabel(statsUpdatedAtMs > 0 ? new Date(statsUpdatedAtMs) : null, now);

  const exportUrl = `/api/admin/audit/export${buildQuery({
    user: user || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined,
    since: since || undefined,
    until: until || undefined,
    tableSearch: tableSearch || undefined,
    sessionId: sessionId || undefined,
    turnId: turnIdFilter || undefined,
    platform: platform || undefined,
    includeProtocol
  })}`;

  const tabLink = (nextTab: AuditTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "turns") next.delete("tab");
    else next.set("tab", nextTab);
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="访问日志"
        description="按 Agent 问询与 MCP 工具调用追溯访问行为；耗时可与使用概况「多数请求耗时」交叉核对。"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-fg-muted whitespace-nowrap" data-testid="audit-stats-time">
              统计时间：{statsTimeLabel}
            </span>
            <div
              className="pl-segmented-control pl-segmented-control--cols-2"
              role="tablist"
              aria-label="统计窗口"
              data-testid="audit-window-control"
            >
              <button
                type="button"
                className={hours === 24 ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
                onClick={() => setHours(24)}
              >
                24 小时
              </button>
              <button
                type="button"
                className={hours === 168 ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
                onClick={() => setHours(168)}
              >
                7 天
              </button>
            </div>
            {tab === "calls" ? (
              <a href={exportUrl} download className="pl-btn pl-btn--primary text-sm" data-testid="audit-export-csv">
                导出 CSV
              </a>
            ) : null}
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

      {tab === "turns" ? (
        <div className="pl-admin-filterbar">
          <input
            className="pl-input w-44 notranslate"
            translate="no"
            placeholder="Agent 名称或 ID"
            aria-label="按 Agent 名称或 ID 筛选"
            value={user}
            onChange={(e) => updateParam("user", e.target.value)}
          />
          <select
            className="pl-input w-40"
            value={turnSource}
            title={TURN_SOURCE_FILTER_TITLE}
            aria-label="来源类型"
            onChange={(e) => updateParam("turnSource", e.target.value)}
          >
            <option value="">全部</option>
            <option value="reported">用户原始问询</option>
            <option value="inferred">系统推断问询</option>
          </select>
          <input
            className="pl-input flex-1 min-w-[12rem]"
            placeholder="搜索摘要 / 表名"
            value={turnSearch}
            onChange={(e) => updateParam("turnSearch", e.target.value)}
          />
        </div>
      ) : (
        <div className="pl-admin-filterbar">
          <input className="pl-input w-36" placeholder="用户 ID" value={user} onChange={(e) => updateParam("user", e.target.value)} />
          <input className="pl-input w-36" placeholder="工具名" value={tool} onChange={(e) => updateParam("tool", e.target.value)} />
          <select className="pl-input w-28" value={outcome} onChange={(e) => updateParam("outcome", e.target.value)}>
            <option value="">全部状态</option>
            <option value="ok">成功</option>
            <option value="error">错误</option>
            <option value="denied">拒绝</option>
          </select>
          <input className="pl-input w-44" type="datetime-local" value={since} onChange={(e) => { setSince(e.target.value); setPage(0); }} />
          <span className="text-fg-muted self-center">—</span>
          <input className="pl-input w-44" type="datetime-local" value={until} onChange={(e) => { setUntil(e.target.value); setPage(0); }} />
          <input className="pl-input w-40" placeholder="搜索表名" value={tableSearch} onChange={(e) => updateParam("tableSearch", e.target.value)} />
          <input className="pl-input w-40" placeholder="Session ID" value={sessionId} onChange={(e) => updateParam("sessionId", e.target.value)} />
          <input className="pl-input w-36" placeholder="Turn ID" value={turnIdFilter} onChange={(e) => updateParam("turnIdFilter", e.target.value)} />
          <input className="pl-input w-32" placeholder="平台" value={platform} onChange={(e) => updateParam("platform", e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={includeProtocol} onChange={(e) => updateParam("includeProtocol", e.target.checked ? "true" : "")} />
            显示协议调用
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input type="checkbox" checked={slowOnly} onChange={(e) => updateParam("slowOnly", e.target.checked ? "1" : "")} />
            仅慢于多数请求
          </label>
        </div>
      )}

      {tab === "turns" && (turnsQuery.isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : turnsQuery.error ? (
        <div className="pl-notice">加载失败：{(turnsQuery.error as Error).message}</div>
      ) : (
        <>
          <div className="text-sm text-fg-muted">
            {turnTotal === 0 ? "共 0 条" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, turnTotal)} / 共 ${turnTotal} 条`}
          </div>
          <div className="overflow-x-auto">
            <table className="pl-data-grid pl-data-table pl-audit-table w-full" data-testid="audit-turns-table">
              <thead>
                <tr>
                  <th className="w-12">序号</th>
                  <th>开始时间</th>
                  <th>结束时间</th>
                  <th>问询时长</th>
                  <th><span className="notranslate" translate="no">Agent</span></th>
                  <th>问询摘要</th>
                  <th>工具调用数</th>
                  <th>涉及数据表</th>
                  <th>耗时</th>
                  <th>结果</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {filteredTurnEntries.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-6 text-center text-fg-muted">暂无问询记录</td></tr>
                ) : (
                  filteredTurnEntries.map((entry, index) => {
                    const denied = entry.outcomeSummary?.denied ?? 0;
                    const errors = entry.outcomeSummary?.error ?? 0;
                    return (
                      <tr
                        key={entry.id}
                        className="pl-audit-row cursor-pointer"
                        data-testid={`audit-turn-row-${entry.id}`}
                        onClick={() => openTurnDrawer(entry.id)}
                      >
                        <td className="pl-audit-table-num">{page * PAGE_SIZE + index + 1}</td>
                        <td className="pl-audit-table-muted whitespace-nowrap">{formatConfigAuditTs(entry.startedAt)}</td>
                        <td className="pl-audit-table-muted whitespace-nowrap">{formatConfigAuditTs(entry.endedAt)}</td>
                        <td>
                          <div>{formatDurationMs(entry.turnSpanMs ?? 0)}</div>
                          {(entry.totalCallDurationMs ?? 0) > 0 ? (
                            <div className="font-normal text-fg-muted">执行 {formatDurationMs(entry.totalCallDurationMs ?? 0)}</div>
                          ) : null}
                        </td>
                        <td className="notranslate" translate="no">{formatAgentLabel(entry.userId, agentNameById)}</td>
                        <td>{entry.questionPreview ?? entry.questionSummary ?? "—"}</td>
                        <td className="pl-audit-table-num">{entry.businessCallCount}</td>
                        <td className="pl-audit-table-muted notranslate" translate="no">{formatTablesCell(entry.sources)}</td>
                        <td>
                          {(entry.slowCallCount ?? 0) > 0 ? (
                            <span className="pl-status-badge pl-status-partial">含 {entry.slowCallCount} 次慢调用</span>
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </td>
                        <td>
                          {denied > 0 ? <span className="pl-status-badge pl-status-partial">{denied} 拒绝</span> : null}
                          {errors > 0 ? <span className="pl-status-badge pl-status-validation_failed">{errors} 错误</span> : null}
                          {denied === 0 && errors === 0 ? <span className="pl-status-badge pl-status-done">成功</span> : null}
                        </td>
                        <td><TurnSourceBadge source={entry.source} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
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
          <div className="overflow-x-auto">
            <table className="pl-data-grid pl-data-table pl-audit-table w-full" data-testid="audit-calls-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>工具</th>
                  <th>表</th>
                  <th>裁决原因</th>
                  <th>状态</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {callEntries.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
                ) : (
                  callEntries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
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
        onOpenChange={setTurnDrawerOpen}
        agentNameById={agentNameById}
      />
    </div>
  );
}
