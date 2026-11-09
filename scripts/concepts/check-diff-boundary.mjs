#!/usr/bin/env node
/**
 * S5 / SC-05 / SC-08: Concept Registry phase-1 diff boundary gate.
 *
 * CONCEPTS_DIFF_BASE=<commit> npm run concepts:check-diff
 * (or: node scripts/concepts/check-diff-boundary.mjs)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALLOW_EXACT = new Set([
  "package.json",
  "webui/docs/00-product-terminology-standard.md",
  "docs/governance/test-layers-and-release-gates.md",
  "docs/specs/lucy-20261108-concept-registry-ontology-lite-spec.md",
  "docs/plans/lucy-20261108-concept-registry-ontology-lite-plan.md",
  "docs/reviews/2026-11-09-concept-registry-ontology-lite-codex-review.md",
  "docs/specs/lucy-20261109-concept-registry-lucy-ops-control-plane-spec.md",
  "docs/plans/lucy-20261109-concept-registry-lucy-ops-control-plane-plan.md",
  "docs/reviews/2026-11-09-concept-registry-lucy-ops-control-plane-codex-review.md",
  "docs/README.md",
  "docs/plans/README.md",
  "docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md",
  "docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md",
  "webui/src/lib/rolePermissionDraft.ts",
  "webui/server/admin/mcp-tools.ts",
]);

const ALLOW_PREFIXES = [
  "scripts/concepts/",
  "webui/server/ops/",
  "inbox/",
];

const PACKAGE_SCRIPT_KEYS = new Set([
  "concepts",
  "concepts:test",
  "concepts:check-diff",
  "concepts:check-ask-path",
]);

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function collectPaths(base) {
  const sets = new Set();
  const addLines = (out) => {
    for (const line of out.split("\n")) {
      const p = line.trim();
      if (p) sets.add(p);
    }
  };
  if (base) {
    try {
      addLines(sh(`git diff --name-only ${base}`));
    } catch {
      // base may be unreachable in shallow clones; fall through to working tree
    }
  }
  try {
    addLines(sh("git diff --name-only --cached"));
    addLines(sh("git diff --name-only"));
    addLines(sh("git ls-files --others --exclude-standard"));
  } catch (err) {
    throw new Error(`git inventory failed: ${err.message}`);
  }
  return [...sets].sort();
}

function allowed(p) {
  if (ALLOW_EXACT.has(p)) return true;
  return ALLOW_PREFIXES.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre));
}

function packageScriptDrift(base) {
  if (!base) return [];
  let baseRaw;
  try {
    baseRaw = sh(`git show ${base}:package.json`);
  } catch {
    return [];
  }
  const basePkg = JSON.parse(baseRaw);
  const curPkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const baseScripts = basePkg.scripts || {};
  const curScripts = curPkg.scripts || {};
  const violations = [];
  const allKeys = new Set([...Object.keys(baseScripts), ...Object.keys(curScripts)]);
  for (const key of allKeys) {
    if (PACKAGE_SCRIPT_KEYS.has(key)) continue;
    if (baseScripts[key] !== curScripts[key]) {
      violations.push(`package.json scripts.${key} changed outside allowlist`);
    }
  }
  return violations;
}

export function checkDiffBoundary({ base = process.env.CONCEPTS_DIFF_BASE || "", cwd = process.cwd() } = {}) {
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const paths = collectPaths(base);
    const badPaths = paths.filter((p) => !allowed(p));
    const scriptViolations = paths.includes("package.json") ? packageScriptDrift(base) : [];
    return {
      ok: badPaths.length === 0 && scriptViolations.length === 0,
      paths,
      badPaths,
      scriptViolations,
      base: base || null,
    };
  } finally {
    process.chdir(prev);
  }
}

function main() {
  const result = checkDiffBoundary();
  if (!result.ok) {
    process.stderr.write(
      `error: concept-registry diff boundary violated\n`
        + (result.badPaths.length ? `paths:\n${result.badPaths.map((p) => `  - ${p}`).join("\n")}\n` : "")
        + (result.scriptViolations.length
          ? `scripts:\n${result.scriptViolations.map((p) => `  - ${p}`).join("\n")}\n`
          : ""),
    );
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, base: result.base, checked: result.paths.length }, null, 2) + "\n",
  );
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) main();
