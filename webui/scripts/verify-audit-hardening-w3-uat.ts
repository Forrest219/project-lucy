#!/usr/bin/env npx tsx
/** Spec 137 Wave 3 UAT — successful lucy_query through the real Proxy. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webuiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("npm", [
  "test", "--", "--run",
  "server/__tests__/mcp-proxy-smoke.test.ts",
  "server/__tests__/admin-audit.test.ts",
  "-t", "rewrites lucy_read_source and lucy_query|exports normalized filters"
], { cwd: webuiRoot, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ ok: true, wave: "W3", evidence: "real_lucy_query_and_pack_uat" }));
