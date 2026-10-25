/**
 * Lucy v0.25 P1 — L25-14 R3: 行权限视图（按表反查）.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.3（R3 按表读取模型）, §6.2（独立行权限视图）; RTV-01 … RTV-08;
 *   P1-D5（独立只读）.
 *
 * This page is READ-ONLY. It offers no editing control of any kind: the row
 * conditions of a table are changed through the Role editor and the template
 * management, never from here (P1-D5).
 *
 * Three rules the rendering obeys:
 *  1. 「全部行」is shown ONLY when the compiled branch really is `all`. Two
 *     restricted Roles stay two OR branches.
 *  2. 「无授权」, 「不可满足」, 「编译失败」and 「空筛选」render four different
 *     states — they never share one empty state.
 *  3. The filters live in the URL, so a filtered view can be shared as a link.
 *
 * ─── URL 契约（本页的筛选与深链参数名） ────────────────────────────────
 *
 * 三个表身份参数名是 **`connectionId` / `schema` / `sourceName`**：
 *
 *   - 本页从 URL 读这三个参数（`searchParams.get(...)`），三者齐全才启用单表详情查询；
 *   - 服务端 `webui/server/admin/authorization-summary.ts` 的 `rowPolicyViewUrlForTable()`
 *     生成的深链必须用**同样的三个参数名**，否则深链进来单表详情永远不渲染；
 *   - 表身份是三元组：另一个连接或另一个 Schema 下的同名 source 是**不同的表**。
 *
 * 另外两个可选筛选参数：`roleId`、`agentId`、`restricted`。
 * 改任何筛选参数时除 `sourceName` 外都会清掉 `sourceName`（换连接／换 Schema 后
 * 旧表名不再有意义）。
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { apiGet } from "../../lib/apiClient";
import { RowPolicyDnfPreview, type RowPolicyDnfGrant } from "../../components/admin/RowPolicyDnfPreview";
import {
  RowPolicySnapshotBadge,
  RowPolicyStateBadge,
  type RowPolicySnapshotIdentity,
  type RowPolicyViewStatus
} from "../../components/admin/RowPolicyStateBadge";
import { RowPolicyAuthoringModeBadge } from "../../components/admin/RowPolicyTemplatePicker";

type RowGrantView = {
  kind: "all" | "scoped";
  digest?: string;
  orArms?: Array<Array<{ field: string; op: "eq" | "in"; value?: string | number | boolean; values?: Array<string | number | boolean> }>>;
};

type RoleBranchView = {
  roleId: string;
  rowAccess: "all" | "scoped" | null;
  templateRefs: string[];
  inlinePredicates: Array<{ field: string; op: "eq" | "in"; value?: string | number | boolean; values?: Array<string | number | boolean> }>;
  rowGrant: RowGrantView | null;
  error?: string;
};

type AgentBranchView = {
  agentId: string;
  enabled: boolean;
  constraints: Array<{ field: string; op: "eq" | "in"; value?: string | number | boolean; values?: Array<string | number | boolean> }>;
  finalRows: RowGrantView | null;
  error?: string;
};

type TableViewResponse = {
  snapshot: { identity: RowPolicySnapshotIdentity; state: string; problem: string | null; failures: Array<{ subjectId: string; reason: string }> };
  table: { connectionId: string; schema: string; sourceName: string; physicalTable: string };
  state: string;
  status: RowPolicyViewStatus;
  reason?: string;
  roles: RoleBranchView[];
  effectiveRowGrant: RowGrantView | null;
  agents: AgentBranchView[];
  catalog: { status: string; catalogLoaded: boolean; stage?: string; reason?: string };
  failures: Array<{ subjectId: string; reason: string }>;
};

type TableListResponse = {
  snapshot: { identity: RowPolicySnapshotIdentity; state: string; problem: string | null; failures: Array<{ subjectId: string; reason: string }> };
  state: string;
  status: RowPolicyViewStatus;
  tables: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    physicalTable: string;
    roleCount: number;
    agentCount: number;
    effectiveRowGrant: RowGrantView | null;
    restricted: boolean;
  }>;
  failures: Array<{ subjectId: string; reason: string }>;
};

function asDnfGrant(grant: RowGrantView | null): RowPolicyDnfGrant {
  if (!grant) return null;
  if (grant.kind === "all") return { kind: "all" };
  return { kind: "scoped", digest: grant.digest, orArms: grant.orArms ?? [] };
}

function describeGrant(grant: RowGrantView | null): string {
  if (!grant) return "—";
  if (grant.kind === "all") return "行权限：全部行";
  return `受限行授予（${grant.orArms?.length ?? 0} 个分支）`;
}

/**
 * 空态文案按 `status` 分支：**「快照不可用」与「空筛选」不是同一句话**。
 *
 * 服务端快照读不到时返回 `status:"unavailable"` + `tables:[]`，此时说「没有符合
 * 筛选条件的表」是把「读不到」说成「没有」，是假断言（P1-1 §6.2 / ASV-08）。
 */
type ListEmptyState = { kind: "unavailable" | "no_match" | "unknown"; text: string };

function listEmptyState(status: RowPolicyViewStatus | undefined): ListEmptyState {
  if (status === "unavailable") {
    return {
      kind: "unavailable",
      text: "行权限快照当前不可用，无法判断哪些表受行约束。"
    };
  }
  if (status === "no_match") {
    return { kind: "no_match", text: "没有符合筛选条件的表。" };
  }
  return {
    kind: "unknown",
    text: "行权限快照当前不可判定，无法判断哪些表受行约束。"
  };
}

export function RowPolicyView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const connectionId = searchParams.get("connectionId") ?? "";
  const schema = searchParams.get("schema") ?? "";
  const sourceName = searchParams.get("sourceName") ?? "";
  const roleId = searchParams.get("roleId") ?? "";
  const agentId = searchParams.get("agentId") ?? "";
  const restricted = searchParams.get("restricted") === "true";

  const listQuery = useQuery({
    queryKey: ["admin", "row-policy", "views", "tables", { connectionId, schema, sourceName, roleId, agentId, restricted }],
    queryFn: () => {
      const query = new URLSearchParams();
      if (connectionId) query.set("connectionId", connectionId);
      if (schema) query.set("schema", schema);
      if (sourceName) query.set("sourceName", sourceName);
      if (roleId) query.set("roleId", roleId);
      if (agentId) query.set("agentId", agentId);
      if (restricted) query.set("restricted", "true");
      const suffix = query.toString();
      return apiGet<TableListResponse>(
        `/api/admin/row-policy/views/tables${suffix ? `?${suffix}` : ""}`
      );
    }
  });

  const detailQuery = useQuery({
    queryKey: ["admin", "row-policy", "views", "table", { connectionId, schema, sourceName }],
    enabled: Boolean(connectionId && schema && sourceName),
    queryFn: () =>
      apiGet<TableViewResponse>(
        `/api/admin/row-policy/views/table?connectionId=${encodeURIComponent(connectionId)}&schema=${encodeURIComponent(schema)}&sourceName=${encodeURIComponent(sourceName)}`
      )
  });

  function updateFilter(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "sourceName") next.delete("sourceName");
    setSearchParams(next);
  }

  /**
   * Select one table.
   *
   * The three parts of the table identity are three separate parameters: the
   * server keys a table by `connectionId + schema + sourceName`, and the same
   * source name of another connection or Schema is a DIFFERENT table.
   */
  function selectTable(table: { connectionId: string; schema: string; sourceName: string }): void {
    const next = new URLSearchParams(searchParams);
    next.set("connectionId", table.connectionId);
    next.set("schema", table.schema);
    next.set("sourceName", table.sourceName);
    setSearchParams(next);
  }

  const tables = listQuery.data?.tables ?? [];
  const detail = detailQuery.data;

  return (
    <div className="grid gap-4 p-4" data-testid="row-policy-view-page">
      <PageHeader
        title="行权限视图"
        description="按表反查这张表实际受什么行约束；本页只读，修改请到角色权限与行策略模板。"
        badges={
          listQuery.data ? <RowPolicySnapshotBadge identity={listQuery.data.snapshot.identity} /> : undefined
        }
        actions={
          <Link className="text-sm underline" to="/admin/row-policy-templates">
            行策略模板
          </Link>
        }
      />

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">筛选</h2>
        <div className="flex flex-wrap gap-2">
          {/*
            五个筛选框里有四个承载**标识**（连接 ID、表名、角色 ID、Agent ID），
            术语标准 §2.6 要求这类输入框与它们显示的值一样受翻译防御：
            `translate="no"` + `notranslate`。
          */}
          <input
            className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
            translate="no"
            placeholder="连接"
            aria-label="连接筛选"
            defaultValue={connectionId}
            onChange={(event) => updateFilter("connectionId", event.target.value.trim())}
          />
          <input
            className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
            translate="no"
            placeholder="Schema"
            aria-label="Schema 筛选"
            defaultValue={schema}
            onChange={(event) => updateFilter("schema", event.target.value.trim())}
          />
          <input
            className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
            translate="no"
            placeholder="表"
            aria-label="表筛选"
            defaultValue={sourceName}
            onChange={(event) => updateFilter("sourceName", event.target.value.trim())}
          />
          <input
            className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
            translate="no"
            placeholder="角色"
            aria-label="角色筛选"
            defaultValue={roleId}
            onChange={(event) => updateFilter("roleId", event.target.value.trim())}
          />
          <input
            className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
            translate="no"
            placeholder="Agent"
            aria-label="Agent 筛选"
            defaultValue={agentId}
            onChange={(event) => updateFilter("agentId", event.target.value.trim())}
          />
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={restricted}
              onChange={(event) => updateFilter("restricted", event.target.checked ? "true" : "")}
            />
            仅看受限表
          </label>
        </div>
      </section>

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">表清单</h2>
        {/*
          清单侧也要说清快照状态：`state !== "ok"` 表示这份清单只覆盖了已解析的部分，
          失败集合必须列出来（RTV-05：「partial 明示失败集合」）。全失败时服务端返回
          `state:"unavailable"` / `status:"unavailable"` / `tables:[]`，此时下面走
          「快照不可用」空态而不是「没有符合筛选条件的表」。
        */}
        {listQuery.data && listQuery.data.state !== "ok" ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="row-policy-view-list-state">
            <span
              className="pl-status-badge pl-status-validation_failed"
              data-testid="row-policy-view-list-state-badge"
            >
              {`快照状态：${listQuery.data.state}`}
            </span>
            {listQuery.data.snapshot.problem ? (
              <span className="text-xs text-warning-strong notranslate" translate="no">
                {listQuery.data.snapshot.problem}
              </span>
            ) : null}
            <p className="text-xs text-warning-strong">下列清单只覆盖已解析的部分。</p>
          </div>
        ) : null}
        {listQuery.data && listQuery.data.failures.length > 0 ? (
          <ul className="grid gap-1 text-xs text-warning-strong" data-testid="row-policy-view-list-failures">
            {listQuery.data.failures.map((failure) => (
              <li key={failure.subjectId} className="notranslate" translate="no">
                {failure.subjectId} · {failure.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {listQuery.isError ? (
          <p className="text-sm text-warning-strong" data-testid="row-policy-view-list-error">
            表清单读取失败：{(listQuery.error as Error).message}
          </p>
        ) : listQuery.isPending ? (
          // 读回来之前不渲染任何空态：「没有符合筛选条件的表」在还没读到数据时是假断言。
          <p className="text-sm text-fg-muted" data-testid="row-policy-view-list-loading">
            正在读取表清单…
          </p>
        ) : tables.length === 0 ? (
          <div className="grid gap-1">
            <RowPolicyStateBadge status={listQuery.data?.status ?? "no_match"} />
            <p
              className="text-sm text-fg-muted"
              data-testid="row-policy-view-list-empty"
              data-empty-kind={listEmptyState(listQuery.data?.status).kind}
            >
              {listEmptyState(listQuery.data?.status).text}
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm" data-testid="row-policy-view-table-list">
            <thead>
              <tr className="text-xs text-fg-muted">
                <th scope="col">表</th>
                <th scope="col">角色数</th>
                <th scope="col"><span className="notranslate" translate="no">Agent</span> 数</th>
                <th scope="col">有效行授予</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => (
                <tr
                  key={`${table.connectionId}/${table.schema}/${table.sourceName}`}
                  data-testid={`row-policy-view-table-${table.connectionId}-${table.schema}-${table.sourceName}`}
                >
                  <td>
                    <button
                      type="button"
                      className="underline notranslate"
                      translate="no"
                      onClick={() => selectTable(table)}
                    >
                      {table.connectionId}/{table.schema}/{table.sourceName}
                    </button>
                  </td>
                  <td>{table.roleCount}</td>
                  <td>{table.agentCount}</td>
                  <td data-testid="row-policy-view-table-grant">
                    {describeGrant(table.effectiveRowGrant)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {connectionId && schema && sourceName ? (
        <section className="grid gap-2" data-testid="row-policy-view-detail">
          <h2 className="text-sm font-medium">单表详情</h2>
          {detailQuery.isError ? (
            <p className="text-sm text-warning-strong" data-testid="row-policy-view-detail-error">
              单表详情读取失败：{(detailQuery.error as Error).message}
            </p>
          ) : !detail ? (
            <p className="text-sm text-fg-muted">读取单表详情中…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm notranslate" translate="no">
                  {detail.table.connectionId}/{detail.table.schema}/{detail.table.sourceName}
                </span>
                <RowPolicyStateBadge status={detail.status} reason={detail.reason} />
                <span className="text-xs text-fg-muted">
                  目录：<span className="notranslate" translate="no">{detail.catalog.status}</span>
                  {detail.catalog.reason ? ` · ${detail.catalog.reason}` : ""}
                </span>
              </div>

              {detail.failures.length > 0 ? (
                <ul className="grid gap-1 text-xs text-warning-strong" data-testid="row-policy-view-failures">
                  {detail.failures.map((failure) => (
                    <li key={failure.subjectId} className="notranslate" translate="no">
                      {failure.subjectId} · {failure.reason}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="grid gap-2" data-testid="row-policy-view-role-branches">
                <h3 className="text-xs font-medium">角色分支</h3>
                {detail.roles.length === 0 ? (
                  <p className="text-xs text-fg-muted">没有角色分支。</p>
                ) : (
                  <ul className="grid gap-2">
                    {detail.roles.map((role) => (
                      <li key={role.roleId} className="grid gap-1" data-testid={`row-policy-view-role-${role.roleId}`}>
                        <div className="flex items-center gap-2">
                          <Link
                            className="text-sm underline notranslate"
                            translate="no"
                            to={`/admin/roles/${encodeURIComponent(role.roleId)}`}
                          >
                            {role.roleId}
                          </Link>
                          <span className="text-xs text-fg-muted" data-testid="row-policy-view-role-access">
                            {role.rowAccess === "all"
                              ? "行权限：全部行"
                              : role.rowAccess === "scoped"
                                ? "受限行授予"
                                : "不授予该表"}
                          </span>
                        </div>
                        {role.templateRefs.length > 0 ? (
                          <p className="text-xs notranslate" translate="no" data-testid="row-policy-view-role-templates">
                            引用模板：{role.templateRefs.join("、")}
                          </p>
                        ) : null}
                        <RowPolicyAuthoringModeBadge
                          templateName={role.templateRefs[0]}
                          inlinePredicateCount={role.inlinePredicates.length}
                        />
                        {role.inlinePredicates.length > 0 ? (
                          <ul className="grid gap-0.5 text-xs notranslate" translate="no">
                            {role.inlinePredicates.map((predicate, index) => (
                              <li key={index}>
                                {predicate.field}{" "}
                                {predicate.op === "eq"
                                  ? `等于 ${String(predicate.value ?? "")}`
                                  : `属于 ${(predicate.values ?? []).map((item) => String(item)).join("、")}`}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {role.error ? (
                          <p className="text-xs text-warning-strong notranslate" translate="no">
                            {role.error}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <RowPolicyDnfPreview
                effectiveRowGrant={asDnfGrant(detail.effectiveRowGrant)}
                roleIds={detail.roles.filter((role) => role.rowGrant !== null).map((role) => role.roleId)}
                finalRowsByAgent={detail.agents
                  .filter((agent) => agent.finalRows !== null)
                  .map((agent) => ({ agentId: agent.agentId, finalRows: asDnfGrant(agent.finalRows) }))}
                unavailableReason={detail.status === "compile_failed" ? detail.reason : null}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default RowPolicyView;
