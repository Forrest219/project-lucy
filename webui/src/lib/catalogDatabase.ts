const CATALOG_DATABASE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

/** Doris / SelectDB external catalog, written into `database` as `catalog.database`. */
export function splitCatalogDatabase(
  value: string | undefined | null
): { catalog: string; database: string } | null {
  const match = (value ?? "").trim().match(CATALOG_DATABASE);
  if (!match) return null;
  return { catalog: match[1], database: match[2] };
}

/** `hive_jd.app` yields `app`. A plain database name is unchanged. */
export function schemaNameFromDatabase(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  return splitCatalogDatabase(text)?.database ?? text;
}

export const CATALOG_DATABASE_HINT =
  "SelectDB 外部目录写成目录名.数据库名，例如 hive_jd.app。初始 Schema 填点号后面的数据库名。";
