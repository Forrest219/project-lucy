// Mirror of server CONNECTION_ID_PATTERN in `server/project.ts`. Keep in sync.
export const CONNECTION_ID_PATTERN = "^[a-z][a-z0-9_-]{1,63}$";

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
      message: `连接 ID 不符合命名规则（${CONNECTION_ID_PATTERN}）`
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

export function defaultPortForDriver(driver: "mysql" | "postgres"): number {
  return driver === "postgres" ? 5432 : 3306;
}
