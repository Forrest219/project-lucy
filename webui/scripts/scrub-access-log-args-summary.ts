#!/usr/bin/env tsx
/**
 * Spec 137: scrub raw `question` from historical access_log.args_summary.
 * Default is dry-run; pass --apply to write.
 */
import { scrubAccessLogArgsSummaries } from "../server/proxy/audit";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  const result = await scrubAccessLogArgsSummaries({
    dryRun,
    actor: "cli",
    reason: "spec-137-privacy-hardening",
    requestId: `cli-${Date.now()}`
  });
  console.log(
    JSON.stringify(
      {
        dryRun,
        ...result
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[scrub-access-log-args-summary] failed", err);
  process.exitCode = 1;
});
