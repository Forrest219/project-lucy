#!/usr/bin/env npx tsx
/** Spec 137 Wave 1 verification — real Proxy path + privacy scrub. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webuiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("npm", [
  "test", "--", "--run",
  "server/__tests__/mcp-proxy-smoke.test.ts",
  "server/__tests__/mcp-proxy-audit-meta.test.ts",
  "server/__tests__/audit-privacy.test.ts",
  "-t", "forwards an allowed tool call|injects lucy_begin_question|scrubAccessLogArgsSummaries|summarizeArgsForAudit"
], { cwd: webuiRoot, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ ok: true, wave: "W1", evidence: "real_proxy_and_scrub_tests" }));
