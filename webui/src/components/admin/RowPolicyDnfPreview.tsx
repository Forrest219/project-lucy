/**
 * Lucy v0.25 — L25-14 R2 最终行约束预览 / DNF 展示 (§3.2 / §6.1, V08–V11).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2 (展示结构必须保持 DNF 形态), §6.1 (预览区固定边界说明),
 *   webui/docs/00-product-terminology-standard.md (行权限：全部行 / 等于 / 属于).
 * Presentation revision: docs/specs/lucy-20261030-row-policy-view-presentation-spec.md
 *   §5.4 (本页传入的可选 prop), D9 / D10.
 *
 * Why this component exists instead of reusing `lib/row-grant-preview.ts`:
 * that formatter flattens the predicates into one ` AND ` string and truncates at
 * three predicates, so it cannot show the OR-of-AND structure and it loses
 * information. A flattened display would make the union look STRICTER than it is.
 *
 * The component never claims 「行权限：全部行」 when the catalog was unavailable or
 * the preview failed — an operations-side reason is shown instead.
 *
 * ─── 可选 prop 的合同 ────────────────────────────────────────────────────────
 *
 * The four optional props below are used by the row policy VIEW page only.
 * Every one of them has a default that keeps the CURRENT behaviour, so the
 * role editor (which passes none of them) renders exactly as before:
 *
 *   boundaryPlacement   "top"（默认）= 边界句在上；"footnote" = 边界句在结论下方
 *   children             undefined（默认）= 没有中间插槽
 *   collapseUniformAllRows false（默认）= Agent 不折叠，逐个平铺
 *   predicateLayout      "inline"（默认）= 今天的单行；"stacked" = 一支一块
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface RowPolicyDnfPredicate {
  field: string;
  op: "eq" | "in";
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

export type RowPolicyDnfGrant =
  | { kind: "all" }
  | { kind: "scoped"; digest?: string; orArms?: RowPolicyDnfPredicate[][] }
  | null
  | undefined;

export interface RowPolicyDnfAgentRow {
  agentId: string;
  finalRows: RowPolicyDnfGrant;
  /**
   * The read-only authorization summary deep link of this Agent. When absent
   * the Agent row renders no link — the role editor never passes one.
   */
  summaryHref?: string;
}

export interface RowPolicyDnfPreviewProps {
  /** The union across Roles (OR). */
  effectiveRowGrant?: RowPolicyDnfGrant;
  /** The Roles that contributed a branch to the union. */
  roleIds?: string[];
  /** Per-Agent final rows: the union AND the Agent's personal row limits. */
  finalRowsByAgent?: RowPolicyDnfAgentRow[];
  /**
   * The operations-side reason when the final row constraints could not be
   * computed (清单不可用 / 目录能力未知 / 编译失败). When set, the component must
   * NOT claim 「行权限：全部行」.
   */
  unavailableReason?: string | null;
  /** Extra content rendered under the preview (e.g. the candidate digest). */
  footer?: ReactNode;
  /**
   * Where the boundary sentence sits. `"top"` (default) keeps today's order —
   * the sentence is above the union. `"footnote"` puts it right under the
   * union, so the conclusion is read before the caveat.
   */
  boundaryPlacement?: "top" | "footnote";
  /**
   * Extra content between the union section and the Agent section. The row
   * policy view puts the Role groups here so the reading order is
   * 结论 → 边界句 → 角色 → Agent.
   */
  children?: ReactNode;
  /**
   * Collapse the Agent list into ONE uniform sentence when every Agent's final
   * rows are `all`. The per-Agent rows still render after 「展开」. Default
   * `false` keeps today's flat list.
   */
  collapseUniformAllRows?: boolean;
  /**
   * How the OR branches are laid out. `"inline"` (default) is today's single
   * line; `"stacked"` gives every branch its own block with a visible 「或」
   * between the branches.
   */
  predicateLayout?: "inline" | "stacked";
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "");
}

/** Terminology: 等于 / 属于 (webui/docs/00-product-terminology-standard.md). */
export function formatDnfPredicate(predicate: RowPolicyDnfPredicate): string {
  const field = predicate.field;
  if (predicate.op === "eq") {
    return `${field} 等于 ${formatValue(predicate.value)}`;
  }
  const values = Array.isArray(predicate.values) ? predicate.values : [];
  return `${field} 属于 ${values.map((value) => formatValue(value)).join("、")}`;
}

function DnfGrantBody({
  grant,
  testId,
  layout = "inline"
}: {
  grant: RowPolicyDnfGrant;
  testId: string;
  layout?: "inline" | "stacked";
}) {
  if (!grant) {
    return (
      <p className="text-sm text-fg-muted" data-testid={`${testId}-empty`}>
        该表没有可用的行授权分支，不能按「行权限：全部行」理解。
      </p>
    );
  }
  if (grant.kind === "all") {
    return (
      <p className="text-sm font-medium" data-testid={`${testId}-all`}>
        行权限：全部行
      </p>
    );
  }
  const arms = grant.orArms ?? [];
  if (arms.length === 0) {
    return (
      <p className="text-sm text-fg-muted" data-testid={`${testId}-empty`}>
        未产生行条件分支。
      </p>
    );
  }
  return (
    <div className="grid gap-1" data-testid={testId}>
      <p className="text-xs text-fg-muted">满足以下任一分支即可：</p>
      <ol className="grid gap-1">
        {arms.map((arm, index) => (
          <li
            key={index}
            className={layout === "stacked" ? "grid gap-1 text-sm" : "text-sm"}
            data-testid={`${testId}-arm-${index}`}
          >
            {/* 分支之间必须看得见「或」——OR-of-AND 不得拍平成一条 AND。 */}
            {layout === "stacked" && index > 0 ? (
              <span className="text-xs text-fg-muted">或</span>
            ) : null}
            <span className="notranslate" translate="no">
              {arm.map((predicate) => formatDnfPredicate(predicate)).join(" 且 ")}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The fixed boundary sentence (spec §6.1): the union across Roles may be WIDER
 * than any single Role, and the Agent personal row limits narrow it further.
 */
export const ROW_POLICY_PREVIEW_BOUNDARY =
  "同一张表上，多个角色的行授权取并集，并集可能比任意单个角色更宽；个人行限制在其上再收窄。";

export function RowPolicyDnfPreview({
  effectiveRowGrant,
  roleIds,
  finalRowsByAgent = [],
  unavailableReason,
  footer,
  boundaryPlacement = "top",
  children,
  collapseUniformAllRows = false,
  predicateLayout = "inline"
}: RowPolicyDnfPreviewProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const hasReason = Boolean(unavailableReason);
  /**
   * 只有「每个 Agent 的最终行约束都是 all」且至少有一个 Agent 时才折叠。
   * 其余情况（scoped、null、Agent 为空）一律逐个平铺。
   */
  const uniformAllRows =
    collapseUniformAllRows &&
    finalRowsByAgent.length > 0 &&
    finalRowsByAgent.every((row) => row.finalRows?.kind === "all");

  const boundary = (
    <p className="text-xs text-fg-muted" data-testid="row-policy-dnf-boundary">
      {ROW_POLICY_PREVIEW_BOUNDARY}
    </p>
  );

  return (
    <div className="grid gap-2" data-testid="row-policy-dnf-preview">
      {boundaryPlacement === "top" ? boundary : null}

      {hasReason ? (
        <p className="text-sm text-warning-strong" role="status" data-testid="row-policy-dnf-unavailable">
          {unavailableReason}
        </p>
      ) : null}

      <section className="grid gap-1" data-testid="row-policy-dnf-union-section">
        <h4 className="text-sm font-medium">
          最终行约束（角色并集）
          {roleIds && roleIds.length > 0 ? (
            <span className="ml-2 text-xs font-normal text-fg-muted">
              来源角色：{roleIds.join("、")}
            </span>
          ) : null}
        </h4>
        {hasReason ? (
          <p className="text-sm text-fg-muted" data-testid="row-policy-dnf-union-unavailable">
            目录或编译状态未知，未展示并集结果。
          </p>
        ) : (
          <DnfGrantBody
            grant={effectiveRowGrant}
            testId="row-policy-dnf-union"
            layout={predicateLayout}
          />
        )}
      </section>

      {boundaryPlacement === "footnote" ? boundary : null}

      {children}

      {finalRowsByAgent.length > 0 ? (
        <section className="grid gap-1" data-testid="row-policy-dnf-agents-section">
          <h4 className="text-sm font-medium">最终行约束（与个人行限制相交）</h4>
          {uniformAllRows ? (
            <div className="grid gap-1">
              <p
                className="text-sm text-fg-muted notranslate"
                translate="no"
                data-testid="row-policy-view-agent-uniform"
              >
                这 {finalRowsByAgent.length} 个 Agent 的最终行约束都是行权限：全部行。
              </p>
              <button
                type="button"
                className="justify-self-start text-xs underline"
                data-testid="row-policy-view-agent-expand"
                aria-expanded={agentsExpanded}
                onClick={() => setAgentsExpanded((previous) => !previous)}
              >
                {agentsExpanded ? "收起" : "展开"}
              </button>
            </div>
          ) : null}
          {uniformAllRows && !agentsExpanded ? null : (
            <ul className="grid gap-2">
              {finalRowsByAgent.map((row) => (
                <li
                  key={row.agentId}
                  className="grid gap-1"
                  data-testid={`row-policy-dnf-agent-${row.agentId}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-fg-muted notranslate" translate="no">
                      {row.agentId}
                    </p>
                    {row.summaryHref ? (
                      <Link className="text-xs underline" to={row.summaryHref}>
                        授权摘要
                      </Link>
                    ) : null}
                  </div>
                  <DnfGrantBody
                    grant={row.finalRows}
                    testId={`row-policy-dnf-agent-${row.agentId}-rows`}
                    layout={predicateLayout}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {footer}
    </div>
  );
}
