/**
 * 访问关系图独立页。
 *
 * Authority:
 *   `webui/docs/187-access-relation-sankey-spec.md`（授权骨架／边状态／几何不变）
 *   `docs/specs/lucy-20261104-access-map-hourly-detail-spec.md` §5（页壳／小时明细／§5.5）
 *
 * 本轮呈现：去掉凭证清单与 Token UI；口径常驻行（窗口＋覆盖率＋哈希）；
 * 「数据表」= 小时明细；§5.5 状态矩阵全分支。
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiGet } from "../../lib/apiClient";
import { useUrlMirroredField } from "../../lib/useUrlMirroredField";
import { PageHeader } from "../../components/PageHeader";
import { AccessMapCanvas } from "../../components/admin/AccessMapCanvas";
import { AccessMapLegend, AccessMapLegendMeta } from "../../components/admin/AccessMapLegend";
import { AccessMapTable } from "../../components/admin/AccessMapTable";
import {
  ACCESS_MAP_ACCESS_GRADE_OPTIONS,
  ACCESS_MAP_DEFAULT_ACCESS_GRADE,
  ACCESS_MAP_DEFAULT_INQUIRY_KIND,
  ACCESS_MAP_INQUIRY_KIND_OPTIONS,
  accessMapAccessGradeLabel,
  accessMapCoverageCompressedText,
  accessMapGrantProblemLabel,
  accessMapInquiryKindLabel,
  accessMapWindowLabel,
  type AccessMapAccessGradeFilter,
  type AccessMapHourlyDetail,
  type AccessMapInquiryKindFilter,
  type AccessMapMeta,
  type AccessMapResponse
} from "../../components/admin/AccessMapTypes";

const PARAM_KEYS = [
  "agent",
  "role",
  "table",
  "connection",
  "window",
  "layer",
  "trust",
  "inquiryKind",
  "accessGrade",
  "view",
  "focus",
  "detailLimit",
  "detailOffset"
] as const;

/** 变更这些筛选时重置 detailOffset（Spec D10）。 */
const FILTER_RESET_OFFSET_KEYS = new Set([
  "agent",
  "role",
  "table",
  "connection",
  "window",
  "layer",
  "inquiryKind",
  "accessGrade",
  "view",
  "focus"
]);

const WINDOW_OPTIONS = (["24h", "168h", "720h"] as const).map((value) => ({
  value,
  label: accessMapWindowLabel(value)
}));

function useAccessMapParams(): {
  queryString: string;
  get: (key: string) => string | null;
  setParam: (key: string, value: string | null) => void;
  clearParams: (keys: readonly string[]) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of PARAM_KEYS) {
      // Spec 20261105 D13：首屏非法 trust（含空串／重复键）原样发给 API，不得先删改。
      if (key === "trust") {
        if (!searchParams.has("trust")) continue;
        for (const value of searchParams.getAll("trust")) {
          next.append("trust", value);
        }
        continue;
      }
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  }, [searchParams]);

  return {
    queryString,
    get: (key: string) => searchParams.get(key),
    setParam: (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null || value.length === 0) next.delete(key);
      else next.set(key, value);
      if (FILTER_RESET_OFFSET_KEYS.has(key) && key !== "detailOffset") {
        next.delete("detailOffset");
        // Spec D13：用户主动改其它筛选时省略 trust（不再掩盖首屏 400 的地址栏）。
        next.delete("trust");
      }
      setSearchParams(next, { replace: false });
    },
    clearParams: (keys: readonly string[]) => {
      const next = new URLSearchParams(searchParams);
      for (const key of keys) next.delete(key);
      next.delete("detailOffset");
      next.delete("trust");
      setSearchParams(next, { replace: false });
    }
  };
}

function errorMessageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (message) return message;
  }
  return "访问关系图加载失败";
}

type ResidentLineProps = {
  meta: AccessMapMeta;
  inquiryKindValue: AccessMapInquiryKindFilter;
  accessGradeValue: AccessMapAccessGradeFilter;
};

/** 图下／表上常驻口径行：现状 + 窗口起止 + 覆盖率压缩句 + 快照哈希（关联口径为静态披露）。 */
function AccessMapResidentLine({
  meta,
  inquiryKindValue,
  accessGradeValue
}: ResidentLineProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border-default bg-bg-subtle px-3 py-2 text-xs text-fg-muted"
      data-testid="access-map-resident-line"
    >
      <p data-testid="access-map-filter-status">
        关联口径：已确认关联 · 问询种类：
        {accessMapInquiryKindLabel(inquiryKindValue)} · 访问等级：
        {accessMapAccessGradeLabel(accessGradeValue)}
      </p>
      <p className="notranslate" translate="no" data-testid="access-map-window-range">
        窗口起止：{meta.window.startIso} ~ {meta.window.endIso}
      </p>
      <p data-testid="access-map-snapshot-coverage">
        {accessMapCoverageCompressedText(meta.snapshotCoverage)}
        <span className="ml-1 text-warning-strong">
          低覆盖率不代表低越权率：缺失快照只保留需复核，不判确凿越权。
        </span>
      </p>
      <span
        className="notranslate"
        translate="no"
        data-testid="access-map-snapshot-id"
      >
        config {meta.grant.accessConfigVersion} · policy {meta.grant.policyVersion}
      </span>
    </div>
  );
}

function TableViewBody({
  response,
  detail,
  onPageChange
}: {
  response: AccessMapResponse;
  detail: AccessMapHourlyDetail | null | undefined;
  onPageChange: (nextOffset: number) => void;
}) {
  const accessUnavailable = response.meta.access.state === "unavailable";

  if (accessUnavailable || detail === null) {
    return (
      <div className="pl-notice" data-testid="access-map-table-access-unavailable">
        审计数据不可用，无法展示调用明细。
        {response.meta.access.reason ? (
          <span className="ml-1 text-fg-muted">{response.meta.access.reason}</span>
        ) : null}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="pl-notice" data-testid="access-map-table-loading">
        正在加载调用明细…
      </div>
    );
  }

  // 分页越界：有总行数但本页为空（§5.5）——不得写成「无调用」。
  if (detail.rows.length === 0 && detail.totalRowCount > 0) {
    return (
      <div className="pl-notice" data-testid="access-map-table-page-overflow">
        <p className="text-sm">本页没有数据（偏移超出明细末尾）。</p>
        <button
          type="button"
          className="pl-btn pl-btn--ghost mt-2 text-xs"
          data-testid="access-map-table-back-first-page"
          onClick={() => onPageChange(0)}
        >
          回到第一页
        </button>
      </div>
    );
  }

  // 真实零行（E∪D 空）：可调窗口／筛选；禁止「尚无 Agent 授权关系」。
  if (detail.rows.length === 0 && detail.totalRowCount === 0) {
    return (
      <div className="pl-notice" data-testid="access-map-table-empty">
        <p className="text-sm">
          当前窗口与筛选下没有调用明细。可调整统计窗口、问询种类或访问等级后再看。
        </p>
      </div>
    );
  }

  return (
    <AccessMapTable detail={detail} nodes={response.nodes} onPageChange={onPageChange} />
  );
}

export function AccessMap() {
  const { queryString, get, setParam, clearParams } = useAccessMapParams();
  const [searchText, setSearchText] = useState("");
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // ── 局部状态镜像（Spec lucy-20261029 §5.2／§5.3）────────────────────────
  // Agent／连接文本筛选框的 `value` 由本地 draft 驱动，URL 作为下游事实源跟随；
  // 反向同步走回声协议（与 Audit 同构）。禁止把 value 直接绑到 get("agent")。
  const agentMirror = useUrlMirroredField({
    read: (sp) => sp.get("agent") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("agent", raw);
      else next.delete("agent");
      // 与既有 setParam("agent") 同口径：改 Agent 时清 focus／detailOffset／trust。
      next.delete("focus");
      next.delete("detailOffset");
      next.delete("trust");
      return next;
    },
    history: "push"
  });
  const connectionMirror = useUrlMirroredField({
    read: (sp) => sp.get("connection") ?? "",
    write: (prev, raw) => {
      const next = new URLSearchParams(prev);
      if (raw) next.set("connection", raw);
      else next.delete("connection");
      next.delete("detailOffset");
      next.delete("trust");
      return next;
    },
    history: "push"
  });

  const query = useQuery({
    queryKey: ["admin-access-map", queryString],
    queryFn: async () =>
      apiGet<AccessMapResponse>(
        `/api/admin/access-map${queryString ? `?${queryString}` : ""}`
      ),
    retry: false,
    // 持久筛选改 URL 时保留上一帧图，避免点 Agent／连接瞬间空白。
    placeholderData: (previous) => previous
  });

  const response = query.data;
  const view = get("view") === "table" ? "table" : "map";
  const focusNodeId = get("focus");
  const windowValue = get("window") ?? "168h";
  const layerValue = get("layer") ?? "flat";
  const inquiryKindRaw = get("inquiryKind");
  const inquiryKindValue: AccessMapInquiryKindFilter =
    (inquiryKindRaw as AccessMapInquiryKindFilter | null) ?? ACCESS_MAP_DEFAULT_INQUIRY_KIND;
  const accessGradeRaw = get("accessGrade");
  const accessGradeValue: AccessMapAccessGradeFilter =
    (accessGradeRaw as AccessMapAccessGradeFilter | null) ?? ACCESS_MAP_DEFAULT_ACCESS_GRADE;

  const setInquiryKind = (next: string): void => {
    setParam("inquiryKind", !next || next === ACCESS_MAP_DEFAULT_INQUIRY_KIND ? null : next);
  };
  const setAccessGrade = (next: string): void => {
    setParam("accessGrade", !next || next === ACCESS_MAP_DEFAULT_ACCESS_GRADE ? null : next);
  };

  const setDetailOffset = (nextOffset: number): void => {
    setParam("detailOffset", nextOffset <= 0 ? null : String(nextOffset));
  };

  const runSearch = (): void => {
    const needle = searchText.trim().toLowerCase();
    if (!needle || !response) {
      setSearchMessage(null);
      return;
    }
    const hit = response.nodes.find(
      (node) =>
        node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle)
    );
    if (!hit) {
      setSearchMessage(`没有匹配「${searchText.trim()}」的节点`);
      return;
    }
    setSearchMessage(null);
    // S8：Agent 定位写 agent=；连接写 focus=；其它节点写 focus=。
    if (hit.kind === "agent") {
      const agentId = hit.id.startsWith("agent:") ? hit.id.slice("agent:".length) : hit.id;
      setParam("focus", null);
      setParam("agent", agentId);
      return;
    }
    if (hit.kind === "connection") {
      setParam("agent", null);
      setParam("focus", hit.id);
      return;
    }
    setParam("focus", hit.id);
  };

  const grantUnavailable = response?.meta.grant.state === "unavailable";
  const hasScopeFilter = Boolean(
    get("agent") || get("role") || get("connection") || get("table")
  );

  const focusLabel = useMemo(() => {
    if (!response || !focusNodeId) return null;
    return response.nodes.find((node) => node.id === focusNodeId)?.label ?? focusNodeId;
  }, [response, focusNodeId]);

  const clearFocus = useCallback(() => {
    if (focusNodeId) setParam("focus", null);
  }, [focusNodeId, setParam]);

  const resetAgentDraft = agentMirror.reset;
  const resetConnectionDraft = connectionMirror.reset;
  const clearStructureFilters = useCallback(() => {
    clearParams(["agent", "role", "connection", "table", "focus"]);
    // INV-3：URL 可能本就空；清除筛选必须显式归零草稿。
    resetAgentDraft("");
    resetConnectionDraft("");
  }, [clearParams, resetAgentDraft, resetConnectionDraft]);

  const persistStructureFromNode = useCallback(
    (node: { id: string; kind: string }) => {
      if (node.kind === "agent") {
        const agentId = node.id.startsWith("agent:") ? node.id.slice("agent:".length) : node.id;
        setParam("focus", null);
        setParam("agent", agentId);
        return;
      }
      if (node.kind === "connection") {
        setParam("agent", null);
        setParam("focus", node.id);
      }
    },
    [setParam]
  );

  const agentFilter = get("agent");
  const connectionFilter = get("connection");
  const hasPersistentStructure = Boolean(
    agentFilter || get("role") || connectionFilter || get("table") || focusNodeId
  );

  /** SC-29：深链到访问日志调用流水；window→hours；agent→user。 */
  const auditCallsHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("view", "calls");
    const hours =
      windowValue === "24h" ? "24" : windowValue === "720h" ? "720" : "168";
    params.set("hours", hours);
    if (inquiryKindRaw) params.set("inquiryKind", inquiryKindRaw);
    else params.set("inquiryKind", ACCESS_MAP_DEFAULT_INQUIRY_KIND);
    if (accessGradeRaw) params.set("accessGrade", accessGradeRaw);
    else params.set("accessGrade", ACCESS_MAP_DEFAULT_ACCESS_GRADE);
    if (agentFilter) params.set("user", agentFilter);
    // 与 map 默认 E 一致：排除 protocol（不设 includeProtocol）。
    return `/admin/audit?${params.toString()}`;
  }, [windowValue, inquiryKindRaw, accessGradeRaw, agentFilter]);

  const residentLine =
    response && !grantUnavailable ? (
      <AccessMapResidentLine
        meta={response.meta}
        inquiryKindValue={inquiryKindValue}
        accessGradeValue={accessGradeValue}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="访问关系图"
        description="授权路径与窗口内实际访问对照。"
      />

      <div
        className="flex flex-wrap items-end gap-x-6 gap-y-3"
        data-testid="access-map-toolbar"
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">统计窗口</span>
          <div
            className="pl-segmented-control"
            role="tablist"
            aria-label="统计窗口"
            data-testid="access-map-window"
          >
            {WINDOW_OPTIONS.map((option) => {
              const active = windowValue === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  className={
                    active
                      ? "pl-segmented-control-item pl-segmented-control-item--active"
                      : "pl-segmented-control-item"
                  }
                  aria-selected={active}
                  aria-pressed={active}
                  onClick={() => setParam("window", option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium text-fg-muted notranslate"
            translate="no"
            htmlFor="access-map-layer-select"
          >
            Schema 层
          </label>
          <select
            id="access-map-layer-select"
            className="pl-input notranslate"
            translate="no"
            value={layerValue}
            data-testid="access-map-layer"
            onChange={(event) => setParam("layer", event.target.value)}
          >
            <option value="flat">折叠</option>
            <option value="schema">展开</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="access-map-inquiry-kind-select">
            问询种类
          </label>
          <select
            id="access-map-inquiry-kind-select"
            className="pl-input"
            aria-label="问询种类"
            data-testid="access-map-inquiry-kind"
            value={inquiryKindValue === ACCESS_MAP_DEFAULT_INQUIRY_KIND ? "" : inquiryKindValue}
            onChange={(event) => setInquiryKind(event.target.value)}
          >
            {ACCESS_MAP_INQUIRY_KIND_OPTIONS.map((option) => (
              <option key={option.value || "management"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="access-map-access-grade-select">
            访问等级
          </label>
          <select
            id="access-map-access-grade-select"
            className="pl-input"
            aria-label="访问等级"
            data-testid="access-map-access-grade"
            value={accessGradeValue === ACCESS_MAP_DEFAULT_ACCESS_GRADE ? "" : accessGradeValue}
            onChange={(event) => setAccessGrade(event.target.value)}
          >
            {ACCESS_MAP_ACCESS_GRADE_OPTIONS.map((option) => (
              <option key={option.value || "exclude_connect"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-xs font-medium text-fg-muted notranslate"
            translate="no"
            htmlFor="access-map-agent-filter"
          >
            Agent
          </label>
          <input
            id="access-map-agent-filter"
            className="pl-input w-40 notranslate"
            translate="no"
            placeholder="写入 agent="
            aria-label="按 Agent 筛选行为轨迹"
            data-testid="access-map-agent-filter"
            value={agentMirror.value}
            onChange={(event) => agentMirror.onChange(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted" htmlFor="access-map-connection-filter">
            连接
          </label>
          <input
            id="access-map-connection-filter"
            className="pl-input w-40 notranslate"
            translate="no"
            placeholder="写入 connection="
            aria-label="按连接筛选"
            data-testid="access-map-connection-filter"
            value={connectionMirror.value}
            onChange={(event) => connectionMirror.onChange(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">定位</span>
          <div className="flex items-center gap-1">
            <input
              className="pl-input w-52 notranslate"
              translate="no"
              placeholder="按 Agent / 角色 / 表名定位"
              aria-label="按 Agent、角色或表名定位并聚焦"
              data-testid="access-map-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
            <button
              type="button"
              className="pl-icon-btn pl-btn pl-btn--ghost px-2"
              aria-label="定位"
              data-testid="access-map-search-submit"
              onClick={runSearch}
            >
              <Search className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {hasPersistentStructure ? (
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-clear-structure"
            onClick={clearStructureFilters}
          >
            清除筛选（回全图）
          </button>
        ) : null}

        <Link
          to={auditCallsHref}
          className="pl-btn pl-btn--ghost text-xs underline"
          data-testid="access-map-audit-deeplink"
        >
          对照访问日志
        </Link>

        {searchMessage ? (
          <span className="text-xs text-fg-muted" data-testid="access-map-search-message">
            {searchMessage}
          </span>
        ) : null}
      </div>

      {focusNodeId ? (
        <nav aria-label="聚焦位置" className="text-xs text-fg-muted">
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-back-to-full"
            onClick={() => setParam("focus", null)}
          >
            全图
          </button>
          <span> / </span>
          <span className="notranslate" translate="no">
            {focusLabel}
          </span>
        </nav>
      ) : null}

      {query.isError ? (
        <div className="pl-notice" data-testid="access-map-error">
          <p className="text-sm text-danger-strong">{errorMessageOf(query.error)}</p>
          <p className="mt-1 text-xs text-fg-muted">
            URL 参数非法时不会静默纠正；请修正参数后重试。
          </p>
        </div>
      ) : null}

      {response?.meta.grant.state === "partial" ? (
        <div className="pl-notice notranslate" translate="no" data-testid="access-map-partial-notice">
          {response.meta.grant.failures.length} 个 Agent 授权未能解析，结果不完整。
          <Link to="/admin/config-audit" className="ml-2 underline">
            前往配置审计
          </Link>
        </div>
      ) : null}

      {response?.meta.access.state === "unavailable" ? (
        <div className="pl-notice" data-testid="access-map-access-unavailable">
          审计数据不可用，访问层已降级为授权面。
          {response.meta.access.reason ? <span className="ml-1 text-fg-muted">{response.meta.access.reason}</span> : null}
        </div>
      ) : null}

      {grantUnavailable ? (
        <div className="pl-notice" data-testid="access-map-grant-unavailable">
          <p className="text-sm">{accessMapGrantProblemLabel(response?.meta.grant.problem ?? null)}</p>
          <Link to="/admin/config-audit" className="mt-1 inline-block underline">
            前往配置审计
          </Link>
        </div>
      ) : null}

      {response && !grantUnavailable ? (
        <>
          <div className="pl-admin-tabbar" role="tablist" aria-label="访问关系图视图">
            <button
              type="button"
              role="tab"
              className={view === "map" ? "pl-admin-tab pl-admin-tab--active" : "pl-admin-tab"}
              aria-selected={view === "map"}
              aria-pressed={view === "map"}
              data-testid="access-map-view-map"
              onClick={() => setParam("view", "map")}
            >
              关系图
            </button>
            <button
              type="button"
              role="tab"
              className={view === "table" ? "pl-admin-tab pl-admin-tab--active" : "pl-admin-tab"}
              aria-selected={view === "table"}
              aria-pressed={view === "table"}
              data-testid="access-map-view-table"
              onClick={() => setParam("view", "table")}
            >
              数据表
            </button>
          </div>

          {response.meta.folded.nodes > 0 ? (
            <div className="text-xs text-fg-muted" data-testid="access-map-folded-badge">
              已折叠 {response.meta.folded.nodes} 个节点
            </div>
          ) : null}

          {response.meta.echo ? (
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted"
              data-testid="access-map-echo-allow-calls"
            >
              <span data-testid="access-map-entering-allow-calls">
                进入允许调用 {response.meta.echo.enteringAllowCallCount}
              </span>
              {hasPersistentStructure &&
              typeof response.meta.echo.projectedAllowCallCount === "number" ? (
                <span data-testid="access-map-projected-allow-calls">
                  当前投影允许调用 {response.meta.echo.projectedAllowCallCount}
                </span>
              ) : null}
            </div>
          ) : null}

          {response.nodes.length > 0 &&
          response.meta.access.state === "ok" &&
          response.meta.echo?.enteringAllowCallCount === 0 ? (
            <div className="pl-notice" data-testid="access-map-empty-access">
              <p className="text-sm">
                当前问询种类为「{accessMapInquiryKindLabel(inquiryKindValue)}」、访问等级为「
                {accessMapAccessGradeLabel(accessGradeValue)}」时，没有进入访问路径的允许调用；授权骨架仍按当前授权显示。可调整筛选后再看。
              </p>
            </div>
          ) : null}

          {view === "table" ? (
            <>
              {residentLine}
              <TableViewBody
                response={response}
                detail={response.detail}
                onPageChange={setDetailOffset}
              />
            </>
          ) : response.nodes.length === 0 ? (
            <div className="pl-notice" data-testid="access-map-empty">
              {hasScopeFilter ? (
                <p className="text-sm notranslate" translate="no">
                  当前筛选范围内没有匹配的关系。
                </p>
              ) : (
                <>
                  <p className="text-sm notranslate" translate="no">
                    尚无 Agent 授权关系。
                  </p>
                  <Link to="/admin/agents" className="mt-1 inline-block underline notranslate" translate="no">
                    前往 Agent 凭据
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <AccessMapLegend />
              <AccessMapLegendMeta meta={response.meta} />
              <AccessMapCanvas
                nodes={response.render.nodes}
                edges={response.render.edges}
                censusNodes={response.nodes}
                censusEdges={response.edges}
                focusNodeId={focusNodeId}
                accessOk={response.meta.access.state === "ok"}
                summary={`访问关系图：${response.render.nodes.length} 个节点，${response.render.edges.length} 条边，需复核 ${response.meta.signals.needsReviewEdges} 条，确凿越权 ${response.meta.signals.confirmedUnauthorizedEdges} 条。`}
                onClearFocus={clearFocus}
                onPersistStructureFilter={persistStructureFromNode}
              />
              {residentLine}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

export default AccessMap;
