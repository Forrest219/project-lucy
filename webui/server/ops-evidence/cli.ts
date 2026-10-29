#!/usr/bin/env tsx
/**
 * Spec 149 §8 / WO T7 — 运维问数连接的确保 CLI。
 *
 * Docker entrypoint 在 `seed_project` 之后、`supervise_ktx` 之前调用：
 *
 * ```text
 * seed_project
 * ensureOpsEvidence        # tsx server/ops-evidence/cli.ts ensure
 * sync_runtime_mirror
 * write digest stamp       # tsx server/ops-evidence/cli.ts stamp
 * supervise_ktx
 * ```
 *
 * 退出码：
 * - `0` 成功，或状态为 `conflict` / `not_ready`（连接不可查询，产品其余部分照常）
 * - `1` 其它错误
 */

import { ensureOpsEvidence } from "./ensure.js";
import { writeOpsEvidenceDigestStamp } from "./readiness.js";
import { resolveProjectRoot } from "../project.js";

async function main(): Promise<number> {
  const command = process.argv[2] ?? "ensure";
  const projectRoot = await resolveProjectRoot();

  if (command === "stamp") {
    const digest = await writeOpsEvidenceDigestStamp(projectRoot);
    console.log(`[ops-evidence] ktx.yaml digest stamped: ${digest}`);
    return 0;
  }

  if (command !== "ensure") {
    console.error(`[ops-evidence] unknown command: ${command}`);
    return 1;
  }

  const result = await ensureOpsEvidence({ projectRoot });
  const conflicts = result.assetConflicts.length;
  console.log(
    `[ops-evidence] connection=${result.connectionWrite} readiness=${result.readiness}` +
      ` assets=${result.assets.length} conflicts=${conflicts}` +
      ` mirror(copied=${result.mirror.copied},skipped=${result.mirror.skipped},failed=${result.mirror.failed})`
  );
  if (result.detail) console.warn(`[ops-evidence] ${result.detail}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("[ops-evidence] ensure failed:", error);
    process.exitCode = 1;
  });
