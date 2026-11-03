import type { Role } from "./types";

/** Spec 131 preset ops data-plane Role id (not WebUI login admin). */
export const LUCY_ADMIN_ROLE_ID = "lucy_admin";

/** Agent binding high-privilege warning (Spec 2026-11-01). */
export const LUCY_ADMIN_WARNING_PRIMARY =
  "此角色可访问已声明连接下的全部启用表，权限很大。";
export const LUCY_ADMIN_WARNING_SECONDARY =
  "属 MCP 数据访问权限，与 WebUI 登录无关。";

/** Personal constraints context helpers (Spec 2026-11-01). */
export const PERSONAL_CONSTRAINT_DEFAULT_HELP =
  "在已绑定角色的行级策略之上再收窄；未设置则不追加。";
export const PERSONAL_CONSTRAINT_CATALOG_BOUND_HELP =
  "当前绑定含目录全表角色，角色侧无行级策略；个人行限制是此人唯一的行级收窄。未设置则不追加。";
export const PERSONAL_CONSTRAINT_CAVEAT =
  "配置成功只表示编译通过，不表示行级取数已生效。";

/** Formal yaml Role with this id must not be deleted via Admin UI. */
export function isDeleteProtectedRole(roleId: string | null | undefined): boolean {
  return roleId === LUCY_ADMIN_ROLE_ID;
}

/** Spec 131 — high-privilege ops data-plane Role (not WebUI login admin). */
export function isLucyAdminDataPlaneRole(
  role: Pick<Role, "id" | "source_scope"> | null | undefined
): boolean {
  if (!role) return false;
  return role.id === LUCY_ADMIN_ROLE_ID || role.source_scope === "catalog_bound";
}
