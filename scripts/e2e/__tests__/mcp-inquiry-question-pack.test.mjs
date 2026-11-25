/**
 * P1-79 Plan Task 1 — question-pack validator tests.
 *
 * Positive packs are constructed inline (the Task 2 YAML is authored separately);
 * negative packs mutate inline copies only. CLI tests spawn the real script.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify as yamlStringify } from "yaml";

import {
  BUDGET_CLASSES,
  CONTRACT_ID,
  MIN_CHAIN_TURNS,
  MIN_CHAINS,
  PRONOUN_BLOCKLIST_PATTERNS,
  PRONOUN_BLOCKLIST_TERMS,
  PRONOUN_BLOCKLIST_VERSION,
  ROLE_CLASSES,
  computePackDigest,
  findPronounHits,
  loadQuestionPack,
  validateQuestionPack,
} from "../lib/mcp-inquiry-question-pack.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_PATH = path.resolve(HERE, "../lib/mcp-inquiry-question-pack.mjs");

/**
 * Chain-level fixtures use one chain, so pack-level coverage checks are relaxed.
 * The CLI and P1-78 consumer always run with strict spec defaults.
 */
const RELAXED = Object.freeze({
  minChains: 1,
  requiredBudgetClasses: [],
  requiredRoleClasses: [],
});

function buildTurn(chainId, index, overrides = {}) {
  return {
    turnIndex: index,
    text: `查询 superstore_orders 在 2025 年 ${(index % 12) + 1} 月的订单销售额（${chainId} 第 ${index + 1} 轮）`,
    dependsOnTurn: index === 0 ? null : index - 1,
    carriedContext: ["连接=demo-mysql", "表=superstore_orders", "指标=订单销售额"],
    oracle: {
      kind: "independent-query",
      ref: `fixtures/oracle/${chainId}/turn-${String(index).padStart(2, "0")}.sql`,
      expect: { total_sales: 100000 + index },
    },
    ...overrides,
  };
}

function buildChain(id, options = {}) {
  const {
    budgetClass = "simple",
    identity = "read_only",
    connectionId = "demo-mysql",
    turnCount = MIN_CHAIN_TURNS,
  } = options;
  return {
    id,
    version: 1,
    lane: "long-followup",
    configProfileId: "lucy-mcp-compat-demo",
    budgetClass,
    identity,
    connectionId,
    turns: Array.from({ length: turnCount }, (_, index) => buildTurn(id, index)),
    evidence: ["requestId", "traceId", "identityId", "snapshotId"],
  };
}

function buildPack(chains, overrides = {}) {
  const pack = {
    contract: CONTRACT_ID,
    version: 1,
    packDigestSeed: "p1-79-seed-20261126",
    pronounBlocklistVersion: PRONOUN_BLOCKLIST_VERSION,
    cases: chains,
    ...overrides,
  };
  return { ...pack, packDigest: computePackDigest(pack) };
}

/** Covers all three budgetClasses and all four role classes under strict defaults. */
function buildFiveChainPack() {
  return buildPack([
    buildChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildChain("QB-LONG-03", { budgetClass: "complex", identity: "read_only" }),
    buildChain("QB-LONG-04", { budgetClass: "complex", identity: "restricted_A" }),
    buildChain("QB-LONG-05", { budgetClass: "follow-up-join", identity: "restricted_B", connectionId: "lucy-ops" }),
  ]);
}

/** Mutate an inline copy and recompute its digest so only the targeted rule fires. */
function mutatePack(pack, mutator) {
  const copy = structuredClone(pack);
  mutator(copy);
  copy.packDigest = computePackDigest(copy);
  return copy;
}

function codes(result) {
  return result.problems.map((p) => p.split(" ")[0]);
}

test("positive: minimal one-chain pack (21 turns) passes with relaxed coverage options", () => {
  const pack = buildPack([buildChain("QB-LONG-01")]);
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.deepEqual(result.problems, []);
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.digest, pack.packDigest);
});

test("positive: five-chain pack covering all budget classes and role classes passes strict defaults", () => {
  const pack = buildFiveChainPack();
  const result = validateQuestionPack(pack);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.deepEqual(result.problems, []);
  assert.equal(result.digest, pack.packDigest);
});

test("digest: stable across recomputation, key order, and null-vs-missing fields", () => {
  const pack = buildFiveChainPack();
  assert.equal(computePackDigest(pack), computePackDigest(structuredClone(pack)));

  const reordered = {
    cases: pack.cases,
    pronounBlocklistVersion: pack.pronounBlocklistVersion,
    packDigestSeed: pack.packDigestSeed,
    version: pack.version,
    contract: pack.contract,
  };
  assert.equal(computePackDigest(reordered), computePackDigest(pack));

  const withNull = buildPack([buildChain("QB-LONG-01")]);
  const withoutNull = structuredClone(withNull);
  delete withoutNull.cases[0].turns[0].dependsOnTurn; // explicit null ≡ missing key
  assert.equal(computePackDigest(withoutNull), computePackDigest(withNull));
});

test("digest: changes with text, oracle, seed, case order, and blocklist content", () => {
  const base = buildPack([buildChain("QB-LONG-01")]);
  const d0 = computePackDigest(base);

  const textChanged = mutatePack(base, (p) => {
    p.cases[0].turns[3].text = "查询 superstore_orders 在 2026 年 1 月的订单销售额";
  });
  assert.notEqual(computePackDigest(textChanged), d0);

  const oracleChanged = mutatePack(base, (p) => {
    p.cases[0].turns[3].oracle.expect.total_sales += 1;
  });
  assert.notEqual(computePackDigest(oracleChanged), d0);

  const seedChanged = mutatePack(base, (p) => {
    p.packDigestSeed = "another-seed";
  });
  assert.notEqual(computePackDigest(seedChanged), d0);

  const orderA = buildPack([buildChain("QB-LONG-01"), buildChain("QB-LONG-02")]);
  const orderB = buildPack([buildChain("QB-LONG-02"), buildChain("QB-LONG-01")]);
  assert.notEqual(computePackDigest(orderA), computePackDigest(orderB));

  const widenedBlocklist = computePackDigest(base, {
    version: "v2",
    terms: [...PRONOUN_BLOCKLIST_TERMS, "新指代词"],
    patterns: [...PRONOUN_BLOCKLIST_PATTERNS],
  });
  assert.notEqual(widenedBlocklist, d0);
});

test("negative: fewer than 21 turns rejected", () => {
  const pack = buildPack([buildChain("QB-LONG-01", { turnCount: 20 })]);
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("E_TURN_COUNT"), result.problems.join("\n"));
});

test("negative: turnIndex gap (缺号) rejected", () => {
  const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[5].turnIndex = 6;
  });
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("E_TURN_INDEX"), result.problems.join("\n"));
});

test("negative: duplicate turnIndex (重号) rejected", () => {
  const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[5].turnIndex = 4;
  });
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("E_TURN_INDEX"), result.problems.join("\n"));
});

test("negative: dependsOnTurn cycle rejected", () => {
  const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[1].dependsOnTurn = 2;
    p.cases[0].turns[2].dependsOnTurn = 1;
  });
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("E_DEPENDS_CYCLE"), result.problems.join("\n"));
  assert.ok(codes(result).includes("E_DEPENDS_ON"), result.problems.join("\n"));
});

test("negative: dependsOnTurn must reference the previous turn", () => {
  const skip = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[5].dependsOnTurn = 3;
  });
  const skipResult = validateQuestionPack(skip, RELAXED);
  assert.equal(skipResult.ok, false);
  assert.ok(codes(skipResult).includes("E_DEPENDS_ON"), skipResult.problems.join("\n"));
  assert.ok(!codes(skipResult).includes("E_DEPENDS_CYCLE"), skipResult.problems.join("\n"));

  const firstTurn = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[0].dependsOnTurn = 0;
  });
  const firstResult = validateQuestionPack(firstTurn, RELAXED);
  assert.equal(firstResult.ok, false);
  assert.ok(codes(firstResult).includes("E_DEPENDS_ON"), firstResult.problems.join("\n"));
});

test("negative: empty oracle rejected", () => {
  const nullOracle = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[3].oracle = null;
  });
  const nullResult = validateQuestionPack(nullOracle, RELAXED);
  assert.equal(nullResult.ok, false);
  assert.ok(codes(nullResult).includes("E_ORACLE_EMPTY"), nullResult.problems.join("\n"));

  const emptyObject = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[4].oracle = {};
  });
  const emptyResult = validateQuestionPack(emptyObject, RELAXED);
  assert.equal(emptyResult.ok, false);
  assert.ok(codes(emptyResult).includes("E_ORACLE_EMPTY"), emptyResult.problems.join("\n"));

  const noPayload = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[5].oracle = { kind: "exact" };
  });
  const noPayloadResult = validateQuestionPack(noPayload, RELAXED);
  assert.equal(noPayloadResult.ok, false);
  assert.ok(codes(noPayloadResult).includes("E_ORACLE_EMPTY"), noPayloadResult.problems.join("\n"));
});

test("negative: oracle placeholders (同上 / 沿用上一轮) rejected", () => {
  const refPlaceholder = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[3].oracle = { kind: "exact", ref: "同上" };
  });
  const refResult = validateQuestionPack(refPlaceholder, RELAXED);
  assert.equal(refResult.ok, false);
  assert.ok(codes(refResult).includes("E_ORACLE_PLACEHOLDER"), refResult.problems.join("\n"));

  const bareString = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[4].oracle = "沿用上一轮";
  });
  const bareResult = validateQuestionPack(bareString, RELAXED);
  assert.equal(bareResult.ok, false);
  assert.ok(codes(bareResult).includes("E_ORACLE_PLACEHOLDER"), bareResult.problems.join("\n"));
});

test("negative: oracle with unknown kind rejected", () => {
  const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[3].oracle = { kind: "guess", ref: "fixtures/oracle/x.sql" };
  });
  const result = validateQuestionPack(pack, RELAXED);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("E_ORACLE_SHAPE"), result.problems.join("\n"));
});

test("negative: missing or empty carriedContext rejected", () => {
  const missing = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    delete p.cases[0].turns[7].carriedContext;
  });
  const missingResult = validateQuestionPack(missing, RELAXED);
  assert.equal(missingResult.ok, false);
  assert.ok(codes(missingResult).includes("E_CARRIED_CONTEXT"), missingResult.problems.join("\n"));

  const empty = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].turns[8].carriedContext = [];
  });
  const emptyResult = validateQuestionPack(empty, RELAXED);
  assert.equal(emptyResult.ok, false);
  assert.ok(codes(emptyResult).includes("E_CARRIED_CONTEXT"), emptyResult.problems.join("\n"));
});

test("negative: missing identity or connection declaration rejected", () => {
  const noIdentity = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    delete p.cases[0].identity;
  });
  const noIdentityResult = validateQuestionPack(noIdentity, RELAXED);
  assert.equal(noIdentityResult.ok, false);
  assert.ok(codes(noIdentityResult).includes("E_IDENTITY"), noIdentityResult.problems.join("\n"));

  const badIdentity = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].identity = "lucy_super";
  });
  const badIdentityResult = validateQuestionPack(badIdentity, RELAXED);
  assert.equal(badIdentityResult.ok, false);
  assert.ok(codes(badIdentityResult).includes("E_IDENTITY"), badIdentityResult.problems.join("\n"));

  const noConnection = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    delete p.cases[0].connectionId;
  });
  const noConnectionResult = validateQuestionPack(noConnection, RELAXED);
  assert.equal(noConnectionResult.ok, false);
  assert.ok(codes(noConnectionResult).includes("E_CONNECTION"), noConnectionResult.problems.join("\n"));
});

test("negative: anaphora in question text rejected (那…呢 / 它 / 同上)", () => {
  for (const text of ["那 12 月呢？", "它的销售额是多少", "同上"]) {
    const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
      p.cases[0].turns[6].text = text;
    });
    const result = validateQuestionPack(pack, RELAXED);
    assert.equal(result.ok, false, `text should be rejected: ${text}`);
    assert.ok(codes(result).includes("E_PRONOUN"), result.problems.join("\n"));
  }
  assert.ok(findPronounHits("那 12 月呢？").length > 0);
  assert.ok(findPronounHits("它的销售额是多少").includes("它"));
  assert.ok(findPronounHits("同上").includes("同上"));
  assert.deepEqual(findPronounHits("查询 superstore_orders 在 2025 年 12 月的订单销售额"), []);
});

test("negative: budgetClass outside the domain rejected (follow-up / ops-w0 / missing)", () => {
  for (const budgetClass of ["follow-up", "ops-w0"]) {
    const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
      p.cases[0].budgetClass = budgetClass;
    });
    const result = validateQuestionPack(pack, RELAXED);
    assert.equal(result.ok, false, `budgetClass should be rejected: ${budgetClass}`);
    assert.ok(codes(result).includes("E_BUDGET_CLASS"), result.problems.join("\n"));
  }
  const missing = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    delete p.cases[0].budgetClass;
  });
  const missingResult = validateQuestionPack(missing, RELAXED);
  assert.equal(missingResult.ok, false);
  assert.ok(codes(missingResult).includes("E_BUDGET_CLASS"), missingResult.problems.join("\n"));
});

test("negative: hand-edited or missing packDigest rejected", () => {
  const pack = buildPack([buildChain("QB-LONG-01")]);
  const tampered = structuredClone(pack);
  tampered.packDigest = `sha256:${"0".repeat(64)}`;
  const tamperedResult = validateQuestionPack(tampered, RELAXED);
  assert.equal(tamperedResult.ok, false);
  assert.ok(codes(tamperedResult).includes("E_DIGEST"), tamperedResult.problems.join("\n"));
  // The returned digest is always the recomputed one, never the declared value.
  assert.equal(tamperedResult.digest, computePackDigest(tampered));
  assert.notEqual(tamperedResult.digest, tampered.packDigest);

  const missing = structuredClone(pack);
  delete missing.packDigest;
  const missingResult = validateQuestionPack(missing, RELAXED);
  assert.equal(missingResult.ok, false);
  assert.ok(codes(missingResult).includes("E_DIGEST"), missingResult.problems.join("\n"));
});

test("negative: wrong contract and malformed chain ids rejected", () => {
  const wrongContract = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.contract = "lucy-mcp-upgrade-question-bank";
  });
  const contractResult = validateQuestionPack(wrongContract, RELAXED);
  assert.equal(contractResult.ok, false);
  assert.ok(codes(contractResult).includes("E_CONTRACT"), contractResult.problems.join("\n"));

  for (const id of ["QB-LONG-1", "QB-LONG-001", "qb-long-01", "QB-FOLLOW-01"]) {
    const pack = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
      p.cases[0].id = id;
    });
    const result = validateQuestionPack(pack, RELAXED);
    assert.equal(result.ok, false, `id should be rejected: ${id}`);
    assert.ok(codes(result).includes("E_CHAIN_ID"), result.problems.join("\n"));
  }

  const duplicated = buildPack([buildChain("QB-LONG-01"), buildChain("QB-LONG-01")]);
  const dupResult = validateQuestionPack(duplicated, RELAXED);
  assert.equal(dupResult.ok, false);
  assert.ok(codes(dupResult).includes("E_CHAIN_ID"), dupResult.problems.join("\n"));
});

test("coverage: strict defaults reject under-covered packs", () => {
  const fourChains = buildPack([
    buildChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildChain("QB-LONG-03", { budgetClass: "complex", identity: "restricted_A" }),
    buildChain("QB-LONG-04", { budgetClass: "follow-up-join", identity: "restricted_B" }),
  ]);
  const countResult = validateQuestionPack(fourChains);
  assert.equal(countResult.ok, false);
  assert.ok(codes(countResult).includes("E_CHAIN_COUNT"), countResult.problems.join("\n"));
  assert.ok(MIN_CHAINS >= 5);

  const allSimple = buildPack([
    buildChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildChain("QB-LONG-03", { budgetClass: "simple", identity: "restricted_A" }),
    buildChain("QB-LONG-04", { budgetClass: "simple", identity: "restricted_B" }),
    buildChain("QB-LONG-05", { budgetClass: "simple", identity: "read_only" }),
  ]);
  const budgetResult = validateQuestionPack(allSimple);
  assert.equal(budgetResult.ok, false);
  assert.ok(codes(budgetResult).includes("E_BUDGET_CLASS_COVERAGE"), budgetResult.problems.join("\n"));

  const noRestrictedB = buildPack([
    buildChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildChain("QB-LONG-03", { budgetClass: "complex", identity: "restricted_A" }),
    buildChain("QB-LONG-04", { budgetClass: "complex", identity: "read_only" }),
    buildChain("QB-LONG-05", { budgetClass: "follow-up-join", identity: "lucy_admin" }),
  ]);
  const roleResult = validateQuestionPack(noRestrictedB);
  assert.equal(roleResult.ok, false);
  assert.ok(codes(roleResult).includes("E_ROLE_CLASS_COVERAGE"), roleResult.problems.join("\n"));
});

test("negative: blocklist version mismatch and missing evidence fields rejected", () => {
  const noVersion = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    delete p.pronounBlocklistVersion;
  });
  const noVersionResult = validateQuestionPack(noVersion, RELAXED);
  assert.equal(noVersionResult.ok, false);
  assert.ok(codes(noVersionResult).includes("E_BLOCKLIST_VERSION"), noVersionResult.problems.join("\n"));

  const oldVersion = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.pronounBlocklistVersion = "v0";
  });
  const oldVersionResult = validateQuestionPack(oldVersion, RELAXED);
  assert.equal(oldVersionResult.ok, false);
  assert.ok(codes(oldVersionResult).includes("E_BLOCKLIST_VERSION"), oldVersionResult.problems.join("\n"));

  const thinEvidence = mutatePack(buildPack([buildChain("QB-LONG-01")]), (p) => {
    p.cases[0].evidence = ["requestId", "traceId"];
  });
  const thinEvidenceResult = validateQuestionPack(thinEvidence, RELAXED);
  assert.equal(thinEvidenceResult.ok, false);
  assert.ok(codes(thinEvidenceResult).includes("E_EVIDENCE"), thinEvidenceResult.problems.join("\n"));
});

test("loadQuestionPack clones object input and rejects garbage", () => {
  const pack = buildPack([buildChain("QB-LONG-01")]);
  const loaded = loadQuestionPack(pack);
  assert.deepEqual(loaded, pack);
  loaded.cases[0].id = "QB-LONG-99";
  assert.equal(pack.cases[0].id, "QB-LONG-01");
  assert.throws(() => loadQuestionPack("scripts/e2e/contracts/does-not-exist.yaml"), /not found/);
});

test("constants stay aligned with the Spec", () => {
  assert.equal(CONTRACT_ID, "lucy-mcp-inquiry-long-followups-v1");
  assert.deepEqual([...BUDGET_CLASSES], ["simple", "complex", "follow-up-join"]);
  assert.deepEqual([...ROLE_CLASSES], ["read_only", "lucy_admin", "restricted_A", "restricted_B"]);
  assert.equal(MIN_CHAIN_TURNS, 21);
  assert.equal(PRONOUN_BLOCKLIST_VERSION, "v1");
});

test("cli: valid pack exits 0 and prints digest, chain count, per-chain turns", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "p1-79-pack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pack.yaml");
  writeFileSync(file, yamlStringify(buildFiveChainPack()), "utf8");

  const run = spawnSync(process.execPath, [LIB_PATH, "--pack", file, "--validate"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /packDigest: sha256:[0-9a-f]{64}/);
  assert.match(run.stdout, /chains: 5/);
  assert.match(run.stdout, /QB-LONG-01: 21 turns/);
  assert.match(run.stdout, /QB-LONG-05: 21 turns/);
});

test("cli: invalid pack exits non-zero and prints problem codes", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "p1-79-pack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pack.yaml");
  const bad = mutatePack(buildFiveChainPack(), (p) => {
    p.cases[2].turns = p.cases[2].turns.slice(0, 20);
  });
  writeFileSync(file, yamlStringify(bad), "utf8");

  const run = spawnSync(process.execPath, [LIB_PATH, "--pack", file, "--validate"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /E_TURN_COUNT/);
});

test("cli: usage and read errors exit 2", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "p1-79-pack-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "pack.yaml");
  writeFileSync(file, yamlStringify(buildFiveChainPack()), "utf8");

  const noValidate = spawnSync(process.execPath, [LIB_PATH, "--pack", file], { encoding: "utf8" });
  assert.equal(noValidate.status, 2);
  assert.match(noValidate.stderr, /E_CLI/);

  const missing = spawnSync(process.execPath, [LIB_PATH, "--pack", path.join(dir, "nope.yaml"), "--validate"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /E_PACK_READ/);
});
