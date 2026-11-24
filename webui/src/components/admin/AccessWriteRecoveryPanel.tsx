import type { RolePermissionDraft } from "../../lib/rolePermissionDraft";
import {
  MSG_DRAFT_MATCHES_CURRENT,
  MSG_PUBLISH_BUSY,
  MSG_SAVE_PENDING,
  type AccessWriteStatusResult,
  type ClassifiedRolesAgentWriteError
} from "../../lib/rolesAgentAccessWrite";

export type RoleDraftCompareColumn = {
  title: string;
  draft: RolePermissionDraft;
  subtitle?: string;
  fields?: Array<{ label: string; value: string }>;
};

type AccessWriteRecoveryPanelProps = {
  error?: ClassifiedRolesAgentWriteError | null;
  pending?: { operationId: string; status?: AccessWriteStatusResult; checking?: boolean } | null;
  compare?: {
    baseline: RoleDraftCompareColumn;
    mine: RoleDraftCompareColumn;
    current: RoleDraftCompareColumn | null;
    draftMatchesCurrent?: boolean;
  } | null;
  onDismiss?: () => void;
  onRepreview?: () => void;
  onRefreshCurrent?: () => void;
  onRecheckStatus?: () => void;
  onDiscardDraft?: () => void;
};

function draftSummary(draft: RolePermissionDraft): { description: string; tools: number; tables: string } {
  const tables =
    draft.scope.mode === "catalog_bound"
      ? `目录绑定 · ${draft.scope.connections.length} 个连接`
      : `${draft.scope.tables.length} 张表`;
  return {
    description: draft.description.trim() || "（无说明）",
    tools: draft.tools.length,
    tables
  };
}

function CompareColumn({ column }: { column: RoleDraftCompareColumn }) {
  const summary = draftSummary(column.draft);
  return (
    <div className="pl-card grid gap-2 p-3" data-testid={`access-write-compare-${column.title}`}>
      <p className="text-sm font-semibold">{column.title}</p>
      {column.subtitle ? <p className="text-xs text-fg-muted">{column.subtitle}</p> : null}
      {column.fields ? <dl className="grid gap-2 text-xs">
        {column.fields.map((field) => <div key={field.label}><dt className="text-fg-muted">{field.label}</dt>
          <dd className="notranslate whitespace-pre-wrap break-words" translate="no">{field.value}</dd></div>)}
      </dl> : <><dl className="grid gap-1 text-xs text-fg-muted">
        <div>
          <dt>说明</dt>
          <dd className="font-medium text-fg-default">{summary.description}</dd>
        </div>
        <div>
          <dt className="notranslate" translate="no">
            MCP 工具
          </dt>
          <dd className="font-medium text-fg-default">{summary.tools}</dd>
        </div>
        <div>
          <dt>表范围</dt>
          <dd className="font-medium text-fg-default">{summary.tables}</dd>
        </div>
      </dl>
      <details className="text-xs" data-testid="access-write-permission-values">
        <summary className="cursor-pointer">权限明细</summary>
        <div className="mt-2 max-h-64 overflow-auto notranslate whitespace-pre-wrap break-words" translate="no">
          <p>{column.draft.tools.join("\n") || "—"}</p>
          {column.draft.scope.mode === "catalog_bound"
            ? <p>{column.draft.scope.connections.join("\n") || "—"}</p>
            : column.draft.scope.tables.map((table) => <div key={`${table.connection}/${table.schema}/${table.name}`} className="mt-2">
                <p>{table.connection}/{table.schema}/{table.name}</p>
                {table.rowPolicyTemplate ? <p>{table.rowPolicyTemplate}</p> : null}
                <p>{table.predicates?.map(predicate => `${predicate.field} ${predicate.op} ${JSON.stringify(predicate.value)}`).join("\n") || "全部行"}</p>
              </div>)}
        </div>
      </details></>}
    </div>
  );
}

export function AccessWriteRecoveryPanel({
  error,
  pending,
  compare,
  onDismiss,
  onRepreview,
  onRefreshCurrent,
  onRecheckStatus,
  onDiscardDraft
}: AccessWriteRecoveryPanelProps) {
  if (!error && !pending && !compare) return null;

  const title = pending
    ? MSG_SAVE_PENDING
    : error?.kind === "publish_busy"
      ? MSG_PUBLISH_BUSY
      : error?.userMessage ?? "保存未完成";

  return (
    <section
      className="rounded-md border border-warning-strong bg-warning-soft p-4 text-sm text-fg-default"
      role="region"
      aria-live="polite"
      data-testid="access-write-recovery-panel"
    >
      <h2 className="text-base font-semibold text-warning-strong">{title}</h2>
      {pending ? (
        <p className="mt-2 text-sm">
          请求编号（<span className="notranslate" translate="no">operationId</span>）：
          <code className="notranslate ml-1 text-xs" translate="no">
            {pending.operationId}
          </code>
          {pending.status?.outcome === "unknown" ? " · 终态仍未知" : null}
        </p>
      ) : null}
      {error?.requestId ? (
        <p className="mt-1 text-xs text-fg-muted">
          请求编号：{error.requestId}
          {error.code ? (
            <>
              {" "}
              · 工程码 <span className="notranslate" translate="no">{error.code}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {compare ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3" data-testid="access-write-three-way-compare">
          <CompareColumn column={compare.baseline} />
          <CompareColumn column={compare.mine} />
          {compare.current ? (
            <CompareColumn column={compare.current} />
          ) : (
            <div className="pl-card flex items-center justify-center p-3 text-xs text-fg-muted">尚未读取当前值</div>
          )}
        </div>
      ) : null}

      {compare?.draftMatchesCurrent ? (
        <p className="mt-3 text-sm text-fg-muted" data-testid="access-write-draft-matches-current">
          {MSG_DRAFT_MATCHES_CURRENT}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-fg-muted">权限字段不会自动合并；请手动比较后重新预览并确认保存。不提供强制覆盖。</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {onRefreshCurrent ? (
          <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={onRefreshCurrent} data-testid="access-write-refresh-current">
            读取最新值
          </button>
        ) : null}
        {onRepreview ? (
          <button type="button" className="pl-btn pl-btn--primary text-sm" onClick={onRepreview} data-testid="access-write-repreview">
            重新预览
          </button>
        ) : null}
        {pending && onRecheckStatus ? (
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-sm"
            onClick={onRecheckStatus}
            disabled={pending.checking}
            data-testid="access-write-recheck-status"
          >
            {pending.checking ? "核对中…" : "再次核对保存结果"}
          </button>
        ) : null}
        {onDiscardDraft ? (
          <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={onDiscardDraft}>
            放弃本地修改
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="pl-btn pl-btn--ghost text-sm" onClick={onDismiss}>
            关闭提示
          </button>
        ) : null}
      </div>
    </section>
  );
}
