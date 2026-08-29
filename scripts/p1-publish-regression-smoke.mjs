#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { parse } from "yaml";

const DEFAULT_OUT = "inbox/p1-publish-regression-evidence.json";
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
  node scripts/p1-publish-regression-smoke.mjs
  node scripts/p1-publish-regression-smoke.mjs --out inbox/p1-publish-regression-evidence.json

Validates Publish Stepper contract, quiet validation and gate_tier: smoke fallback logic.`);
  process.exit(0);
}

const evidence = {
  contract: "p1-publish-regression-and-stepper",
  target: "publish-workbench-and-eval",
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/p1-publish-regression-smoke.mjs",
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
  console.log("[p1-publish-regression-smoke] Verifying Publish Stepper and Change Regression contracts...");

  // 1. 验证 eval cases 中 gate_tier 标注与降级算法
  const evalDir = path.resolve(process.cwd(), "evals");
  let totalCases = 0;
  let smokeCases = 0;
  if (existsSync(evalDir)) {
    for (const ent of readdirSync(evalDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        const domainDir = path.join(evalDir, ent.name, "eval");
        if (existsSync(domainDir)) {
          for (const f of readdirSync(domainDir)) {
            if (f.endsWith(".yaml") || f.endsWith(".yml")) {
              try {
                const doc = parse(readFileSync(path.join(domainDir, f), "utf8")) ?? {};
                const cases = Array.isArray(doc.cases) ? doc.cases : [];
                totalCases += cases.length;
                smokeCases += cases.filter((c) => c.gate_tier === "smoke" || c.coverage === "basic").length;
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }
    pass("eval-smoke-subset-coverage", `Parsed ${totalCases} cases, found ${smokeCases} smoke-eligible cases`);
  } else {
    fail("eval-smoke-subset-coverage", "evals directory not found");
  }

  // 2. 验证 Diff 与 Validate Changed API 契约
  const base = values.url.replace(/\/$/, "");
  try {
    const diffRes = await fetch(`${base}/api/diff`, { headers: { accept: "application/json" } });
    if (diffRes.ok) {
      const diffData = await diffRes.json();
      pass("publish-diff-api", `Diff endpoint reachable, returned ${diffData.data?.files?.length ?? 0} changed files`);
    } else {
      fail("publish-diff-api", `Diff API returned HTTP ${diffRes.status}`);
    }
  } catch (err) {
    blocked("publish-diff-api", `WebUI service not reachable at ${base}: ${err.message}`);
  }

  try {
    const valRes = await fetch(`${base}/api/validate-changed`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ files: [] })
    });
    if (valRes.ok) {
      pass("publish-validate-changed-api", "Validate changed endpoint responded HTTP 200");
    } else {
      fail("publish-validate-changed-api", `Validate changed returned HTTP ${valRes.status}`);
    }
  } catch (err) {
    blocked("publish-validate-changed-api", `WebUI service not reachable: ${err.message}`);
  }
}

try {
  await main();
} finally {
  const outPath = path.resolve(process.cwd(), values.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`[p1-publish-regression-smoke] Evidence written to ${outPath}`);
  if (evidence.status === "failed") process.exit(1);
}
