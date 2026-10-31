/** Plain-data checks for the release UX structure suite. Spec D3 / §5. */

const PRIMARY_LABELS = ["Role", "Case", "Run", "domain", "Drift", "Diff", "Reindex"] as const;

const STACK_FRAME = /at \S+ \([^)]+:\d+:\d+\)/;

export interface DatetimeFact {
  presetSelected: boolean;
  start: string;
  end: string;
}

export function h1Violation(h1s: string[], expectedLabel: string | null): string | null {
  if (h1s.length !== 1) return `expected one h1, found ${h1s.length}`;
  const text = h1s[0]?.trim() ?? "";
  if (!text) return "h1 is empty";
  if (expectedLabel !== null && text !== expectedLabel) {
    return `h1 ${JSON.stringify(text)} does not match sidebar label ${JSON.stringify(expectedLabel)}`;
  }
  return null;
}

export function errorTextViolations(visibleText: string): string[] {
  const hits: string[] = [];
  if (visibleText.includes("Failed to fetch")) hits.push("Failed to fetch");
  if (STACK_FRAME.test(visibleText)) hits.push("stack frame");
  return hits;
}

/** Primary labels only. Supplementary phrases such as 「角色权限 Role」do not match. */
export function forbiddenPrimaryLabels(names: string[]): string[] {
  const hits: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if ((PRIMARY_LABELS as readonly string[]).includes(name)) hits.push(name);
    if (name === "Data Capability Preview" || name === "数据能力预览") hits.push(name);
    if (name === "constraints") hits.push(name);
    if (name === "single_turn") hits.push(name);
    if (name.includes("Token 凭证")) hits.push("Token 凭证");
    if (name.includes("source · conn") || name.includes("source·conn")) hits.push("source·conn");
  }
  return hits;
}

export function datetimeViolation(fact: DatetimeFact | null): string | null {
  if (!fact || !fact.presetSelected) return null;
  if (fact.start.trim() && !fact.end.trim()) {
    return "time preset is selected, start has a value, and end is empty";
  }
  return null;
}
