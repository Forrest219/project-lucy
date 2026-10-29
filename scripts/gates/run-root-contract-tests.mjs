#!/usr/bin/env node
// Run the deterministic root tests that the daily workflow-contracts job owns.
//
// The list comes from scripts/gates/root-test-registry.json, so the registry is the single
// source of truth: a test cannot enter or leave the daily gate without the registry changing.
// A blind `node --test` sweep over the whole repository is deliberately NOT used
// (Spec §4.1: root tests must not be swept; each one is registered with its runner, environment,
// side effects and command, and every exclusion states a reason).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const REGISTRY_PATH = path.join(HERE, "root-test-registry.json");
const GATE = process.argv[2] ?? "workflow-contracts";

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const files = registry.entries
  .filter((entry) => entry.gate === GATE)
  .map((entry) => entry.path)
  .sort();

if (!files.length) {
  console.error(`root contract tests: the registry has no entry for gate "${GATE}"`);
  process.exit(2);
}

console.log(`root contract tests: running ${files.length} registered file(s) for gate "${GATE}"`);
for (const file of files) console.log(`  - ${file}`);

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

if (result.error) {
  console.error(`root contract tests: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
