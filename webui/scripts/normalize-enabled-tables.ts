/**
 * 把 ktx.yaml 的 enabled_tables 收成 Manifest 物理名。
 *
 *   cd webui && npx tsx scripts/normalize-enabled-tables.ts --project /path/to/project
 *   cd webui && npx tsx scripts/normalize-enabled-tables.ts --project /path/to/project --apply
 *
 * 默认只打印计划。--apply 才会写盘，并在同目录留下 ktx.yaml.bak-enabled-tables-*。
 * 映射不到的启用项会保留并打印，不会删除。
 * --strict 在仍有无法映射的项时以退出码 1 结束；默认不因此失败。
 */

import path from "node:path";
import { applyEnabledTablesMigration, planEnabledTablesMigration } from "../server/enabled-tables";
import { inspectUnresolvedAgentRoles } from "../server/access-role-precheck";

function parseArgs(argv: string[]): { projectRoot: string; apply: boolean; strict: boolean } {
  let projectRoot = process.env.KTX_PROJECT_ROOT?.trim() || process.cwd();
  let apply = false;
  let strict = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--project") {
      const next = argv[i + 1];
      if (!next) throw new Error("--project 需要路径");
      projectRoot = next;
      i += 1;
    } else if (arg.startsWith("--project=")) {
      projectRoot = arg.slice("--project=".length);
    } else {
      throw new Error(`未知参数 ${arg}`);
    }
  }
  return { projectRoot: path.resolve(projectRoot), apply, strict };
}

async function main() {
  const { projectRoot, apply, strict } = parseArgs(process.argv.slice(2));
  const changes = apply
    ? (await applyEnabledTablesMigration(projectRoot)).changes
    : await planEnabledTablesMigration(projectRoot);
  const changed = changes.filter((change) => change.before.join("\n") !== change.after.join("\n"));
  console.log(`[normalize-enabled-tables] project=${projectRoot} apply=${apply}`);
  console.log(`  connections=${changes.length} changed=${changed.length}`);
  for (const change of changed) {
    console.log(`  ${change.connectionId}`);
    for (const rewrite of change.rewritten) {
      console.log(`    ${rewrite.from} -> ${rewrite.to}`);
    }
    for (const duplicate of change.droppedDuplicates) {
      console.log(`    drop duplicate ${duplicate}`);
    }
    for (const name of change.unmapped) console.log(`    unmapped ${name}`);
    for (const name of change.ambiguous) console.log(`    ambiguous ${name}`);
  }
  if (apply) {
    const applied = changed.length > 0;
    console.log(applied ? "  wrote ktx.yaml and left a backup beside it" : "  no enabled_tables change");
  }

  const roles = await inspectUnresolvedAgentRoles(projectRoot);
  if (roles.skipped) {
    console.log(`[access-role-precheck] skipped, no file at ${roles.path}`);
  } else if (roles.findings.length === 0) {
    console.log("[access-role-precheck] no unresolved agent roles");
  } else {
    console.log(`[access-role-precheck] ${roles.findings.length} user(s) need attention`);
    for (const finding of roles.findings) {
      if (finding.reason) console.log(`  ${finding.userId}: ${finding.reason}`);
      else console.log(`  ${finding.userId}: missing ${finding.missing.join(", ")}`);
    }
    console.log("  不会自动把 role: admin 改成 lucy_admin。请在访问权限里改角色后再升级。");
  }

  const unmapped = changes.some((change) => change.unmapped.length > 0 || change.ambiguous.length > 0);
  if (strict && unmapped) {
    console.error("[normalize-enabled-tables] --strict: unmapped or ambiguous enabled tables remain");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[normalize-enabled-tables] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
