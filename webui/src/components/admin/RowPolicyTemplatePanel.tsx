/**
 * Lucy v0.25 P1 — L25-14 R1: 行策略模板列表、逐表可用性与保存前影响面.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.2（模板读取模型）, §6.1（模板列表显示名称、说明、谓词、引用数和当前快照；
 *   详情显示逐表可用性与引用清单）.
 *
 * The impact panel is the reason a template save is two steps: P1-1 §6.1
 * requires 新建 / 修改 / 删除 to dry-run FIRST and then show the affected
 * tables, the affected Agents, the policy-summary change and the audit state —
 * and the formal save may only report success when the runtime confirmed the
 * new policy (`runtimeAck`).
 */
import { RowPolicyStateBadge, type RowPolicySnapshotIdentity } from "./RowPolicyStateBadge";
import { rowPolicyTemplateUnusableReason, type RowPolicyTemplateOption } from "./RowPolicyTemplatePicker";

export type RowPolicyTemplatePredicate = {
  field: string;
  op: "eq" | "in";
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
};

export type RowPolicyTemplateReferenceView = {
  roleId: string;
  connectionId?: string;
  schema?: string;
  sourceNames?: string[];
  prefixSelector?: boolean;
};

export type RowPolicyTemplateView = {
  name: string;
  description?: string;
  predicates: RowPolicyTemplatePredicate[];
  digest: string;
  references: RowPolicyTemplateReferenceView[];
  usabilityByTable: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    usability: { status: string; fields?: string[]; reason?: string };
  }>;
};

export type RowPolicyTemplateListResponse = {
  snapshot: { identity: RowPolicySnapshotIdentity; state: string; problem: string | null; failures: Array<{ subjectId: string; reason: string }> };
  state: string;
  templates: RowPolicyTemplateView[];
  issues: Array<{ code: string; templateName?: string; roleId?: string; detail?: string }>;
};

export type RowPolicyTemplateImpact = {
  tables: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    beforeDigest: string;
    afterDigest: string;
    changed: boolean;
  }>;
  agents: Array<{ agentId: string; roleIds: string[] }>;
  policyDigestBefore: string;
  policyDigestAfter: string;
  affectedRoleIds: string[];
};

export type RowPolicyTemplateWriteResponse = {
  dryRun: boolean;
  written: boolean;
  operationId: string;
  candidateDigest: string;
  version: string;
  impact: RowPolicyTemplateImpact;
  issues: Array<{ code: string; templateName?: string; roleId?: string; detail?: string }>;
  blockingReferences: RowPolicyTemplateReferenceView[];
  proposedYaml?: string;
  policyVersion?: string;
  runtimeAck?: boolean;
};

function formatPredicate(predicate: RowPolicyTemplatePredicate): string {
  const value =
    predicate.op === "eq"
      ? String(predicate.value ?? "")
      : (predicate.values ?? []).map((item) => String(item)).join("、");
  return `${predicate.field} ${predicate.op === "eq" ? "等于" : "属于"} ${value}`;
}

export function RowPolicyTemplateTable({
  templates,
  selectedName,
  onSelect
}: {
  templates: RowPolicyTemplateView[];
  selectedName?: string;
  onSelect: (name: string) => void;
}) {
  if (templates.length === 0) {
    return (
      <p className="text-sm text-fg-muted" data-testid="row-policy-template-empty">
        还没有行策略模板。
      </p>
    );
  }
  return (
    <table className="w-full text-left text-sm" data-testid="row-policy-template-table">
      <thead>
        <tr className="text-xs text-fg-muted">
          <th scope="col">名称</th>
          <th scope="col">说明</th>
          <th scope="col">谓词</th>
          <th scope="col">引用数</th>
        </tr>
      </thead>
      <tbody>
        {templates.map((template) => (
          <tr
            key={template.name}
            className={selectedName === template.name ? "bg-surface-muted" : undefined}
            data-testid={`row-policy-template-row-${template.name}`}
          >
            <td>
              <button
                type="button"
                className="underline notranslate"
                translate="no"
                onClick={() => onSelect(template.name)}
              >
                {template.name}
              </button>
            </td>
            <td className="text-fg-muted">{template.description ?? "—"}</td>
            <td>
              <ul className="grid gap-0.5">
                {template.predicates.map((predicate, index) => (
                  <li key={index} className="notranslate" translate="no">
                    {formatPredicate(predicate)}
                  </li>
                ))}
              </ul>
            </td>
            <td data-testid={`row-policy-template-reference-count-${template.name}`}>
              {template.references.length}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RowPolicyTemplateDetail({
  template
}: {
  template: RowPolicyTemplateView | undefined;
}) {
  if (!template) {
    return (
      <p className="text-sm text-fg-muted" data-testid="row-policy-template-detail-empty">
        选择一个模板查看逐表可用性与引用清单。
      </p>
    );
  }
  return (
    <section className="grid gap-2" data-testid="row-policy-template-detail">
      <h3 className="text-sm font-medium notranslate" translate="no">
        {template.name}
      </h3>
      <p className="text-xs text-fg-muted">
        摘要：<span className="notranslate" translate="no">{template.digest}</span>
      </p>

      <div className="grid gap-1">
        <h4 className="text-xs font-medium">逐表可用性</h4>
        {template.usabilityByTable.length === 0 ? (
          <p className="text-xs text-fg-muted" data-testid="row-policy-template-usability-empty">
            该模板还没有绑定任何表。
          </p>
        ) : (
          <ul className="grid gap-1" data-testid="row-policy-template-usability">
            {template.usabilityByTable.map((entry) => {
              const option: RowPolicyTemplateOption = {
                name: template.name,
                usability: entry.usability as RowPolicyTemplateOption["usability"]
              };
              const reason = rowPolicyTemplateUnusableReason(option);
              return (
                <li key={`${entry.connectionId}/${entry.schema}/${entry.sourceName}`} className="text-xs">
                  <span className="notranslate" translate="no">
                    {entry.connectionId}/{entry.schema}/{entry.sourceName}
                  </span>
                  <span className="ml-2">
                    {reason ? `不可绑定：${reason}` : "可绑定"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-1">
        <h4 className="text-xs font-medium">引用清单</h4>
        {template.references.length === 0 ? (
          <p className="text-xs text-fg-muted" data-testid="row-policy-template-references-empty">
            没有角色引用该模板。
          </p>
        ) : (
          <ul className="grid gap-1" data-testid="row-policy-template-references">
            {template.references.map((reference, index) => (
              <li key={index} className="text-xs notranslate" translate="no">
                {reference.roleId} · {reference.connectionId ?? "*"}/{reference.schema ?? "*"}/
                {reference.prefixSelector ? "(prefix)" : (reference.sourceNames ?? []).join(",")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The dry-run impact panel.
 *
 * It shows the affected tables, the affected Agents, the policy-summary change
 * and the audit state BEFORE anything is written. The formal save button stays
 * disabled until the operator has seen a preview for the CURRENT candidate —
 * the page clears the preview whenever the draft changes, so this panel can
 * never show a stale candidate's impact (P1-1 §6.1 / RTP-06).
 */
export function RowPolicyTemplateImpactPanel({
  preview,
  auditState
}: {
  preview?: RowPolicyTemplateWriteResponse;
  auditState: string;
}) {
  if (!preview) {
    return (
      <p className="text-sm text-fg-muted" data-testid="row-policy-template-impact-empty">
        先执行一次预演，查看影响表、<span className="notranslate" translate="no">Agent</span> 与策略摘要变化后再保存。
      </p>
    );
  }
  const impact = preview.impact;
  return (
    <section className="grid gap-2" data-testid="row-policy-template-impact">
      <h4 className="text-sm font-medium">保存前影响面</h4>
      <dl className="grid gap-1 text-xs text-fg-muted">
        <div className="flex gap-2">
          <dt>受影响角色</dt>
          <dd className="notranslate" translate="no">
            {impact.affectedRoleIds.join("、") || "—"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>受影响 <span className="notranslate" translate="no">Agent</span></dt>
          <dd className="notranslate" translate="no">
            {impact.agents.map((agent) => agent.agentId).join("、") || "—"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>策略摘要</dt>
          <dd className="notranslate" translate="no">
            {impact.policyDigestBefore} → {impact.policyDigestAfter}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt>审计状态</dt>
          <dd data-testid="row-policy-template-audit-state">{auditState}</dd>
        </div>
      </dl>
      {impact.tables.length === 0 ? (
        <p className="text-xs text-fg-muted" data-testid="row-policy-template-impact-tables-empty">
          该变更不影响任何表的行约束。
        </p>
      ) : (
        <table className="w-full text-left text-xs" data-testid="row-policy-template-impact-tables">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col">表</th>
              <th scope="col">变更前</th>
              <th scope="col">变更后</th>
              <th scope="col">是否变化</th>
            </tr>
          </thead>
          <tbody>
            {impact.tables.map((table) => (
              <tr key={`${table.connectionId}/${table.schema}/${table.sourceName}`}>
                <td className="notranslate" translate="no">
                  {table.connectionId}/{table.schema}/{table.sourceName}
                </td>
                <td className="notranslate" translate="no">
                  {table.beforeDigest}
                </td>
                <td className="notranslate" translate="no">
                  {table.afterDigest}
                </td>
                <td>{table.changed ? "变化" : "不变"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.blockingReferences.length > 0 ? (
        <p className="text-xs text-warning-strong" data-testid="row-policy-template-blocking-references">
          该模板仍被引用，无法删除或改名。
        </p>
      ) : null}
    </section>
  );
}

export { RowPolicyStateBadge };
