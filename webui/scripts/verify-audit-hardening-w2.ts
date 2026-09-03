#!/usr/bin/env npx tsx
/** Spec 137 Wave 2 verification — initialize correlation + SQL guard + export pack. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webuiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("npm", [
  "test", "--", "--run",
  "server/__tests__/mcp-proxy-instructions.test.ts",
  "server/__tests__/audit-privacy.test.ts",
  "server/__tests__/admin-audit.test.ts",
  "-t", "binds response mcp-session-id|looksLikeSql rejects|exports normalized filters|rejects an export"
], { cwd: webuiRoot, stdio: "inherit" });

if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ ok: true, wave: "W2", evidence: "real_initialize_and_pack_tests" }));
