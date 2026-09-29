import type { Role } from "./types";

/** Spec 131 preset ops data-plane Role id (not WebUI login admin). */
export const LUCY_ADMIN_ROLE_ID = "lucy_admin";

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
