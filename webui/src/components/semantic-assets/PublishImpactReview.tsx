import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet } from "../../lib/apiClient";
import type {
  PublishEvidenceResponse,
  PublishImpact,
  PublishImpactReason,
  PublishImpactReasonKind,
  PublishImpactSource,
  PublishImpactTable,
  SemanticTableIdentity
} from "../../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.5.1–§4.5.4 —
 * the shared impact review body, used by BOTH the regular sync confirmation and
 * the staged batch plan. The rules of the impact model live here once:
 *   - the table list is NEVER truncated (no "first 8 items" cut);
 *   - a table with several reasons is ONE table in the totals, with ALL of its
 *     reasons visible;
 *   - search and folding only change the DISPLAY, never the submitted range —
 *     the note therefore stays visible at all times;
 *   - evidence is loaded ON DEMAND from a server-constrained reference.
 */

export type PublishImpactReviewProps = {
  impact: PublishImpact;
  /** Hide the search box (used where the whole range must stay visible). */
  hideSearch?: boolean;
};

/** Why a table is in this batch — an evidence-supported reason, not a motive. */
const REASON_KIND_LABEL: Record<PublishImpactReasonKind, string> = {
  overlay_change: "表语义变更", manifest_table_change: "Schema Manifest 变更", first_verification: "首次核对"
};

/** How the table entered the batch — the entry path, not who changed it. */
const REASON_SOURCE_LABEL: Record<PublishImpactSource, string> = {
  staged_candidate: "本次导入", pending_disk_change: "既有待发布变更"
};

const CHANGE_TYPE_LABEL: Record<string, string> = {
  added: "新增", modified: "已修改", deleted: "已删除", renamed: "已重命名"
};

type TableGroup = { key: string; connectionId: string; schema: string; tables: PublishImpactTable[] };
type EvidenceState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string };
type DetailRow = { key: string; primary: string; secondary?: string; extra?: ReactNode };
type DetailSectionProps = {
  heading: string;
  note?: string;
  emptyText?: string;
  rows: DetailRow[];
  /**
   * The section root's test id. It is written as a JSX LITERAL at the call
   * site on purpose: the selector contract's static scan only recognises a
   * quoted literal or a template literal in the attribute position, so a value
   * passed through a variable would be invisible to it. The rendered element
   * is unchanged.
   */
  "data-testid": string;
};

/** One declared section: the element plus the facts the list needs. */
type DeclaredSection = {
  key: string;
  /** Render the section even when it has no rows. */
  always?: boolean;
  rowCount: number;
  element: ReactNode;
};

function identityText(identity: SemanticTableIdentity): string {
  return `${identity.connectionId}/${identity.schema}/${identity.table}`;
}

function groupTables(tables: PublishImpactTable[]): TableGroup[] {
  const groups = new Map<string, TableGroup>();
  for (const table of tables) {
    const identity = table.identity;
    if (!identity) continue;
    const key = `${identity.connectionId}\u0000${identity.schema}`;
    const existing = groups.get(key);
    if (existing) existing.tables.push(table);
    else groups.set(key, { key, connectionId: identity.connectionId, schema: identity.schema, tables: [table] });
  }
  return Array.from(groups.values());
}

/** The search matches the table identity AND the reason text, case-insensitive. */
function matchesQuery(table: PublishImpactTable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const identity = table.identity;
  const haystack = [identity ? identityText(identity) : "", ...table.reasons.map((r) => r.summary)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** One evidence reference, loaded only when the operator asks for it. */
function PublishEvidenceBlock({ evidenceRef }: { evidenceRef: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EvidenceState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    apiGet<PublishEvidenceResponse>(`/api/publish-workbench/evidence?ref=${encodeURIComponent(evidenceRef)}`)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", content: data?.content ?? "" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "证据读取失败。" });
      });
    return () => {
      cancelled = true;
    };
  }, [evidenceRef, attempt]);

  if (state.status === "loading") {
    return <p className="pl-notice text-xs" data-testid="publish-impact-evidence-loading">正在加载证据…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="pl-error" role="alert" data-testid="publish-impact-evidence-error">
        <p>证据加载失败：{state.message}</p>
        <button
          type="button" className="pl-btn pl-btn--ghost pl-btn--xs mt-1"
          onClick={() => setAttempt((value) => value + 1)} data-testid="publish-impact-evidence-retry"
        >
          重试
        </button>
      </div>
    );
  }
  return (
    <pre className="pl-yaml-preview notranslate" translate="no" data-testid="publish-impact-evidence">{state.content}</pre>
  );
}

/** A titled block of the review; every non-table block has this shape. */
function DetailSection(props: DetailSectionProps) {
  const { heading, note, emptyText, rows } = props;
  const testId = props["data-testid"];
  return (
    <section data-testid={testId}>
      <h3 className="pl-panel-title mb-0 notranslate" translate="no">{heading}</h3>
      {rows.length === 0 ? (
        emptyText ? <p className="pl-notice text-xs mt-1">{emptyText}</p> : null
      ) : (
        <ul className="list-none p-0 mt-1 grid gap-1" data-testid={`${testId}-rows`}>
          {rows.map((row) => (
            <li key={row.key} className="text-sm">
              <span className="text-fg-default notranslate" translate="no">{row.primary}</span>
              {row.secondary ? (
                <span className="text-xs text-fg-muted notranslate" translate="no">{" "}· {row.secondary}</span>
              ) : null}
              {row.extra}
            </li>
          ))}
        </ul>
      )}
      {note ? <p className="text-xs text-fg-muted mt-1 notranslate" translate="no">{note}</p> : null}
    </section>
  );
}

function TableEntry({ table, expanded, onToggle }: {
  table: PublishImpactTable;
  expanded: boolean;
  onToggle: () => void;
}) {
  const identity = table.identity;
  if (!identity) return null;
  const reasons = table.reasons ?? [];

  return (
    <li className="rounded-md border border-border-default bg-bg-surface p-2" data-testid="publish-impact-table">
      {/* The full identity — never a bare table name, never truncated. */}
      <p className="text-sm text-fg-default break-all notranslate" translate="no">{identityText(identity)}</p>
      {reasons.length === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">影响原因：待核对</p>
      ) : (
        <ul className="list-none p-0 mt-1 grid gap-1" data-testid="publish-impact-reasons">
          {reasons.map((reason: PublishImpactReason, index: number) => (
            <li key={`${reason.kind}-${reason.evidenceRef}-${index}`} className="text-sm">
              <span className="text-fg-muted">影响原因：</span>
              <span className="text-fg-default notranslate" translate="no">{reason.summary}</span>
              <span className="ml-1 rounded-pill border border-border-default px-1.5 py-0.5 text-xs notranslate" translate="no">
                {REASON_KIND_LABEL[reason.kind]}
              </span>
              <span className="ml-1 text-xs text-fg-muted">变更来源：{REASON_SOURCE_LABEL[reason.source]}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button" className="pl-btn pl-btn--ghost pl-btn--xs mt-1"
        aria-expanded={expanded} onClick={onToggle} data-testid="publish-impact-evidence-toggle"
      >
        {expanded ? "收起变更证据" : "展开变更证据"}
      </button>
      {expanded ? (
        <div className="mt-1 grid gap-2" data-testid="publish-impact-evidence-area">
          {reasons.filter((reason) => Boolean(reason.evidenceRef)).map((reason, index) => (
            <div key={`${reason.evidenceRef}-${index}`}>
              <p className="text-xs text-fg-muted">{REASON_KIND_LABEL[reason.kind]} · {reason.summary}</p>
              <p className="text-xs text-fg-muted notranslate" translate="no">{reason.filePath}</p>
              <PublishEvidenceBlock evidenceRef={reason.evidenceRef} />
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function PublishImpactReview(props: PublishImpactReviewProps) {
  const { impact, hideSearch } = props;
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  // A new content version invalidates the expanded evidence (its references
  // belong to the previous snapshot). The search text and the folded groups
  // stay — they are the operator's reading position, not server state.
  useEffect(() => {
    setExpandedTables({});
  }, [impact.pendingDigest]);

  const counts = impact.counts;
  const tables = impact.tables ?? [];
  const wikiChanges = impact.wikiChanges ?? [];
  const schemaChanges = impact.schemaChanges ?? [];
  const relatedScope = impact.relatedScope ?? [];
  const otherChanges = impact.otherChanges ?? [];
  const unresolved = impact.unresolved ?? [];

  const groups = useMemo(() => groupTables(tables), [tables]);
  const visibleGroups = useMemo(
    () => groups
      .map((group) => ({ group, visible: group.tables.filter((t) => matchesQuery(t, search)) }))
      .filter((entry) => entry.visible.length > 0),
    [groups, search]
  );
  const totalTables = tables.length;
  const shownTables = visibleGroups.reduce((sum, entry) => sum + entry.visible.length, 0);
  const blockingReasons = unresolved.filter((entry) => entry.blocking);

  // The non-table blocks share one shape, so they are declared as data: the
  // order of this array IS the order of the sections on screen.
  const detailSections: DeclaredSection[] = [
    {
      key: "publish-impact-wiki",
      always: true,
      rowCount: wikiChanges.length,
      element: (
        <DetailSection
          data-testid="publish-impact-wiki"
          heading="业务 Wiki"
          emptyText="本次没有业务 Wiki 变更。"
          rows={wikiChanges.map((wiki, index) => ({
            key: `${wiki.filePath}-${index}`,
            primary: wiki.title ?? "未命名文档",
            secondary: `${wiki.filePath} · ${CHANGE_TYPE_LABEL[wiki.changeType] ?? wiki.changeType}`
          }))}
        />
      )
    },
    {
      key: "publish-impact-schema-changes",
      rowCount: schemaChanges.length,
      element: (
        <DetailSection
          data-testid="publish-impact-schema-changes"
          heading="Schema 级变更"
          note="这些是 Schema 级元数据变化，不计入「涉及的表」数量。"
          rows={schemaChanges.map((change, index) => ({
            key: `${change.connectionId}/${change.schema}-${index}`, primary: `${change.connectionId}/${change.schema}`
          }))}
        />
      )
    },
    {
      key: "publish-impact-related-scope",
      rowCount: relatedScope.length,
      element: (
        <DetailSection
          data-testid="publish-impact-related-scope"
          heading="关联与校验范围"
          note="这些对象只因显式引用或校验依赖被纳入核对范围，不是本次直接变更的表，也不计入「涉及的表」数量。"
          rows={relatedScope.map((entry, index) => ({
            key: `${identityText(entry.identity)}-${index}`, primary: identityText(entry.identity), secondary: entry.relationKind
          }))}
        />
      )
    },
    {
      key: "publish-impact-other-changes",
      rowCount: otherChanges.length,
      element: (
        <DetailSection
          data-testid="publish-impact-other-changes"
          heading="其它变更"
          note="其它变更不计入「涉及的表」数量。"
          rows={otherChanges.map((change, index) => ({
            key: `${change.filePath}-${index}`, primary: change.filePath,
            secondary: CHANGE_TYPE_LABEL[change.changeType] ?? change.changeType
          }))}
        />
      )
    },
    {
      key: "publish-impact-unresolved",
      rowCount: unresolved.length,
      element: (
        <DetailSection
          data-testid="publish-impact-unresolved"
          heading="影响范围待核对"
          rows={unresolved.map((entry, index) => ({
            key: `${entry.filePath}-${index}`,
            primary: entry.filePath || "（未定位到文件）",
            secondary: entry.reason,
            extra: entry.blocking ? (
              <span
                className="ml-1 rounded-pill border border-danger-strong bg-danger-soft px-1.5 py-0.5 text-xs text-danger-strong"
                data-testid="publish-impact-unresolved-blocking"
              >
                阻断
              </span>
            ) : null
          }))}
        />
      )
    }
  ];

  return (
    <div className="grid gap-4" data-testid="publish-impact-review">
      {/* 1. 范围摘要 — a compact line, not a KPI card. */}
      <section data-testid="publish-impact-summary">
        <p className="text-sm text-fg-default notranslate" translate="no">
          涉及表 {counts.tables} 张 · Schema Manifest {counts.manifests} 个 · 业务 Wiki{" "}
          {counts.wikiPages} 篇
        </p>
        <p className="text-xs text-fg-muted">待同步文件 {counts.files} 个</p>
      </section>

      {impact.complete === false ? (
        <div className="pl-validation-banner pl-validation-banner--danger" role="alert" data-testid="publish-impact-incomplete">
          <p>影响范围未完整解析，本次提交已被阻断。</p>
          {blockingReasons.length > 0 ? (
            <ul className="list-none p-0 mt-1 text-xs" data-testid="publish-impact-blocking-reasons">
              {blockingReasons.map((entry, index) => (
                <li key={`${entry.filePath}-${index}`}>
                  {entry.filePath ? `${entry.filePath}：` : ""}
                  {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* 2. 涉及的表 */}
      <section data-testid="publish-impact-tables">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="pl-panel-title mb-0">涉及的表</h3>
          <p className="text-xs text-fg-muted" data-testid="publish-impact-table-count">
            当前显示 {shownTables} / 共 {totalTables} 张
          </p>
        </div>
        {hideSearch ? null : (
          <label className="grid gap-1 mt-2 text-xs">
            <span className="text-fg-muted">按表名或原因搜索</span>
            <input
              type="search" className="pl-input text-sm" value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="按表名或原因搜索" data-testid="publish-impact-search"
            />
          </label>
        )}
        {/* Persistent: the search and the folding never shrink the range. */}
        <p className="pl-notice text-xs mt-2" data-testid="publish-impact-filter-note">
          搜索与折叠只影响展示，本次仍会同步全部范围。
        </p>
        {visibleGroups.length === 0 ? (
          <p className="pl-notice text-xs mt-2" data-testid="publish-impact-no-match">没有匹配的表</p>
        ) : null}
        {visibleGroups.map(({ group, visible }) => {
          const collapsed = collapsedGroups[group.key] === true;
          return (
            <div key={group.key} className="mt-3" data-testid="publish-impact-group">
              <button
                type="button" className="flex w-full items-center justify-between gap-2 text-left"
                aria-expanded={!collapsed}
                onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.key]: !collapsed }))}
                data-testid="publish-impact-group-toggle"
              >
                <span className="text-sm font-medium text-fg-default notranslate" translate="no">
                  连接 {group.connectionId} / Schema {group.schema}
                </span>
                {/* The group total survives the fold — a folded group is never
                    mistaken for an empty group. */}
                <span className="text-xs text-fg-muted">{group.tables.length} 张</span>
              </button>
              {collapsed ? null : (
                <ul className="list-none p-0 mt-1 grid gap-2">
                  {visible.map((table) => {
                    const identity = table.identity;
                    if (!identity) return null;
                    const tableKey = identityText(identity);
                    return (
                      <TableEntry
                        key={tableKey} table={table} expanded={expandedTables[tableKey] === true}
                        onToggle={() => setExpandedTables((prev) => ({ ...prev, [tableKey]: prev[tableKey] !== true }))}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      {/* 3–6. 业务 Wiki / Schema 级变更 / 关联与校验范围 / 影响范围待核对 */}
      {detailSections
        .filter((section) => section.always || section.rowCount > 0)
        .map((section) => (
          <Fragment key={section.key}>{section.element}</Fragment>
        ))}
    </div>
  );
}
