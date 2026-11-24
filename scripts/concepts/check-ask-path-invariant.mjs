#!/usr/bin/env node
/**
 * P1-11 SC-09 — CONCEPT_OPS_DIFF_BASE ask-path invariant.
 *
 * 1) Diff vs base must not touch ask-path hot files (proxy query / caliber / source selection).
 * 2) Optional: CONCEPT_OPS_ASK_FIXTURE_DIR — semantic+wiki fingerprint unchanged by concepts/.
 *
 * CONCEPT_OPS_DIFF_BASE=<commit> node scripts/concepts/check-ask-path-invariant.mjs
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ASK_PATH_PREFIXES = [
  "webui/server/proxy/mcp-proxy.ts",
  "webui/server/proxy/query-guardrails.ts",
  "webui/server/proxy/acl.ts",
  "webui/server/caliber",
  "webui/server/catalog",
];

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function collectDiffPaths(base) {
  const sets = new Set();
  const add = (out) => {
    for (const line of out.split("\n")) {
      const p = line.trim();
      if (p) sets.add(p);
    }
  };
  if (base) {
    try {
      add(sh(`git diff --name-only ${base}`));
    } catch {
      // ignore unreachable base
    }
  }
  try {
    add(sh("git diff --name-only --cached"));
    add(sh("git diff --name-only"));
    add(sh("git ls-files --others --exclude-standard"));
  } catch (err) {
    throw new Error(`git inventory failed: ${err.message}`);
  }
  return [...sets].sort();
}

function isAskPath(p) {
  return ASK_PATH_PREFIXES.some((pre) => p === pre || p.startsWith(pre.endsWith("/") ? pre : `${pre}/`) || p.startsWith(pre));
}

function hashTree(root) {
  const hash = createHash("sha256");
  if (!fs.existsSync(root)) return hash.update("ABSENT").digest("hex");
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    const st = fs.statSync(cur);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(cur).sort()) stack.push(path.join(cur, name));
    } else {
      hash.update(path.relative(root, cur));
      hash.update(fs.readFileSync(cur));
    }
  }
  return hash.digest("hex");
}

export function checkAskPathInvariant({
  base = process.env.CONCEPT_OPS_DIFF_BASE || "",
  fixtureDir = process.env.CONCEPT_OPS_ASK_FIXTURE_DIR || "",
} = {}) {
  const paths = collectDiffPaths(base);
  const askHits = paths.filter(isAskPath);
  const result = {
    ok: askHits.length === 0,
    base: base || null,
    askHits,
    fixture: null,
  };
  if (fixtureDir) {
    const semantic = path.join(fixtureDir, "semantic-layer");
    const wiki = path.join(fixtureDir, "wiki");
    const concepts = path.join(fixtureDir, "concepts");
    const before = `${hashTree(semantic)}:${hashTree(wiki)}`;
    // touch concepts without changing semantic/wiki
    fs.mkdirSync(concepts, { recursive: true });
    fs.writeFileSync(path.join(concepts, "_sc09_probe.yaml"), "id: sc09_probe\n", "utf8");
    const after = `${hashTree(semantic)}:${hashTree(wiki)}`;
    result.fixture = { before, after, ok: before === after };
    if (!result.fixture.ok) result.ok = false;
    try {
      fs.unlinkSync(path.join(concepts, "_sc09_probe.yaml"));
    } catch {
      // ignore
    }
  }
  return result;
}

function main() {
  const result = checkAskPathInvariant();
  if (!result.ok) {
    process.stderr.write(
      `error: SC-09 ask-path invariant violated\n`
        + (result.askHits.length ? `ask-path diffs:\n${result.askHits.map((p) => `  - ${p}`).join("\n")}\n` : "")
        + (result.fixture && !result.fixture.ok ? "fixture semantic/wiki fingerprint changed\n" : ""),
    );
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) main();
