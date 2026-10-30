/**
 * Lucy v0.25 P1-3 — 访问关系图独立页。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §3.1  独立页 `/admin/access-map`
 *   §5.5  降级矩阵（授权面不可用 → 不渲染图；三态提示）
 *   §6.3  URL 参数（全部生效且可分享；非法值由服务端返回 400）
 *   §7.2  下钻聚焦（URL 写 focus=<nodeId>，提供「返回全图」）
 *   §7.4  图例与信号
 *   §7.5  关系图 / 数据表 切换
 *   §7.6  空态与降级态
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`
 *   §5.1  阅读顺序固定为：页头 → 工具条 → 指标卡 → 折叠区 → 主工作区
 *   §5.2  三枚信号用共享 Metric Card
 *   §5.5  聚焦面包屑「全图 / {节点名}」
 *   §5.6  视图用 `pl-admin-tabbar`；统计窗口用分段控件
 *
 * 页面是**只读展示**：不写配置、不改授权、不写审计事件。
 *
 * 路由挂载（由 W6 主持者接线，`webui/src/app/App.tsx`）：
 *
 *   const AccessMapRoute = lazyRoute(() => import("../pages/admin/AccessMap"), "AccessMap");
 *   <Route path="/admin/access-map" element={<AccessMap />} />
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";
import { AccessMapCanvas } from "../../components/admin/AccessMapCanvas";
import { AccessMapCredentialList } from "../../components/admin/AccessMapCredentialList";
import { AccessMapLegend } from "../../components/admin/AccessMapLegend";
import {
  AccessMapSignalBar,
  AccessMapSignalNotes,
  type AccessMapSignalFilter
} from "../../components/admin/AccessMapSignalBar";
import { AccessMapTable } from "../../components/admin/AccessMapTable";
import {
  ACCESS_MAP_TOKEN_FILTER_NOTICE_HEAD,
  ACCESS_MAP_TOKEN_FILTER_NOTICE_TAIL,
  accessMapGrantProblemLabel,
  accessMapWindowLabel,
  type AccessMapEdge,
  type AccessMapEdgeState,
  type AccessMapResponse
} from "../../components/admin/AccessMapTypes";

const PARAM_KEYS = [
  "agent",
  "role",
  "token",
  "table",
  "connection",
  "window",
  "layer",
  "trust",
  "view",
  "focus"
] as const;

/**
 * 统计窗口选项。
 *
 * 可见文案是给人读的（「近 7 天」），URL 值仍是可分享的技术参数（「168h」）。
 * 文案只有 `accessMapWindowLabel` 一处来源，避免以后有人把 `168h` 直接当文案显示出去。
 */
const WINDOW_OPTIONS = (["24h", "168h", "720h"] as const).map((value) => ({
  value,
  label: accessMapWindowLabel(value)
}));

function useAccessMapParams(): {
  queryString: string;
  get: (key: string) => string | null;
  setParam: (key: string, value: string | null) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryString = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of PARAM_KEYS) {
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

export function AccessMap() {
  const { queryString, get, setParam } = useAccessMapParams();
  const [signalFilters, setSignalFilters] = useState<AccessMapSignalFilter[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-access-map", queryString],
    queryFn: async () =>
      apiGet<AccessMapResponse>(
        `/api/admin/access-map${queryString ? `?${queryString}` : ""}`
      ),
    retry: false
  });

  const response = query.data;
  const view = get("view") === "table" ? "table" : "map";
  const activeToken = get("token");
  const focusNodeId = get("focus");
  const windowValue = get("window") ?? "168h";
  const layerValue = get("layer") ?? "flat";
  const trustValue = get("trust") ?? "confirmed";

  const highlightStates = useMemo<AccessMapEdgeState[] | null>(() => {
    if (signalFilters.length === 0) return null;
    const states: AccessMapEdgeState[] = [];
    if (signalFilters.includes("dormant")) states.push("dormant");
    if (signalFilters.includes("needs_review")) states.push("needs_review");
    if (signalFilters.includes("confirmed_unauthorized")) states.push("overflow");
    return states;
  }, [signalFilters]);

  const tableEdges = useMemo<AccessMapEdge[]>(() => {
    if (!response) return [];
    if (!highlightStates) return response.edges;
    return response.edges.filter((edge) => highlightStates.includes(edge.state));
  }, [response, highlightStates]);

  const toggleSignal = (filter: AccessMapSignalFilter): void => {
    setSignalFilters((current) =>
      current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter]
    );
  };

  /** 搜索定位（§7.2）：按 Agent 名 / 角色 id / 表名找到节点并聚焦。 */
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
    setParam("focus", hit.id);
  };

  const grantUnavailable = response?.meta.grant.state === "unavailable";
  const hasScopeFilter = Boolean(
    get("agent") || get("role") || get("connection") || get("table")
  );

  /** 聚焦时面包屑上的节点名。 */
  const focusLabel = useMemo(() => {
    if (!response || !focusNodeId) return null;
    return response.nodes.find((node) => node.id === focusNodeId)?.label ?? focusNodeId;
  }, [response, focusNodeId]);

  /** Esc 在抽屉关闭时清聚焦（抽屉开着时由 Radix 自己关抽屉）。 */
  const clearFocus = useCallback(() => {
    if (focusNodeId) setParam("focus", null);
  }, [focusNodeId, setParam]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="访问关系图"
        description="授权路径与窗口内实际访问对照。"
      />

      {/* 工具条：统计窗口、Schema 层、访问口径、定位、聚焦面包屑。 */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
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
          <label className="text-xs font-medium text-fg-muted" htmlFor="access-map-trust-select">
            访问口径
          </label>
          <select
            id="access-map-trust-select"
            className="pl-input"
            value={trustValue}
            data-testid="access-map-trust"
            onChange={(event) => setParam("trust", event.target.value)}
          >
            <option value="confirmed">已确认</option>
            <option value="include_candidate">含候选</option>
          </select>
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

        {searchMessage ? (
          <span className="text-xs text-fg-muted" data-testid="access-map-search-message">
            {searchMessage}
          </span>
        ) : null}
      </div>

      {/* 聚焦面包屑：全图 / {节点名}。 */}
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

      {response && activeToken ? (
        <div className="pl-notice notranslate" translate="no" data-testid="access-map-token-filter-notice">
          {ACCESS_MAP_TOKEN_FILTER_NOTICE_HEAD}
          <span className="notranslate font-mono" translate="no">{activeToken}</span>
          {ACCESS_MAP_TOKEN_FILTER_NOTICE_TAIL}
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
          <AccessMapSignalBar
            meta={response.meta}
            activeFilters={signalFilters}
            onToggleFilter={toggleSignal}
          />

          {/* 口径与快照离开首屏：默认折叠，只在读者主动展开时出现。 */}
          <details
            id="access-map-methodology"
            className="rounded-md border border-border-default bg-bg-subtle p-3"
          >
            <summary className="cursor-pointer text-sm font-medium text-fg-body">口径说明</summary>
            <div className="mt-3 flex flex-col gap-3">
              <AccessMapSignalNotes meta={response.meta} />
              <AccessMapLegend meta={response.meta} />
            </div>
          </details>

          <details
            id="access-map-snapshot"
            className="rounded-md border border-border-default bg-bg-subtle p-3"
          >
            <summary className="cursor-pointer text-sm font-medium text-fg-body">快照</summary>
            <div className="mt-3">
              <span
                className="text-xs text-fg-muted notranslate"
                translate="no"
                data-testid="access-map-snapshot-id"
              >
                config {response.meta.grant.accessConfigVersion} · policy {response.meta.grant.policyVersion}
              </span>
            </div>
          </details>

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
              已折叠 {response.meta.folded.nodes} 个节点（表格视图仍展示全量）
            </div>
          ) : null}

          {response.nodes.length === 0 ? (
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
          ) : view === "table" ? (
            <AccessMapTable nodes={response.nodes} edges={tableEdges} />
          ) : (
            <AccessMapCanvas
              nodes={response.render.nodes}
              edges={response.render.edges}
              focusNodeId={focusNodeId}
              highlightStates={highlightStates}
              summary={`访问关系图：${response.render.nodes.length} 个节点，${response.render.edges.length} 条边，需复核 ${response.meta.signals.needsReviewEdges} 条，确凿越权 ${response.meta.signals.confirmedUnauthorizedEdges} 条。`}
              onSelectNode={(nodeId) => setParam("focus", nodeId)}
              onClearFocus={clearFocus}
            />
          )}

          <AccessMapCredentialList
            nodes={response.nodes}
            activeToken={activeToken}
            onSelectToken={(label) => setParam("token", label)}
          />
        </>
      ) : null}
    </div>
  );
}

export default AccessMap;
