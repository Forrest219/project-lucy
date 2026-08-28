// Mirror of server CONNECTION_ID_PATTERN in `server/project.ts`. Keep in sync.
export const CONNECTION_ID_PATTERN = "^[a-z][a-z0-9_-]{1,63}$";
export const CONNECTION_ID_RULE_HINT =
  "小写字母开头，仅小写字母、数字、下划线和短横线，2–64 个字符";

const CONNECTION_ID_RE = new RegExp(CONNECTION_ID_PATTERN);

export type ConnectionIdIssue = {
  code: "empty" | "pattern" | "duplicate";
  message: string;
};

export function validateConnectionId(
  value: string,
  existingIds: Iterable<string> = []
): ConnectionIdIssue | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return { code: "empty", message: "连接 ID 为必填项" };
  }
  if (!CONNECTION_ID_RE.test(trimmed)) {
    return {
      code: "pattern",
      message: "连接 ID 不符合命名规则"
    };
  }
  const existing = new Set(
    [...existingIds].map((id) => id.trim().toLowerCase()).filter(Boolean)
  );
  if (existing.has(trimmed.toLowerCase())) {
    return { code: "duplicate", message: "连接 ID 已存在" };
  }
  return null;
}

export type DatabaseType =
  | "mysql"
  | "postgres"
  | "starrocks"
  | "doris"
  | "sqlserver"
  | "oracle"
  | "sqlite";

export type DatabaseTypeConfig = {
  key: DatabaseType;
  label: string;
  driver: "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite";
  engine: string;
  wireProtocol: string;
  defaultPort?: number;
  isFileBased?: boolean;
  placeholderId: string;
};

export const DATABASE_TYPES: DatabaseTypeConfig[] = [
  {
    key: "mysql",
    label: "MySQL",
    driver: "mysql",
    engine: "mysql",
    wireProtocol: "mysql",
    defaultPort: 3306,
    placeholderId: "demo-mysql"
  },
  {
    key: "postgres",
    label: "PostgreSQL",
    driver: "postgres",
    engine: "postgres",
    wireProtocol: "postgres",
    defaultPort: 5432,
    placeholderId: "demo-postgres"
  },
  {
    key: "starrocks",
    label: "StarRocks",
    driver: "mysql",
    engine: "starrocks",
    wireProtocol: "mysql",
    defaultPort: 9030,
    placeholderId: "starrocks-r1"
  },
  {
    key: "doris",
    label: "Apache Doris",
    driver: "mysql",
    engine: "doris",
    wireProtocol: "mysql",
    defaultPort: 9030,
    placeholderId: "doris-r1"
  },
  {
    key: "sqlserver",
    label: "SQL Server",
    driver: "sqlserver",
    engine: "sqlserver",
    wireProtocol: "sqlserver",
    defaultPort: 1433,
    placeholderId: "dw-sqlserver"
  },
  {
    key: "oracle",
    label: "Oracle",
    driver: "oracle",
    engine: "oracle",
    wireProtocol: "oracle",
    defaultPort: 1521,
    placeholderId: "erp-oracle"
  },
  {
    key: "sqlite",
    label: "SQLite",
    driver: "sqlite",
    engine: "sqlite",
    wireProtocol: "sqlite",
    isFileBased: true,
    placeholderId: "local-sqlite"
  }
];

export function getDatabaseTypeConfig(key: string): DatabaseTypeConfig {
  const found = DATABASE_TYPES.find((t) => t.key === key);
  return found ?? DATABASE_TYPES[0];
}

export function defaultPortForDriver(driver: string): number {
  const found = DATABASE_TYPES.find((t) => t.key === driver || t.driver === driver);
  return found?.defaultPort ?? (driver === "postgres" ? 5432 : 3306);
}
