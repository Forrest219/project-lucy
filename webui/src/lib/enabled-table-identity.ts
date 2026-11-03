/**
 * 逻辑表身份与物理对象名的纯函数。
 *
 * Manifest 的 `tables` key（加上 schema 文件名）是逻辑名，例如 `BIDM.hs_sy_company_metric`。
 * 同一条目的 `table:` 是要写入 `enabled_tables`、并交给数据库执行的物理名，
 * 例如 `bidm.dbo.hs_sy_company_metric` 或 `dbo.dm_cpu_asset_cost`。
 * 物理名只从 Manifest 读取，不按段数或文件名猜测。
 */

export type TableIdentityEntry = {
  logicalName: string;
  physicalName: string;
};

export type EnabledTableRewrite = {
  from: string;
  to: string;
};

export type NormalizedEnabledTables = {
  tables: unknown;
  rewritten: EnabledTableRewrite[];
  droppedDuplicates: string[];
  unmapped: string[];
  ambiguous: string[];
};

const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_]*";

/** 合法对象名：两段 `schema.table`，或三段 `database.schema.table`。 */
export const ENABLED_TABLE_NAME_RE = new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER}){1,2}$`);

export function isSqlServerDriver(driver: string | undefined): boolean {
  return driver === "sqlserver";
}

/**
 * 两段启用名的第一段是 Schema。三段名的第一段是数据库，不能当成连接 Schema。
 */
export function schemaInferredFromEnabledTable(table: string): string | null {
  const parts = table.split(".");
  if (parts.length !== 2 || !parts[0]) return null;
  return parts[0];
}

function aliasKey(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

export function enabledNameMatchesRow(
  enabledName: string,
  logicalName: string,
  physicalName: string,
  caseInsensitive: boolean
): boolean {
  const key = aliasKey(enabledName, caseInsensitive);
  return key === aliasKey(logicalName, caseInsensitive) || key === aliasKey(physicalName, caseInsensitive);
}

export function manifestTableIsEnabled(
  enabledTables: readonly string[],
  logicalName: string,
  physicalName: string,
  caseInsensitive: boolean
): boolean {
  return enabledTables.some((name) =>
    enabledNameMatchesRow(name, logicalName, physicalName, caseInsensitive)
  );
}

type AliasHit = { physicalName: string; ambiguous: boolean };

function buildAliasIndex(
  entries: readonly TableIdentityEntry[],
  caseInsensitive: boolean
): Map<string, AliasHit> {
  const index = new Map<string, AliasHit>();
  const add = (key: string, physicalName: string) => {
    const prev = index.get(key);
    if (!prev) {
      index.set(key, { physicalName, ambiguous: false });
      return;
    }
    if (prev.physicalName !== physicalName) prev.ambiguous = true;
  };
  for (const entry of entries) {
    const logical = entry.logicalName.trim();
    const physical = entry.physicalName.trim();
    if (!logical || !physical) continue;
    add(aliasKey(logical, caseInsensitive), physical);
    add(aliasKey(physical, caseInsensitive), physical);
  }
  return index;
}

/**
 * 把启用名收成 Manifest 物理名。
 * 映射不到的项原样保留。大小写折叠后指向两张不同物理表的项也不改写。
 * 收成同一物理名的重复项只留第一次出现的权威值。
 */
export function normalizeEnabledTableNames(
  enabledTables: unknown,
  entries: readonly TableIdentityEntry[],
  caseInsensitive: boolean
): NormalizedEnabledTables {
  const rewritten: EnabledTableRewrite[] = [];
  const droppedDuplicates: string[] = [];
  const unmapped: string[] = [];
  const ambiguous: string[] = [];
  if (!Array.isArray(enabledTables)) {
    return { tables: enabledTables, rewritten, droppedDuplicates, unmapped, ambiguous };
  }
  const index = buildAliasIndex(entries, caseInsensitive);
  const seen = new Set<string>();
  const tables: unknown[] = [];
  for (const item of enabledTables) {
    if (typeof item !== "string") {
      tables.push(item);
      continue;
    }
    const trimmed = item.trim();
    const hit = trimmed ? index.get(aliasKey(trimmed, caseInsensitive)) : undefined;
    if (hit?.ambiguous) ambiguous.push(trimmed);
    else if (!hit && trimmed) unmapped.push(trimmed);
    const canonical = hit && !hit.ambiguous ? hit.physicalName : trimmed;
    // Ambiguous keys must stay distinct. Folding them would delete one of the
    // two physical names the index refused to choose between.
    const dedupeKey = hit?.ambiguous ? canonical : aliasKey(canonical, caseInsensitive);
    if (canonical && seen.has(dedupeKey)) {
      droppedDuplicates.push(trimmed);
      continue;
    }
    if (canonical) seen.add(dedupeKey);
    if (canonical !== trimmed) rewritten.push({ from: trimmed, to: canonical });
    tables.push(canonical);
  }
  return { tables, rewritten, droppedDuplicates, unmapped, ambiguous };
}

export function canonicalEnabledTables(
  enabledTables: readonly string[],
  entries: readonly TableIdentityEntry[],
  caseInsensitive: boolean
): string[] {
  const normalized = normalizeEnabledTableNames(enabledTables, entries, caseInsensitive);
  if (!Array.isArray(normalized.tables)) return [...enabledTables];
  return normalized.tables.filter((item): item is string => typeof item === "string");
}

/**
 * 某个 Schema 下的已启用表数。
 * 先按逻辑表计一次（逻辑名或物理名都算同一张），再把仍对不上 Manifest、
 * 但以 `schema.` 开头的历史项按原规则计入，避免把缺 Manifest 的漂移数成 0。
 */
export function countEnabledForSchema(
  schema: string,
  enabledTables: readonly string[],
  tables: ReadonlyArray<{ schema: string; table: string; qualifiedName?: string }>,
  caseInsensitive: boolean
): number {
  const matched = new Set<string>();
  let count = 0;
  for (const table of tables) {
    if (table.schema !== schema) continue;
    const logicalName = `${table.schema}.${table.table}`;
    const physicalName = table.qualifiedName?.trim() || logicalName;
    const hits = enabledTables.filter((name) =>
      enabledNameMatchesRow(name, logicalName, physicalName, caseInsensitive)
    );
    if (hits.length === 0) continue;
    count += 1;
    for (const name of hits) matched.add(name);
  }
  for (const entry of enabledTables) {
    if (matched.has(entry)) continue;
    if (entry.startsWith(`${schema}.`)) count += 1;
  }
  return count;
}
