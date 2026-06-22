import { backfillAccessLogSourcesFromTables } from "../server/proxy/audit";

function parseArgs(argv: string[]): { dryRun: boolean; sinceDays?: number } {
  const dryRun = argv.includes("--dry-run");
  const sinceArg = argv.find((arg) => arg.startsWith("--since-days="));
  const sinceDays = sinceArg ? Number(sinceArg.slice("--since-days=".length)) : undefined;
  return { dryRun, sinceDays };
}

async function main() {
  const { dryRun, sinceDays } = parseArgs(process.argv.slice(2));
  const result = await backfillAccessLogSourcesFromTables({ dryRun, sinceDays });
  console.log(`[backfill-access-log-sources] dryRun=${dryRun} sinceDays=${sinceDays ?? 7}`);
  console.log(`  scanned access_log rows: ${result.scanned}`);
  console.log(`  ${dryRun ? "would insert" : "inserted"} access_log_sources rows: ${result.inserted}`);
}

main().catch((err) => {
  console.error("[backfill-access-log-sources] failed", err);
  process.exitCode = 1;
});
