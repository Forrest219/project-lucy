/**
 * Lucy v0.25 P1 — L25-14 R3: 行权限视图（按表反查）.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.3（R3 按表读取模型）, §6.2（独立行权限视图）; RTV-01 … RTV-08;
 *   P1-D5（独立只读）.
 * Presentation revision: docs/specs/lucy-20261030-row-policy-view-presentation-spec.md
 *   §5.1（页面骨架）, §5.2（URL）, §5.3（清单授予列）, §5.4（详情）; D1–D10.
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
 * ─── URL 契约（本页的当前表与清单筛选是两套参数） ──────────────────────────
 *
 * **当前表**（深链三参数，参数名不得改）：
 *
 *   `connectionId` / `schema` / `sourceName`
 *
 *   - 本页从 URL 读这三个参数，三者齐全才启用单表详情查询；
 *   - 服务端 `webui/server/admin/authorization-summary.ts` 的 `rowPolicyViewUrlForTable()`
 *     生成的深链必须用**同样的三个参数名**，否则深链进来单表详情永远不渲染；
 *   - 表身份是三元组：另一个连接或另一个 Schema 下的同名 source 是**不同的表**。
 *
 * **清单筛选**（另一组参数）：
 *
 *   `listConnectionId` / `listSchema` / `listSourceName` / `roleId` / `agentId` / `restricted`
 *
 *   - 清单请求时，前三个分别映射为服务端的 `connectionId` / `schema` / `sourceName`；
 *   - 清单请求**不**携带当前表三参数，除非对应的 `list*` 自己有值；
 *   - 点表只写当前表三参数，改清单筛选不删除当前表三参数。
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { apiGet } from "../../lib/apiClient";
import { copyTextWithToast } from "../../lib/clipboard";
import { useUrlMirroredField } from "../../lib/useUrlMirroredField";
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

/** The four states of the list's grant column (Spec §5.3). */
type RowPolicyGrantStatus = "all" | "scoped" | "no_applicable_grant" | "compile_failed";

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
    /** Derived by the server from the union it already computed. */
    grantStatus?: RowPolicyGrantStatus;
    /** The machine reason behind a failed status. Never the visible label. */
    grantStatusReason?: string;
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
 * The grant cell (Spec §5.3 / §6 `renderGrantCell`).
 *
 * `grantStatus` decides the wording — four states, four sentences. The machine
 * reason goes onto the cell's `title`, never into the visible label. When the
 * server did not send a `grantStatus` (older response), the cell falls back to
 * the previous `describeGrant` wording.
 */
function grantCellText(
  table: TableListResponse["tables"][number]
): { text: string; reason?: string } {
  const grantStatus = table.grantStatus;
  if (!grantStatus) return { text: describeGrant(table.effectiveRowGrant) };
  if (grantStatus === "all") return { text: "行权限：全部行" };
  if (grantStatus === "scoped") {
    return { text: `受限行授予（${table.effectiveRowGrant?.orArms?.length ?? 0} 个分支）` };
  }
  if (grantStatus === "no_applicable_grant") {
    return { text: "无授权", reason: table.grantStatusReason };
  }
  return { text: "编译失败", reason: table.grantStatusReason };
}

/** 目录状态的可见中文标签（术语表）。机器值仍在 `data-catalog-status`。 */
const CATALOG_LABELS: Record<string, string> = {
  loaded: "目录已加载",
  manifest_unavailable: "目录不可用",
  catalog_capability_unknown: "目录能力未知"
};

/** 清单筛选的 URL 参数名。清除筛选时整组删除，但不动当前表三参数。 */
const LIST_FILTER_KEYS = [
  "listConnectionId",
  "listSchema",
  "listSourceName",
  "roleId",
  "agentId",
  "restricted"
] as const;

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

/**
 * 角色分组（Spec §5.4）。三组互斥，空组不渲染标题。
 */
const ROLE_GROUPS: Array<{
  key: string;
  title: string;
  match: (role: RoleBranchView) => boolean;
}> = [
  { key: "union", title: "参与并集", match: (role) => role.rowGrant !== null },
  { key: "not-granted", title: "不授予该表", match: (role) => !role.error && role.rowGrant === null },
  { key: "compile-failed", title: "编译失败", match: (role) => Boolean(role.error) }
];

export function RowPolicyView() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── 当前表（深链三参数） ────────────────────────────────────────────────
  const connectionId = searchParams.get("connectionId") ?? "";
  const schema = searchParams.get("schema") ?? "";
  const sourceName = searchParams.get("sourceName") ?? "";
  // trim 只发生在发请求时；URL 里保留原文。
  const detailConnectionId = connectionId.trim();
  const detailSchema = schema.trim();
  const detailSourceName = sourceName.trim();

  // ── 清单筛选（另一组参数） ──────────────────────────────────────────────
  const listConnectionMirror = useUrlMirroredField({
    read: (params) => params.get("listConnectionId") ?? "",
    write: (prev, raw) => writeListParam(prev, "listConnectionId", raw),
    history: "push"
  });
  const listSchemaMirror = useUrlMirroredField({
    read: (params) => params.get("listSchema") ?? "",
    write: (prev, raw) => writeListParam(prev, "listSchema", raw),
    history: "push"
  });
  const listSourceNameMirror = useUrlMirroredField({
    read: (params) => params.get("listSourceName") ?? "",
    write: (prev, raw) => writeListParam(prev, "listSourceName", raw),
    history: "push"
  });
  const roleIdMirror = useUrlMirroredField({
    read: (params) => params.get("roleId") ?? "",
    write: (prev, raw) => writeListParam(prev, "roleId", raw),
    history: "push"
  });
  const agentIdMirror = useUrlMirroredField({
    read: (params) => params.get("agentId") ?? "",
    write: (prev, raw) => writeListParam(prev, "agentId", raw),
    history: "push"
  });

  // 请求用的筛选值：trim 只发生在这里。
  const listConnectionId = (searchParams.get("listConnectionId") ?? "").trim();
  const listSchema = (searchParams.get("listSchema") ?? "").trim();
  const listSourceName = (searchParams.get("listSourceName") ?? "").trim();
  const roleId = (searchParams.get("roleId") ?? "").trim();
  const agentId = (searchParams.get("agentId") ?? "").trim();
  const restricted = searchParams.get("restricted") === "true";

  const listQuery = useQuery({
    queryKey: [
      "admin",
      "row-policy",
      "views",
      "tables",
      { listConnectionId, listSchema, listSourceName, roleId, agentId, restricted }
    ],
    queryFn: () => {
      // 清单筛选映射到服务端参数名；当前表三参数**不**进入清单请求。
      const query = new URLSearchParams();
      if (listConnectionId) query.set("connectionId", listConnectionId);
      if (listSchema) query.set("schema", listSchema);
      if (listSourceName) query.set("sourceName", listSourceName);
      if (roleId) query.set("roleId", roleId);
      if (agentId) query.set("agentId", agentId);
      if (restricted) query.set("restricted", "true");
      const suffix = query.toString();
      return apiGet<TableListResponse>(
        `/api/admin/row-policy/views/tables${suffix ? `?${suffix}` : ""}`
      );
    }
  });

  /**
   * 连接／Schema 下拉的选项请求。
   *
   * 它不带任何筛选：不带 `list*`，也不带当前表三参数，也不带角色、Agent、
   * `restricted`。选项请求失败时，下拉仍显示 URL 里的当前值。
   */
  const optionsQuery = useQuery({
    queryKey: ["admin", "row-policy", "views", "tables", "options"],
    queryFn: () => apiGet<TableListResponse>("/api/admin/row-policy/views/tables")
  });

  const detailQuery = useQuery({
    queryKey: [
      "admin",
      "row-policy",
      "views",
      "table",
      { detailConnectionId, detailSchema, detailSourceName }
    ],
    enabled: Boolean(detailConnectionId && detailSchema && detailSourceName),
    queryFn: () =>
      apiGet<TableViewResponse>(
        `/api/admin/row-policy/views/table?connectionId=${encodeURIComponent(detailConnectionId)}&schema=${encodeURIComponent(detailSchema)}&sourceName=${encodeURIComponent(detailSourceName)}`
      )
  });

  /**
   * Select one table.
   *
   * The three parts of the table identity are three separate parameters: the
   * server keys a table by `connectionId + schema + sourceName`, and the same
   * source name of another connection or Schema is a DIFFERENT table.
   *
   * 点表只写这三个参数：清单筛选不动，当前表三参数不被清单筛选删除。
   */
  function selectTable(table: { connectionId: string; schema: string; sourceName: string }): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("connectionId", table.connectionId);
      next.set("schema", table.schema);
      next.set("sourceName", table.sourceName);
      return next;
    });
  }

  /** 「全部表 / 仅受限表」。 */
  function setRestricted(next: boolean): void {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next) nextParams.set("restricted", "true");
      else nextParams.delete("restricted");
      return nextParams;
    });
  }

  /** 「清除筛选」：删掉整组清单筛选，当前表三参数保留（Spec §5.2）。 */
  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of LIST_FILTER_KEYS) next.delete(key);
      return next;
    });
    // 清除动作必须让每一个镜像字段归零，否则输入框会留下旧文本。
    listConnectionMirror.reset("");
    listSchemaMirror.reset("");
    listSourceNameMirror.reset("");
    roleIdMirror.reset("");
    agentIdMirror.reset("");
  }

  const tables = listQuery.data?.tables ?? [];
  const detail = detailQuery.data;

  const hasListFilter = LIST_FILTER_KEYS.some((key) => Boolean(searchParams.get(key)));

  // ── 下拉选项 ────────────────────────────────────────────────────────────
  const optionTables = optionsQuery.data?.tables ?? [];
  const connectionOptions: string[] = [];
  for (const table of optionTables) {
    if (!connectionOptions.includes(table.connectionId)) connectionOptions.push(table.connectionId);
  }
  const currentConnection = listConnectionMirror.value;
  if (currentConnection && !connectionOptions.includes(currentConnection)) {
    connectionOptions.push(currentConnection);
  }
  connectionOptions.sort();

  const schemaOptions: string[] = [];
  const selectedConnection = listConnectionMirror.value.trim();
  for (const table of optionTables) {
    if (selectedConnection && table.connectionId !== selectedConnection) continue;
    if (!schemaOptions.includes(table.schema)) schemaOptions.push(table.schema);
  }
  const currentSchema = listSchemaMirror.value;
  if (currentSchema && !schemaOptions.includes(currentSchema)) {
    schemaOptions.push(currentSchema);
  }
  schemaOptions.sort();

  // 当前表是否落在当前筛选结果里。
  const listLoaded = Boolean(listQuery.data);
  const currentOutsideFilter =
    listLoaded &&
    Boolean(detailConnectionId && detailSchema && detailSourceName) &&
    !tables.some(
      (table) =>
        table.connectionId === detailConnectionId &&
        table.schema === detailSchema &&
        table.sourceName === detailSourceName
    );

  const tableIdentity = detail
    ? `${detail.table.connectionId}/${detail.table.schema}/${detail.table.sourceName}`
    : "";

  return (
    <div className="grid gap-4 p-4" data-testid="row-policy-view-page">
      <PageHeader
        title="行权限视图"
        description="按表查看实际生效的行约束。"
        badges={
          listQuery.data ? <RowPolicySnapshotBadge identity={listQuery.data.snapshot.identity} /> : undefined
        }
        actions={
          <Link className="pl-btn pl-btn--secondary text-sm" to="/admin/row-policy-templates">
            行策略模板
          </Link>
        }
      />

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">筛选</h2>
        <div className="flex flex-wrap items-end gap-3">
          {/*
            五个筛选框里有四个承载**标识**（连接 ID、表名、角色 ID、Agent ID），
            术语标准 §2.6 要求这类输入框与它们显示的值一样受翻译防御：
            `translate="no"` + `notranslate`。
          */}
          <div className="grid gap-1">
            <label className="text-xs text-fg-muted" htmlFor="row-policy-filter-connection">
              连接
            </label>
            <select
              id="row-policy-filter-connection"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              aria-label="连接筛选"
              value={listConnectionMirror.value}
              onChange={(event) => listConnectionMirror.onChange(event.target.value)}
            >
              <option value="">全部连接</option>
              {connectionOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label
              className="text-xs text-fg-muted notranslate"
              translate="no"
              htmlFor="row-policy-filter-schema"
            >
              Schema
            </label>
            <select
              id="row-policy-filter-schema"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              aria-label="Schema 筛选"
              value={listSchemaMirror.value}
              onChange={(event) => listSchemaMirror.onChange(event.target.value)}
            >
              <option className="notranslate" translate="no" value="">
                全部 Schema
              </option>
              {schemaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-fg-muted" htmlFor="row-policy-filter-table">
              表
            </label>
            <input
              id="row-policy-filter-table"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              aria-label="表筛选"
              value={listSourceNameMirror.value}
              onChange={(event) => listSourceNameMirror.onChange(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs text-fg-muted" htmlFor="row-policy-filter-role">
              角色
            </label>
            <input
              id="row-policy-filter-role"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              aria-label="角色筛选"
              value={roleIdMirror.value}
              onChange={(event) => roleIdMirror.onChange(event.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <label
              className="text-xs text-fg-muted notranslate"
              translate="no"
              htmlFor="row-policy-filter-agent"
            >
              Agent
            </label>
            <input
              id="row-policy-filter-agent"
              className="rounded border border-line bg-surface px-2 py-1 text-sm notranslate"
              translate="no"
              aria-label="Agent 筛选"
              value={agentIdMirror.value}
              onChange={(event) => agentIdMirror.onChange(event.target.value)}
            />
          </div>

          <div
            className="pl-segmented-control pl-segmented-control--cols-2"
            role="group"
            aria-label="表范围"
          >
            <button
              type="button"
              aria-pressed={!restricted}
              className={clsx(
                "pl-segmented-control-item",
                !restricted && "pl-segmented-control-item--active"
              )}
              onClick={() => setRestricted(false)}
            >
              全部表
            </button>
            <button
              type="button"
              aria-pressed={restricted}
              className={clsx(
                "pl-segmented-control-item",
                restricted && "pl-segmented-control-item--active"
              )}
              onClick={() => setRestricted(true)}
            >
              仅受限表
            </button>
          </div>

          {hasListFilter ? (
            <button
              type="button"
              className="pl-btn pl-btn--secondary text-sm"
              data-testid="row-policy-view-clear-filters"
              onClick={clearFilters}
            >
              清除筛选
            </button>
          ) : null}
        </div>
        <p className="text-xs text-fg-muted">本页只读。修改请到角色权限。</p>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">表清单</h2>
          <span className="text-xs text-fg-muted">{tables.length} 张表</span>
        </div>
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
          <div className="pl-data-grid-frame min-w-0 max-w-full">
            <div className="pl-data-grid-scroll w-full min-w-0 max-w-full">
              <table className="pl-data-grid pl-data-table" data-testid="row-policy-view-table-list">
                <thead>
                  <tr className="text-xs text-fg-muted">
                    <th scope="col">表</th>
                    <th scope="col">角色数</th>
                    <th scope="col"><span className="notranslate" translate="no">Agent</span> 数</th>
                    <th scope="col">有效行授予</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table) => {
                    const selected =
                      table.connectionId === detailConnectionId &&
                      table.schema === detailSchema &&
                      table.sourceName === detailSourceName;
                    const cell = grantCellText(table);
                    return (
                      <tr
                        key={`${table.connectionId}/${table.schema}/${table.sourceName}`}
                        className={clsx(selected && "bg-bg-muted")}
                        aria-current={selected ? "true" : undefined}
                        data-testid={`row-policy-view-table-${table.connectionId}-${table.schema}-${table.sourceName}`}
                      >
                        <td>
                          <button
                            type="button"
                            className="underline notranslate"
                            translate="no"
                            aria-label={`${table.connectionId}/${table.schema}/${table.sourceName}`}
                            onClick={() => selectTable(table)}
                          >
                            {table.sourceName}
                          </button>
                          <p className="text-xs text-fg-muted notranslate" translate="no">
                            {table.connectionId} · {table.schema}
                          </p>
                        </td>
                        <td>{table.roleCount}</td>
                        <td>{table.agentCount}</td>
                        <td
                          data-testid="row-policy-view-table-grant"
                          title={cell.reason}
                          translate={cell.reason ? "no" : undefined}
                          className={clsx(cell.reason && "notranslate")}
                        >
                          {cell.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {detailConnectionId && detailSchema && detailSourceName ? (
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
                  {tableIdentity}
                </span>
                <button
                  type="button"
                  className="pl-icon-btn pl-btn pl-btn--ghost text-xs"
                  aria-label="复制表身份"
                  title="复制表身份"
                  data-testid="row-policy-view-copy-identity"
                  onClick={() => {
                    void copyTextWithToast(tableIdentity, { successMessage: "已复制表身份" });
                  }}
                >
                  复制
                </button>
                <RowPolicyStateBadge status={detail.status} reason={detail.reason} />
                <span className="text-xs text-fg-muted">
                  <span
                    className="notranslate"
                    translate="no"
                    data-catalog-status={detail.catalog.status}
                  >
                    {CATALOG_LABELS[detail.catalog.status] ?? detail.catalog.status}
                  </span>
                  {detail.catalog.reason ? (
                    <span className="notranslate" translate="no">
                      {` · ${detail.catalog.reason}`}
                    </span>
                  ) : null}
                </span>
              </div>

              {currentOutsideFilter ? (
                <p className="text-xs text-fg-muted" data-testid="row-policy-view-outside-filter">
                  当前表不在筛选结果中。
                </p>
              ) : null}

              {detail.failures.length > 0 ? (
                <ul className="grid gap-1 text-xs text-warning-strong" data-testid="row-policy-view-failures">
                  {detail.failures.map((failure) => (
                    <li key={failure.subjectId} className="notranslate" translate="no">
                      {failure.subjectId} · {failure.reason}
                    </li>
                  ))}
                </ul>
              ) : null}

              <RowPolicyDnfPreview
                effectiveRowGrant={asDnfGrant(detail.effectiveRowGrant)}
                roleIds={detail.roles.filter((role) => role.rowGrant !== null).map((role) => role.roleId)}
                finalRowsByAgent={detail.agents
                  .filter((agent) => agent.finalRows !== null)
                  .map((agent) => ({
                    agentId: agent.agentId,
                    finalRows: asDnfGrant(agent.finalRows),
                    summaryHref: `/admin/authorization-summary?kind=agent&id=${encodeURIComponent(agent.agentId)}`
                  }))}
                unavailableReason={detail.status === "compile_failed" ? detail.reason : null}
                boundaryPlacement="footnote"
                predicateLayout="stacked"
                collapseUniformAllRows
              >
                {/* 角色分组放在并集小节与 Agent 小节之间：结论 → 边界句 → 角色 → Agent。 */}
                <section className="grid gap-2" data-testid="row-policy-view-role-branches">
                  <h3 className="text-xs font-medium">角色分支</h3>
                  {detail.roles.length === 0 ? (
                    <p className="text-xs text-fg-muted">没有角色分支。</p>
                  ) : (
                    ROLE_GROUPS.map((group) => {
                      const roles = detail.roles.filter((role) => group.match(role));
                      if (roles.length === 0) return null;
                      return (
                        <div key={group.key} className="grid gap-1">
                          <h4 className="text-xs font-medium text-fg-muted">{group.title}</h4>
                          <ul className="grid gap-2">
                            {roles.map((role) => (
                              <li
                                key={role.roleId}
                                className="grid gap-1"
                                data-testid={`row-policy-view-role-${role.roleId}`}
                              >
                                <div className="flex flex-wrap items-center gap-2">
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
                                  <Link
                                    className="text-xs underline"
                                    to={`/admin/authorization-summary?kind=role&id=${encodeURIComponent(role.roleId)}`}
                                  >
                                    授权摘要
                                  </Link>
                                </div>
                                {role.templateRefs.length > 0 ? (
                                  <p
                                    className="text-xs notranslate"
                                    translate="no"
                                    data-testid="row-policy-view-role-templates"
                                  >
                                    引用模板：{role.templateRefs.join("、")}
                                  </p>
                                ) : null}
                                {/*
                                  D9：没有模板引用、也没有内联条件时，不渲染编写方式徽章。
                                  `rowPolicyAuthoringMode()` 的默认返回值不改，只在调用处跳过。
                                */}
                                {role.templateRefs.length > 0 || role.inlinePredicates.length > 0 ? (
                                  <RowPolicyAuthoringModeBadge
                                    templateName={role.templateRefs[0]}
                                    inlinePredicateCount={role.inlinePredicates.length}
                                  />
                                ) : null}
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
                        </div>
                      );
                    })
                  )}
                </section>
              </RowPolicyDnfPreview>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * 写入一个清单筛选参数。
 *
 * 原文进 URL（不 trim、不改写）；空值删除参数。下拉的空选项因此不写参数。
 */
function writeListParam(prev: URLSearchParams, key: string, raw: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (raw) next.set(key, raw);
  else next.delete(key);
  return next;
}

export default RowPolicyView;
