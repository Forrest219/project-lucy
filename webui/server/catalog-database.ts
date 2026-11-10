const CATALOG_DATABASE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

/** Doris / SelectDB `catalog.database`, for example `hive_jd.app`. */
export function splitCatalogDatabase(
  value: string | undefined | null
): { catalog: string; database: string } | null {
  const match = (value ?? "").trim().match(CATALOG_DATABASE);
  if (!match) return null;
  return { catalog: match[1], database: match[2] };
}

/** External directory name. `hive_jd.app` yields `hive_jd`; a plain database name yields null. */
export function externalCatalogName(value: string | undefined | null): string | null {
  return splitCatalogDatabase(value)?.catalog ?? null;
}

/** Schema to register for a connection database. `hive_jd.app` yields `app`. */
export function schemaNameFromDatabase(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  return splitCatalogDatabase(text)?.database ?? text;
}

/** Quote a MySQL identifier, including non-ASCII table names. Rejects control characters. */
export function quoteMysqlIdent(value: string): string {
  if (!value || value.length > 256 || /[\0\r\n]/.test(value)) {
    throw new Error("invalid MySQL identifier");
  }
  return `\`${value.replace(/`/g, "``")}\``;
}

function sqlString(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("invalid SQL string");
  }
  return `'${value}'`;
}

/**
 * Catalog-qualified information_schema. KTX 0.16.0 rejects SHOW, and an
 * unqualified information_schema resolves to a missing default-cluster database
 * on this customer's SelectDB external catalogs.
 */
export function catalogSchemataSql(catalog: string): string {
  return `SELECT schema_name FROM ${quoteMysqlIdent(catalog)}.${quoteMysqlIdent("information_schema")}.${quoteMysqlIdent("schemata")} ORDER BY schema_name`;
}

export function catalogTablesSql(catalog: string, database: string): string {
  return `SELECT table_name FROM ${quoteMysqlIdent(catalog)}.${quoteMysqlIdent("information_schema")}.${quoteMysqlIdent("tables")} WHERE table_schema = ${sqlString(database)} AND table_type = 'BASE TABLE' ORDER BY table_name`;
}

export function describeCatalogTableSql(catalog: string, database: string, table: string): string {
  return `DESC ${quoteMysqlIdent(catalog)}.${quoteMysqlIdent(database)}.${quoteMysqlIdent(table)}`;
}

/** Narrower than SHOW FULL COLUMNS; some SelectDB external catalogs accept this. */
export function showColumnsSql(catalog: string, database: string, table: string): string {
  return `SHOW COLUMNS FROM ${quoteMysqlIdent(catalog)}.${quoteMysqlIdent(database)}.${quoteMysqlIdent(table)}`;
}

/** Last-resort column probe for external catalogs that reject SHOW * COLUMNS. */
export function describeTableSql(catalog: string, database: string, table: string): string {
  return `DESCRIBE ${quoteMysqlIdent(catalog)}.${quoteMysqlIdent(database)}.${quoteMysqlIdent(table)}`;
}
