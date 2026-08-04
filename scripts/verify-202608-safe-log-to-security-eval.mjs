#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const webuiRoot = path.join(repoRoot, "webui");

const requiredFiles = [
  "webui/server/eval/security-candidates.ts",
  "webui/server/__tests__/security-eval-candidates.test.ts",
  "webui/src/pages/eval/SecurityCandidates.tsx",
  "webui/src/__tests__/security-eval-candidates.test.tsx"
];

for (const rel of requiredFiles) {
  readFileSync(path.join(repoRoot, rel), "utf8");
}

const source = readFileSync(path.join(repoRoot, "webui/server/eval/security-candidates.ts"), "utf8");
const checks = [
  ["review route", "/api/eval/security-candidates/:id/review"],
  ["promotion review gate", "REVIEW_REQUIRED"],
  ["high entropy rejection", "high_entropy_credential_detected"],
  ["formal security eval path", "evals/security/eval/security-eval-cases.yaml"]
];

for (const [label, pattern] of checks) {
  if (!source.includes(pattern)) {
    console.error(`[verify-202608] missing ${label}: ${pattern}`);
    process.exit(1);
  }
}

const result = spawnSync(
  "npm",
  ["test", "--", "server/__tests__/security-eval-candidates.test.ts", "src/__tests__/security-eval-candidates.test.tsx"],
  {
    cwd: webuiRoot,
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("[verify-202608] Safe Log-to-Security-Eval verification passed");
