import type { Role } from "./types";

/** Spec 131 — high-privilege ops data-plane Role (not WebUI login admin). */
export function isLucyAdminDataPlaneRole(
  role: Pick<Role, "id" | "source_scope"> | null | undefined
): boolean {
  if (!role) return false;
  return role.id === "lucy_admin" || role.source_scope === "catalog_bound";
}
