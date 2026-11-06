#!/usr/bin/env tsx
/**
 * 启动期系统正式 Role CLI。
 *
 * docker-entrypoint 在 seed 之后调用：
 *
 * ```text
 * tsx server/admin/ensure-system-formal-roles-cli.ts lucy_admin
 * ```
 *
 * `lucy_ops_reader` 只给需要单独补写的启动路径；常规挂点在 ops-evidence ensure。
 * 跳过、闸拒绝和写失败都退出 0，避免阻断容器启动。
 */

import { ensureLucyAdminFormalRole, ensureLucyOpsReaderFormalRole } from "./ensure-system-formal-roles.js";
import { resolveProjectRoot } from "../project.js";

async function main(): Promise<number> {
  const which = process.argv[2];
  if (which !== "lucy_admin" && which !== "lucy_ops_reader") {
    console.error(`[system_ensure_formal_roles] unknown role: ${which ?? ""}`);
    return 1;
  }

  let projectRoot: string;
  try {
    projectRoot = await resolveProjectRoot();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[system_ensure_formal_roles] project root unavailable: ${detail}`);
    return 0;
  }

  if (which === "lucy_admin") await ensureLucyAdminFormalRole({ projectRoot });
  else await ensureLucyOpsReaderFormalRole({ projectRoot });
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.warn("[system_ensure_formal_roles] ensure failed:", error);
    process.exitCode = 0;
  });
