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
 * 页面是**只读展示**：不写配置、不改授权、不写审计事件。
 *
 * 路由挂载（由 W6 主持者接线，`webui/src/app/App.tsx`）：
 *
 *   const AccessMapRoute = lazyRoute(() => import("../pages/admin/AccessMap"), "AccessMap");
 *   <Route path="/admin/access-map" element={<AccessMap />} />
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";
import { AccessMapCanvas } from "../../components/admin/AccessMapCanvas";
import { AccessMapCredentialList } from "../../components/admin/AccessMapCredentialList";
import { AccessMapLegend } from "../../components/admin/AccessMapLegend";
import {
  AccessMapSignalBar,
  type AccessMapSignalFilter
} from "../../components/admin/AccessMapSignalBar";
import { AccessMapTable } from "../../components/admin/AccessMapTable";
import {
  accessMapGrantProblemLabel,
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="访问关系图"
        description="把 Agent 的授权面与实际访问面叠在同一张图上：流带宽度是授权路径数，内核是访问路径数。"
        badges={
          response ? (
            <span className="text-xs text-fg-muted notranslate" translate="no" data-testid="access-map-snapshot-id">
              config {response.meta.grant.accessConfigVersion} · policy {response.meta.grant.policyVersion}
            </span>
          ) : null
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`pl-btn text-xs ${view === "map" ? "pl-btn--primary" : "pl-btn--ghost"}`}
              aria-pressed={view === "map"}
              data-testid="access-map-view-map"
              onClick={() => setParam("view", "map")}
            >
              关系图
            </button>
            <button
              type="button"
              className={`pl-btn text-xs ${view === "table" ? "pl-btn--primary" : "pl-btn--ghost"}`}
              aria-pressed={view === "table"}
              data-testid="access-map-view-table"
              onClick={() => setParam("view", "table")}
            >
              数据表
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          统计窗口
          <select
            className="pl-input"
            value={get("window") ?? "168h"}
            data-testid="access-map-window"
            onChange={(event) => setParam("window", event.target.value)}
          >
            <option value="24h">24h</option>
            <option value="168h">168h</option>
            <option value="720h">720h</option>
          </select>
        </label>
        <label className="flex items-center gap-1 notranslate" translate="no">
          Schema 层
          <select
            className="pl-input"
            value={get("layer") ?? "flat"}
            data-testid="access-map-layer"
            onChange={(event) => setParam("layer", event.target.value)}
          >
            <option value="flat">折叠（flat）</option>
            <option value="schema" className="notranslate" translate="no">
              展开（schema）
            </option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          访问口径
          <select
            className="pl-input"
            value={get("trust") ?? "confirmed"}
            data-testid="access-map-trust"
            onChange={(event) => setParam("trust", event.target.value)}
          >
            <option value="confirmed">已确认</option>
            <option value="include_candidate">含候选</option>
          </select>
        </label>
        {focusNodeId ? (
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-back-to-full"
            onClick={() => setParam("focus", null)}
          >
            返回全图
          </button>
        ) : null}
        <span className="flex items-center gap-1">
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
            className="pl-btn pl-btn--ghost text-xs"
            data-testid="access-map-search-submit"
            onClick={runSearch}
          >
            定位
          </button>
        </span>
        {searchMessage ? (
          <span className="text-xs text-fg-muted" data-testid="access-map-search-message">
            {searchMessage}
          </span>
        ) : null}
      </div>

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
          已按 Token <span className="notranslate font-mono" translate="no">{activeToken}</span> 过滤访问层，授权层不受影响。
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
            response={response}
            activeFilters={signalFilters}
            onToggleFilter={toggleSignal}
          />
          <AccessMapLegend meta={response.meta} />

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
