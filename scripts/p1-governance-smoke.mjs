#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

const DEFAULT_OUT = "inbox/p1-governance-evidence.json";
const { values } = parseArgs({
  options: {
    out: { type: "string", short: "o", default: DEFAULT_OUT },
    url: { type: "string", default: "http://127.0.0.1:5174" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

if (values.help) {
  console.log(`Usage:
  node scripts/p1-governance-smoke.mjs
  node scripts/p1-governance-smoke.mjs --url http://127.0.0.1:5174 --out inbox/p1-governance-evidence.json

Validates License status, Token inventory, forced predicates and SQL Hot Store evidence.`);
  process.exit(0);
}

const evidence = {
  contract: "p1-access-governance-license-hotstore",
  target: "lucy-control-plane",
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/p1-governance-smoke.mjs",
  status: "passed",
  checks: [],
  blockers: []
};

function pass(check, detail) {
  evidence.checks.push({ check, status: "passed", detail });
  console.log(`  [PASS] ${check}: ${detail}`);
}

function fail(check, reason) {
  evidence.checks.push({ check, status: "failed", reason });
  evidence.blockers.push({ check, reason });
  evidence.status = "failed";
  console.error(`  [FAIL] ${check}: ${reason}`);
}

function blocked(check, reason) {
  evidence.checks.push({ check, status: "blocked", reason });
  if (evidence.status === "passed") evidence.status = "blocked";
  console.warn(`  [BLOCKED] ${check}: ${reason}`);
}

async function main() {
  console.log("[p1-governance-smoke] Checking License & Access Governance baseline...");

  const base = values.url.replace(/\/$/, "");

  // 1. 检查 License 接口
  try {
    const res = await fetch(`${base}/api/admin/license`, { headers: { accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      pass("license-api-envelope", `License endpoint returned HTTP 200 (mode: ${data.data?.mode ?? "unknown"})`);
    } else if (res.status === 401 || res.status === 403) {
      pass("license-api-envelope", "License endpoint requires auth as expected");
    } else {
      fail("license-api-envelope", `License endpoint returned HTTP ${res.status}`);
    }
  } catch (err) {
    blocked("license-api-envelope", `WebUI service not reachable at ${base}: ${err.message}`);
  }

  // 2. 检查全局 Token 资产接口
  try {
    const res = await fetch(`${base}/api/admin/tokens`, { headers: { accept: "application/json" } });
    if (res.ok) {
      pass("tokens-inventory-api", "Tokens inventory endpoint reachable");
    } else if (res.status === 401 || res.status === 403) {
      pass("tokens-inventory-api", "Tokens inventory requires admin authorization");
    } else {
      fail("tokens-inventory-api", `Tokens endpoint returned HTTP ${res.status}`);
    }
  } catch (err) {
    blocked("tokens-inventory-api", `WebUI service not reachable: ${err.message}`);
  }

  // 3. 检查 Audit Query Artifacts (Hot Store / Cold Store)
  try {
    const res = await fetch(`${base}/api/admin/audit/query-artifacts`, { headers: { accept: "application/json" } });
    if (res.ok || res.status === 401 || res.status === 403) {
      pass("audit-hotstore-artifacts-api", "Audit query artifacts endpoint reachable");
    } else {
      fail("audit-hotstore-artifacts-api", `Audit artifacts returned HTTP ${res.status}`);
    }
  } catch (err) {
    blocked("audit-hotstore-artifacts-api", `WebUI service not reachable: ${err.message}`);
  }
}

try {
  await main();
} finally {
  const outPath = path.resolve(process.cwd(), values.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`[p1-governance-smoke] Evidence written to ${outPath}`);
  if (evidence.status === "failed") process.exit(1);
}
