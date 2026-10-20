import type { RoleUserReference } from "./types";

const BLOCKED_SUFFIX = "请先解除该 Agent 的引用后再删除。";

export function roleDeleteReferenceNames(
  users: Array<Pick<RoleUserReference, "id" | "name">> | undefined,
  limit = 2
): { names: string[]; truncated: boolean } {
  const names = (users ?? [])
    .map((user) => (user.name || user.id).trim())
    .filter(Boolean);
  return { names: names.slice(0, limit), truncated: names.length > limit };
}

/** Plain-text form of the blocked-delete explanation. DOM copy should use RoleDeleteBlockedNotice. */
export function roleDeleteBlockedMessage(
  users: Array<Pick<RoleUserReference, "id" | "name">> | undefined
): string {
  const { names, truncated } = roleDeleteReferenceNames(users);
  if (names.length === 0) {
    return `无法删除：仍被 Agent 引用。${BLOCKED_SUFFIX}`;
  }
  const listed = names.map((name) => `「${name}」`).join("、");
  const tail = truncated ? "等" : "";
  return `无法删除：仍被 Agent${listed}${tail}引用。${BLOCKED_SUFFIX}`;
}
