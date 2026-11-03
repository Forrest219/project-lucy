/**
 * 升级预检：列出 access.yaml 里声明了、但角色目录中不存在的 Agent 角色。
 * 只报告，不改写。`role: admin` 不会被自动换成 `lucy_admin`。
 * WebUI 登录账户的 `role: admin` → `operator` 仍由 admins-store 处理，不在这里。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveRoleIds } from "./proxy/acl.js";

export type UnresolvedRoleFinding = {
  userId: string;
  declared: string[];
  missing: string[];
  reason?: string;
};

export type AccessRolePrecheck =
  | { skipped: true; path: string }
  | { skipped: false; path: string; findings: UnresolvedRoleFinding[] };

function accessConfigPath(projectRoot: string): string {
  const override = process.env.LUCY_ACCESS_CONFIG_PATH?.trim();
  if (override) return path.resolve(override);
  return path.join(projectRoot, "webui", "config", "access.yaml");
}

export async function inspectUnresolvedAgentRoles(projectRoot: string): Promise<AccessRolePrecheck> {
  const filePath = accessConfigPath(projectRoot);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { skipped: true, path: filePath };
    throw error;
  }
  const doc = parse(text) as { users?: unknown; roles?: unknown } | null;
  const roles = doc && typeof doc === "object" && doc.roles && typeof doc.roles === "object" && !Array.isArray(doc.roles)
    ? doc.roles as Record<string, unknown>
    : {};
  const known = new Set(Object.keys(roles));
  const users = Array.isArray(doc?.users) ? doc.users : [];
  const findings: UnresolvedRoleFinding[] = [];
  for (const raw of users) {
    if (!raw || typeof raw !== "object") continue;
    const user = raw as { id?: unknown; role?: unknown; roles?: unknown };
    const userId = typeof user.id === "string" && user.id.trim() ? user.id.trim() : "(未命名)";
    const resolved = resolveRoleIds({
      role: typeof user.role === "string" ? user.role : undefined,
      roles: user.roles
    });
    if (!resolved.ok) {
      findings.push({ userId, declared: [], missing: [], reason: resolved.reason });
      continue;
    }
    const missing = resolved.roleIds.filter((roleId) => !known.has(roleId));
    if (missing.length === 0) continue;
    findings.push({ userId, declared: resolved.roleIds, missing });
  }
  return { skipped: false, path: filePath, findings };
}
