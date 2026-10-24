/**
 * Lucy v0.25 — L25-14 R2 最终行约束预览 / DNF 展示 (§3.2 / §6.1, V08–V11).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2 (展示结构必须保持 DNF 形态), §6.1 (预览区固定边界说明),
 *   webui/docs/00-product-terminology-standard.md (行权限：全部行 / 等于 / 属于).
 *
 * Why this component exists instead of reusing `lib/row-grant-preview.ts`:
 * that formatter flattens the predicates into one ` AND ` string and truncates at
 * three predicates, so it cannot show the OR-of-AND structure and it loses
 * information. A flattened display would make the union look STRICTER than it is.
 *
 * The component never claims 「行权限：全部行」 when the catalog was unavailable or
 * the preview failed — an operations-side reason is shown instead.
 */
import type { ReactNode } from "react";

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

function DnfGrantBody({ grant, testId }: { grant: RowPolicyDnfGrant; testId: string }) {
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
          <li key={index} className="text-sm" data-testid={`${testId}-arm-${index}`}>
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
}: RowPolicyDnfPreviewProps) {
  const hasReason = Boolean(unavailableReason);
  return (
    <div className="grid gap-2" data-testid="row-policy-dnf-preview">
      <p className="text-xs text-fg-muted" data-testid="row-policy-dnf-boundary">
        {ROW_POLICY_PREVIEW_BOUNDARY}
      </p>

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
          <DnfGrantBody grant={effectiveRowGrant} testId="row-policy-dnf-union" />
        )}
      </section>

      {finalRowsByAgent.length > 0 ? (
        <section className="grid gap-1" data-testid="row-policy-dnf-agents-section">
          <h4 className="text-sm font-medium">最终行约束（与个人行限制相交）</h4>
          <ul className="grid gap-2">
            {finalRowsByAgent.map((row) => (
              <li key={row.agentId} className="grid gap-1" data-testid={`row-policy-dnf-agent-${row.agentId}`}>
                <p className="text-xs text-fg-muted notranslate" translate="no">
                  {row.agentId}
                </p>
                <DnfGrantBody grant={row.finalRows} testId={`row-policy-dnf-agent-${row.agentId}-rows`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {footer}
    </div>
  );
}
