// Spec 174 §8 / R6 — primary-ready and filter-completion predicates.
//
// Identical for baseline and after: each requires real DOM + fixture data +
// enabled controls, compared against expectations computed from the fixture
// files (never from the API under test). The functions are self-contained so
// they can be injected into the page with `fn.toString()`; keep them free of
// imports, closures and syntax that needs transpiling.

export type PerfExpected = {
  connections: number;
  tables: number;
  enabledTables: number;
  agents: number;
  connectionIds: string[];
  agentIds: string[];
  enabledTableNames: string[];
  connectionMetricValues: string[];
  schemaCount: number;
  catalogConnections: number;
  filterCases: Array<{ term: string; names: string[] }>;
};

export function connectionsReady(doc: Document, exp: PerfExpected): boolean {
  const enabled = (el: Element | null) => !!el && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true";
  if (doc.querySelectorAll('[data-testid^="connection-card-"]').length !== exp.connections) return false;
  const values = Array.from(doc.querySelectorAll('[data-testid="connection-metric-value"]')).map((n) => (n.textContent || "").trim());
  if (values.join("|") !== exp.connectionMetricValues.join("|")) return false;
  const statuses = Array.from(doc.querySelectorAll('[data-testid^="schema-asset-status-"]'));
  if (statuses.length !== exp.schemaCount) return false;
  for (const status of statuses) {
    const text = (status.textContent || "").trim();
    if (!text || text === "—") return false;
  }
  if (doc.querySelectorAll('[data-testid^="schema-enabled-count-"]').length !== exp.schemaCount) return false;
  return enabled(doc.querySelector('[data-testid="create-connection-btn"]'));
}

export function catalogReady(doc: Document, exp: PerfExpected): boolean {
  const input = doc.querySelector("input.pl-whitelist-search-input") as HTMLInputElement | null;
  if (!input || input.disabled || input.value !== "") return false;
  if (doc.querySelectorAll('[data-testid^="catalog-tree-connection-"]').length !== exp.catalogConnections) return false;
  const rows = Array.from(doc.querySelectorAll('tr[data-testid^="catalog-row-"]')).map((n) => (n.getAttribute("data-testid") || "").slice("catalog-row-".length));
  if (rows.length !== exp.enabledTableNames.length) return false;
  const a = rows.slice().sort();
  const b = exp.enabledTableNames.slice().sort();
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  const count = doc.querySelector('[data-testid="catalog-result-count"]');
  if (!count || (count.textContent || "").trim() !== `${b.length} 条结果`) return false;
  const root = doc.querySelector('[data-testid="catalog-tree-root"]');
  return !!root && (root.textContent || "").indexOf(`${b.length} 张表`) >= 0;
}

/** Filter completion: typed term applied, the expected row set and counts rendered. */
export function catalogFilterDone(doc: Document, exp: PerfExpected, term: string): boolean {
  const input = doc.querySelector("input.pl-whitelist-search-input") as HTMLInputElement | null;
  if (!input || input.value !== term) return false;
  let names: string[] | null = null;
  for (const item of exp.filterCases) if (item.term === term) names = item.names;
  if (!names) return false;
  const rows = Array.from(doc.querySelectorAll('tr[data-testid^="catalog-row-"]')).map((n) => (n.getAttribute("data-testid") || "").slice("catalog-row-".length));
  if (rows.length !== names.length) return false;
  const a = rows.slice().sort();
  const b = names.slice().sort();
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  const count = doc.querySelector('[data-testid="catalog-result-count"]');
  if (!count || (count.textContent || "").trim() !== `${b.length} 条结果`) return false;
  const root = doc.querySelector('[data-testid="catalog-tree-root"]');
  return !!root && (root.textContent || "").indexOf(`${b.length} 张表`) >= 0;
}

export function overviewReady(doc: Document, _exp: PerfExpected): boolean {
  if (doc.querySelector('[data-testid="async-region-pending"]')) return false;
  if (!doc.querySelector('[data-testid="ops-service-health-summary"]') && !doc.querySelector('[data-testid="ops-service-health-critical"]')) return false;
  const count = doc.querySelector('[data-testid="ops-action-required-count"]');
  const match = /^(\d+) 项$/.exec(((count && count.textContent) || "").trim());
  if (!match) return false;
  const items = Number(match[1]);
  if (items === 0) {
    if (!doc.querySelector('[data-testid="ops-action-required-empty"]')) return false;
  } else if (doc.querySelectorAll(".pl-action-required-list > .pl-action-required-item").length !== items) {
    return false;
  }
  const mcp = doc.querySelector('[data-testid="ops-mcp-access"]');
  if (!mcp) return false;
  const endpoint = mcp.querySelector("code");
  const endpointText = ((endpoint && endpoint.textContent) || "").trim();
  if (!endpointText || endpointText === "—") return false;
  const view = doc.querySelector('[data-testid="mcp-config-view-button"]') as HTMLButtonElement | null;
  return !!view && !view.disabled;
}

export function agentsReady(doc: Document, exp: PerfExpected): boolean {
  const ids = Array.from(doc.querySelectorAll('[data-testid^="agent-row-"]'))
    .map((n) => n.getAttribute("data-testid") || "")
    .filter((id) => id.indexOf("agent-row-index-") !== 0)
    .map((id) => id.slice("agent-row-".length));
  if (ids.length !== exp.agentIds.length) return false;
  const a = ids.slice().sort();
  const b = exp.agentIds.slice().sort();
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  const count = doc.querySelector('[data-testid="agent-list-result-count"]');
  if (!count || (count.textContent || "").trim() !== `${b.length} 条结果`) return false;
  const total = doc.querySelector('[data-testid="metric-agent-count-value"]');
  if (!total || (total.textContent || "").trim() !== String(b.length)) return false;
  const search = doc.querySelector('input[placeholder="搜索显示名或用户 ID"]') as HTMLInputElement | null;
  if (!search || search.disabled) return false;
  for (const label of ["当前状态", "角色", "近 7 天活跃"]) {
    const select = doc.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
    if (!select || select.disabled) return false;
  }
  return true;
}

/** In-page source for the init script: `__lucyPredicates.<name>(document, exp[, arg])`. */
export function predicatesScript(): string {
  const fns = { connectionsReady, catalogReady, catalogFilterDone, overviewReady, agentsReady };
  const body = Object.entries(fns).map(([name, fn]) => `${JSON.stringify(name)}: (${fn.toString()})`).join(",\n");
  return `{\n${body}\n}`;
}
