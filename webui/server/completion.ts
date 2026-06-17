import type { CompletionStatus, TableModel } from "./model";

function hasText(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAuthoredText(text?: { ai?: string; human?: string }): boolean {
  return hasText(text?.human) || hasText(text?.ai);
}

export function computeCompletion(model: TableModel): CompletionStatus {
  const hasTableDesc = hasAuthoredText(model.descriptions);
  const hasGrain = Array.isArray(model.grain) && model.grain.length > 0;
  const describedColumns = model.columns.filter((column) => hasAuthoredText(column.descriptions));
  const hasAnyFieldDesc = describedColumns.length > 0;

  if (!hasTableDesc && !hasGrain && !hasAnyFieldDesc) {
    return "not_started";
  }

  const coreColumns = model.columns.filter((column) => column.visibility !== "hidden");
  const allCoreDescribed = coreColumns.length > 0 && coreColumns.every((column) => hasAuthoredText(column.descriptions));
  const hasPrimaryKey = model.columns.some((column) => column.pk === true);
  const hasMeasureSignal = Array.isArray(model.measures) && model.measures.length > 0;

  if (hasTableDesc && hasGrain && hasPrimaryKey && allCoreDescribed && hasMeasureSignal) {
    return "done";
  }

  return "partial";
}
