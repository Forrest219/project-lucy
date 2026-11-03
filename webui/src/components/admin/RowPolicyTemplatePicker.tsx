/**
 * Lucy v0.25 P1 — L25-14 R1: 行策略模板选择器.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.2（模板读取模型）, §6.1（模板下拉展示全部候选，不可绑定项禁用并给原因）;
 *   RTP-08.
 *
 * The dropdown shows EVERY candidate, including the ones that cannot be bound
 * to the table being edited. A disabled option is not hidden: hiding it would
 * make 「这个模板存在但不能绑到这张表」indistinguishable from 「这个模板不存在」,
 * and the operator would only learn the reason at save time (RTP-08 requires the
 * reason to be disclosed AT SELECTION time).
 */
import clsx from "clsx";

export type RowPolicyTemplateUsabilityStatus =
  | "bindable"
  | "field_missing"
  | "manifest_unavailable"
  | "catalog_unknown";

export type RowPolicyTemplateOption = {
  name: string;
  description?: string;
  /** The usability against the table being edited. */
  usability?: {
    status: RowPolicyTemplateUsabilityStatus;
    fields?: string[];
    reason?: string;
  };
};

/** The operator-facing reason a template cannot be bound to this table. */
export function rowPolicyTemplateUnusableReason(
  option: RowPolicyTemplateOption
): string | null {
  const usability = option.usability;
  if (!usability || usability.status === "bindable") return null;
  if (usability.status === "field_missing") {
    const fields = usability.fields ?? [];
    return fields.length > 0
      ? `字段不存在：${fields.join("、")}`
      : "字段不存在";
  }
  if (usability.status === "manifest_unavailable") {
    return `清单不可用（需运维处理）：${usability.reason ?? "unknown"}`;
  }
  return `目录能力未知（需运维处理）：${usability.reason ?? "unknown"}`;
}

export function RowPolicyTemplatePicker({
  templates,
  value,
  onChange,
  disabled,
  id = "row-policy-template-picker"
}: {
  templates: RowPolicyTemplateOption[];
  value?: string;
  onChange: (name: string | undefined) => void;
  disabled?: boolean;
  id?: string;
}) {
  const selected = templates.find((option) => option.name === value);
  const selectedReason = selected ? rowPolicyTemplateUnusableReason(selected) : null;
  return (
    <div className="grid gap-1" data-testid="row-policy-template-picker">
      <label className="text-xs text-fg-muted" htmlFor={id}>
        引用行策略模板
      </label>
      <select
        id={id}
        className="rounded border border-line bg-surface px-2 py-1 text-sm"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value ? event.target.value : undefined)}
      >
        <option value="">（不引用模板，直接写条件）</option>
        {templates.map((option) => {
          const reason = rowPolicyTemplateUnusableReason(option);
          return (
            <option
              key={option.name}
              value={option.name}
              disabled={Boolean(reason)}
              data-testid={`row-policy-template-option-${option.name}`}
            >
              {option.name}
              {option.description ? ` — ${option.description}` : ""}
              {reason ? `（不可绑定：${reason}）` : ""}
            </option>
          );
        })}
      </select>
      {selectedReason ? (
        <p className="text-xs text-warning-strong" role="status" data-testid="row-policy-template-picker-reason">
          当前模板不可绑定到这张表：{selectedReason}
        </p>
      ) : null}
      {templates.length === 0 ? (
        <p className="text-xs text-fg-muted" data-testid="row-policy-template-picker-empty">
          还没有可引用的行策略模板。
        </p>
      ) : null}
    </div>
  );
}

/**
 * The three authoring modes of a selector's row policy.
 *
 * 「引用模板／直接写条件／两者并用」are three DISTINCT states, not two: a
 * selector may carry a template reference, inline predicates, or both — and the
 * both-case is an AND inside the selector (P1-1 §5.1).
 */
export type RowPolicyAuthoringMode = "template" | "inline" | "both";

export function rowPolicyAuthoringMode(options: {
  templateName?: string;
  inlinePredicateCount: number;
}): RowPolicyAuthoringMode {
  if (options.templateName && options.inlinePredicateCount > 0) return "both";
  if (options.templateName) return "template";
  return "inline";
}

export function rowPolicyAuthoringModeLabel(mode: RowPolicyAuthoringMode): string {
  if (mode === "both") return "引用模板 + 直接写条件";
  if (mode === "template") return "仅引用模板";
  return "仅直接写条件";
}

export function RowPolicyAuthoringModeBadge({
  templateName,
  inlinePredicateCount
}: {
  templateName?: string;
  inlinePredicateCount: number;
}) {
  const mode = rowPolicyAuthoringMode({ templateName, inlinePredicateCount });
  return (
    <span
      className={clsx("pl-status-badge", mode === "inline" ? "pl-status-not_started" : "pl-status-done")}
      data-testid={`row-policy-authoring-mode-${mode}`}
    >
      {rowPolicyAuthoringModeLabel(mode)}
    </span>
  );
}
