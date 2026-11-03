/**
 * Lucy v0.25 P1-2 — 行边界说明。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §2.3（Agent 与 Role 的差异）、
 *     §3（行摘要）、§6（一致性与降级）、§8（ASV-05／ASV-06／ASV-07）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B5）、§2.2
 *
 * Agent 与 Role 的行边界**不是同一个东西**，页面必须说清楚：
 *
 *  - Agent：最终行约束＝有效行授予 AND Agent 个人行限制；
 *  - Role：只表示该 Role 自身的行授予，不含任何 Agent 个人行限制。
 *
 * 通用角色预览（`__role_preview__`）不携带 Agent 个人行限制，因此永远不能被拿来
 * 冒充某个 Agent 的最终行约束。本组件按服务端给出的 `basis` 渲染，不自行判断。
 */
import type { AuthorizationResourceTable, AuthorizationSummary } from "./AuthorizationTypes";

function constrainedTables(summary: AuthorizationSummary): AuthorizationResourceTable[] {
  return summary.resources
    .flatMap((connection) => connection.schemas)
    .flatMap((schema) => schema.tables)
    .filter((table) => table.rowSummary.kind !== "all");
}

function RowTableDetail({ table }: { table: AuthorizationResourceTable }) {
  const { rowSummary } = table;
  return (
    <li className="grid gap-1 border-b py-1" data-testid="authorization-row-boundary-item">
      <div className="text-[13px]">
        <span className="notranslate font-mono" translate="no">
          {table.sourceName}
        </span>
        <span className="ml-2 text-fg-muted">{rowSummary.constraintSummary}</span>
      </div>
      {rowSummary.orArms.length > 0 ? (
        <ul className="grid gap-0.5 text-[12px] text-fg-muted">
          {rowSummary.orArms.map((arm, index) => (
            <li key={`${table.sourceKey}:${index}`}>
              <span className="notranslate font-mono" translate="no">
                {arm}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {rowSummary.templateRefs.length > 0 ? (
        <p className="text-[12px] text-fg-muted">
          {"配置溯源（模板名只作溯源，不改变行边界语义）："}
          <span className="notranslate font-mono" translate="no">
            {rowSummary.templateRefs.join(", ")}
          </span>
        </p>
      ) : null}
      {rowSummary.error ? (
        <p className="text-[12px] text-fg-muted" data-testid="authorization-row-boundary-error">
          {"行边界不可判定："}
          <span className="notranslate font-mono" translate="no">
            {rowSummary.error}
          </span>
        </p>
      ) : null}
    </li>
  );
}

export function AuthorizationRowBoundary({ summary }: { summary: AuthorizationSummary }) {
  const isAgent = summary.summaryContext.subject.kind === "agent";
  const tables = constrainedTables(summary);

  return (
    <section className="grid gap-2" data-testid="authorization-row-boundary">
      <h3 className="text-sm font-medium">行边界</h3>
      <p className="text-[13px] text-fg-muted" data-testid="authorization-row-boundary-basis">
        {isAgent ? (
          <>
            {"本视图显示 "}
            <span className="notranslate" translate="no">
              Agent
            </span>
            {" 的最终行约束（有效行授予 AND Agent 个人行限制）。"}
          </>
        ) : (
          <>
            {"本视图只显示 "}
            <span className="notranslate" translate="no">
              Role
            </span>
            {" 自身的行授予，不含任何 "}
            <span className="notranslate" translate="no">
              Agent
            </span>
            {" 个人行限制。"}
          </>
        )}
      </p>
      {summary.legacyAllow ? (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-legacy-notice">
          该主体通过旧 ACL（legacy allow）授权，没有角色来源，也不做行级授权。
        </p>
      ) : null}
      {tables.length > 0 ? (
        <>
          <p className="text-[13px]" data-testid="authorization-row-boundary-shape">
            {"行约束按 Role 间 OR、单个 Role 内 AND 表达（OR-of-AND），不会因为多个角色而收紧成 AND。"}
          </p>
          <ul className="grid">
            {tables.map((table) => (
              <RowTableDetail key={table.sourceKey} table={table} />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-row-boundary-empty">
          没有带行约束的表。
        </p>
      )}
    </section>
  );
}
