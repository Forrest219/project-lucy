/**
 * P1-79 Task 1 — long-followup question pack (长追问题组) schema validation + canonical packDigest.
 *
 * Authority: docs/specs/lucy-20261123-long-followup-question-pack-spec.md (D1–D9, §3, §6)
 * Plan: docs/plans/lucy-20261123-long-followup-question-pack-plan.md Task 1
 * Oracle vocabulary inherited from P1-54: docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md §3
 *
 * Pure functions only: no network, no credentials, no filesystem writes.
 * loadQuestionPack / runCli are the only filesystem readers (CLI entry consumed by Plan Task 2).
 *
 * Pack schema (scripts/e2e/contracts/mcp-inquiry-long-followups.yaml, authored in Plan Task 2):
 *   contract: "lucy-mcp-inquiry-long-followups-v1"     // required, exact match
 *   version: <integer >= 1> | <non-empty string>       // pack version (D7); bump on any content change
 *   packDigestSeed: <non-empty string>                 // domain-separation seed; set once at authoring time
 *   pronounBlocklistVersion: "v1"                      // must equal PRONOUN_BLOCKLIST_VERSION below (D9)
 *   packDigest: "sha256:<hex>"                         // always recomputed by this validator; hand edits rejected
 *   cases: [                                           // chain templates; >= 5 under strict defaults (Spec §3.2)
 *     id: "QB-LONG-<nn>"                               // /^QB-LONG-\d{2}$/, unique across cases
 *     version: <integer >= 1>
 *     lane: <non-empty string>
 *     configProfileId: <non-empty string>
 *     budgetClass: simple | complex | follow-up-join   // P1-78 §4.1.1 mapped values only; anything else rejected
 *     identity: read_only | lucy_admin | restricted_A | restricted_B
 *                                                      // role CLASS, never a concrete identity (Spec §3.2)
 *     connectionId: <non-empty string>
 *     turns: [                                         // >= 21 turns: first turn + >= 20 follow-ups (D3)
 *       turnIndex: <integer>                           // 0-based, === array position; gaps/dups rejected (D3)
 *       text: <non-empty string>                       // self-contained, single intent, no anaphora (D9);
 *                                                      // "single intent" is manual review only — not machine-checked
 *       dependsOnTurn: null | <integer>                // turn 0: empty; turn i > 0: === i-1 (D5, chained, acyclic)
 *       carriedContext: [<non-empty string>, ...]      // scope items explicitly restated this turn (D9);
 *                                                      // turn 0 lists the scope items it establishes
 *       oracle: {                                      // per-turn machine-checkable oracle (D4, P1-54 §3 style)
 *         kind: deny | exact | independent-query | invariant | privacy
 *         ref: <non-empty string>                      // pointer to independent fact / SQL / builder / deny contract
 *         expect: <non-empty value>                    // expected value or structure
 *         // at least one of ref / expect required; placeholders (同上 / 沿用上一轮 / ditto ...) rejected
 *       }
 *     ]
 *     evidence: [requestId, traceId, identityId, snapshotId, ...]
 *                                                      // per-turn evidence field names (Spec §3.2, P1-54 口径)
 *   ]
 *
 * packDigest algorithm (canonical and stable; do not change without a pack version bump):
 *   payload = {
 *     contract, version, packDigestSeed, cases,        // taken from the pack (cases keep array order)
 *     pronounBlocklistVersion: PRONOUN_BLOCKLIST_VERSION,   // validator-owned, NOT the pack-declared field
 *     pronounBlocklist: { terms: [...], patterns: [...] }   // D9: list content is hashed into every digest
 *   }
 *   canonical form: object keys sorted recursively (UTF-16 code-unit order, so field order in the
 *   YAML file is irrelevant); object entries whose value is null or undefined are dropped
 *   (missing ≡ explicit null); arrays keep order and length (undefined items normalize to null).
 *   digest = "sha256:" + sha256hex(JSON.stringify(canonical(payload))).
 *   The declared packDigest field itself is never part of the payload — validation always recomputes,
 *   so a hand-written digest cannot bypass content checks.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = path.resolve(HERE, "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "../..");

export const DEFAULT_PACK_PATH = path.join(E2E_ROOT, "contracts", "mcp-inquiry-long-followups.yaml");

export const CONTRACT_ID = "lucy-mcp-inquiry-long-followups-v1";
export const CHAIN_ID_PATTERN = /^QB-LONG-\d{2}$/;
export const MIN_CHAIN_TURNS = 21;
export const MIN_FOLLOWUP_TURNS = 20;
export const MIN_CHAINS = 5;

/** budgetClass domain (Spec §3.1); all values are mapped by P1-78 §4.1.1. */
export const BUDGET_CLASSES = Object.freeze(["simple", "complex", "follow-up-join"]);

/** Role classes a template may declare (Spec §3.2 / scale-baseline §1.1 groups). */
export const ROLE_CLASSES = Object.freeze(["read_only", "lucy_admin", "restricted_A", "restricted_B"]);

/** Evidence field names every chain must declare (Spec §3.2, aligned with P1-54). */
export const REQUIRED_EVIDENCE_FIELDS = Object.freeze(["requestId", "traceId", "identityId", "snapshotId"]);

/** Oracle kinds inherited from P1-54 §3. */
export const ORACLE_KINDS = Object.freeze(["deny", "exact", "independent-query", "invariant", "privacy"]);

/**
 * D9 anaphora blocklist, versioned by this validator (词表由校验器版本化).
 * Bump PRONOUN_BLOCKLIST_VERSION whenever terms/patterns change; the list content is
 * mixed into every packDigest, so an un-bumped edit still changes all digests.
 */
export const PRONOUN_BLOCKLIST_VERSION = "v1";
export const PRONOUN_BLOCKLIST_TERMS = Object.freeze([
  "这个",
  "那个",
  "这些",
  "那些",
  "它",
  "他们",
  "上次",
  "刚才",
  "上述",
  "同上",
  "沿用",
]);
/** Regex sources (not literals) so the blocklist stays JSON-serializable for the digest. */
export const PRONOUN_BLOCKLIST_PATTERNS = Object.freeze(["那[^。！？!?．.]*呢"]);

/** Placeholder strings that may never serve as a per-turn oracle (D4). */
export const ORACLE_PLACEHOLDER_TERMS = Object.freeze([
  "同上",
  "同上一轮",
  "沿用上一轮",
  "same as above",
  "ditto",
]);

export const PROBLEM_CODES = Object.freeze({
  PACK_SHAPE: "E_PACK_SHAPE",
  CONTRACT: "E_CONTRACT",
  CHAIN_COUNT: "E_CHAIN_COUNT",
  BUDGET_CLASS_COVERAGE: "E_BUDGET_CLASS_COVERAGE",
  ROLE_CLASS_COVERAGE: "E_ROLE_CLASS_COVERAGE",
  CHAIN_ID: "E_CHAIN_ID",
  CHAIN_FIELD: "E_CHAIN_FIELD",
  IDENTITY: "E_IDENTITY",
  CONNECTION: "E_CONNECTION",
  BUDGET_CLASS: "E_BUDGET_CLASS",
  EVIDENCE: "E_EVIDENCE",
  TURN_COUNT: "E_TURN_COUNT",
  TURN_SHAPE: "E_TURN_SHAPE",
  TURN_INDEX: "E_TURN_INDEX",
  TEXT_EMPTY: "E_TEXT_EMPTY",
  PRONOUN: "E_PRONOUN",
  DEPENDS_ON: "E_DEPENDS_ON",
  DEPENDS_CYCLE: "E_DEPENDS_CYCLE",
  CARRIED_CONTEXT: "E_CARRIED_CONTEXT",
  ORACLE_EMPTY: "E_ORACLE_EMPTY",
  ORACLE_SHAPE: "E_ORACLE_SHAPE",
  ORACLE_PLACEHOLDER: "E_ORACLE_PLACEHOLDER",
  BLOCKLIST_VERSION: "E_BLOCKLIST_VERSION",
  DIGEST: "E_DIGEST",
  CLI: "E_CLI",
  PACK_READ: "E_PACK_READ",
});

/**
 * Canonical form: recursive key sort; null/undefined object entries dropped
 * (missing ≡ explicit null); arrays keep order, undefined items → null.
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalize(item)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined && value[key] !== null)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value === undefined ? null : value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Canonical pack digest (see header for the fixed field order / null rules).
 * The optional blocklist override exists for tests and for future blocklist bumps;
 * production callers always use the validator-owned default.
 *
 * @param {object} pack
 * @param {{ version?: string, terms?: readonly string[], patterns?: readonly string[] }} [blocklist]
 * @returns {string} sha256:<hex>
 */
export function computePackDigest(pack, blocklist = {}) {
  const source = pack && typeof pack === "object" && !Array.isArray(pack) ? pack : {};
  const payload = {
    contract: source.contract ?? null,
    version: source.version ?? null,
    packDigestSeed: source.packDigestSeed ?? null,
    pronounBlocklistVersion: blocklist.version ?? PRONOUN_BLOCKLIST_VERSION,
    pronounBlocklist: {
      terms: [...(blocklist.terms ?? PRONOUN_BLOCKLIST_TERMS)],
      patterns: [...(blocklist.patterns ?? PRONOUN_BLOCKLIST_PATTERNS)],
    },
    cases: Array.isArray(source.cases) ? source.cases : [],
  };
  const hex = createHash("sha256").update(stableStringify(payload)).digest("hex");
  return `sha256:${hex}`;
}

/**
 * Anaphora hits in a question text (D9). Substring match for terms, regex for 「那…呢」.
 * @param {unknown} text
 * @returns {string[]}
 */
export function findPronounHits(text) {
  if (typeof text !== "string") return [];
  const hits = [];
  for (const term of PRONOUN_BLOCKLIST_TERMS) {
    if (text.includes(term)) hits.push(term);
  }
  for (const source of PRONOUN_BLOCKLIST_PATTERNS) {
    const match = text.match(new RegExp(source));
    if (match) hits.push(match[0]);
  }
  return [...new Set(hits)];
}

/**
 * @param {unknown} value
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

/**
 * Placeholder hits anywhere inside an oracle ("同上" / "沿用上一轮" are not per-turn oracles, D4).
 * @param {unknown} oracle
 * @returns {string[]}
 */
export function findOraclePlaceholderHits(oracle) {
  const hits = [];
  for (const text of collectStrings(oracle)) {
    const lower = text.toLowerCase();
    for (const term of ORACLE_PLACEHOLDER_TERMS) {
      if (lower.includes(term.toLowerCase())) hits.push(term);
    }
  }
  return [...new Set(hits)];
}

/**
 * @param {unknown} oracle
 * @returns {boolean}
 */
function oracleHasPayload(oracle) {
  const refOk = typeof oracle.ref === "string" && oracle.ref.trim().length > 0;
  const expectOk =
    oracle.expect !== undefined &&
    oracle.expect !== null &&
    !(typeof oracle.expect === "object" && Object.keys(oracle.expect).length === 0);
  return refOk || expectOk;
}

/**
 * @param {unknown[]} turns
 * @returns {boolean}
 */
function hasDependencyCycle(turns) {
  const deps = turns.map((turn) =>
    turn && Number.isInteger(turn.dependsOnTurn) ? turn.dependsOnTurn : null,
  );
  for (let start = 0; start < deps.length; start++) {
    const seen = new Set();
    let current = start;
    while (current !== null && current >= 0 && current < deps.length) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = deps[current];
    }
  }
  return false;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isVersionValue(value) {
  return (Number.isInteger(value) && value >= 1) || (typeof value === "string" && value.trim().length > 0);
}

/**
 * @param {object} oracle
 * @param {string} where
 * @param {(code: string, where: string, detail: string) => void} push
 */
function validateOracle(oracle, where, push) {
  const C = PROBLEM_CODES;
  if (oracle === null || oracle === undefined) {
    push(C.ORACLE_EMPTY, where, "oracle missing");
    return;
  }
  if (typeof oracle === "string") {
    push(C.ORACLE_SHAPE, where, "oracle must be an object { kind, ref/expect }, not a bare string");
    const hits = findOraclePlaceholderHits(oracle);
    if (hits.length > 0) push(C.ORACLE_PLACEHOLDER, where, `placeholder oracle: ${hits.join(", ")}`);
    return;
  }
  if (typeof oracle !== "object" || Array.isArray(oracle)) {
    push(C.ORACLE_SHAPE, where, "oracle must be an object { kind, ref/expect }");
    return;
  }
  if (Object.keys(oracle).length === 0) {
    push(C.ORACLE_EMPTY, where, "oracle is an empty object");
    return;
  }
  if (!ORACLE_KINDS.includes(oracle.kind)) {
    push(C.ORACLE_SHAPE, where, `oracle.kind must be one of ${ORACLE_KINDS.join("/")}, got ${JSON.stringify(oracle.kind ?? null)}`);
  }
  if (!oracleHasPayload(oracle)) {
    push(C.ORACLE_EMPTY, where, "oracle needs a machine-checkable payload (non-empty ref and/or expect)");
  }
  const hits = findOraclePlaceholderHits(oracle);
  if (hits.length > 0) {
    push(C.ORACLE_PLACEHOLDER, where, `placeholder oracle: ${hits.join(", ")} (同上/沿用上一轮 are not per-turn oracles)`);
  }
}

/**
 * @param {object} turn
 * @param {number} index
 * @param {string} chainWhere
 * @param {(code: string, where: string, detail: string) => void} push
 */
function validateTurn(turn, index, chainWhere, push) {
  const C = PROBLEM_CODES;
  const where = `${chainWhere}.turns[${index}]`;
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    push(C.TURN_SHAPE, where, "turn is not an object");
    return;
  }
  if (!Number.isInteger(turn.turnIndex)) {
    push(C.TURN_INDEX, where, `turnIndex missing or not an integer, got ${JSON.stringify(turn.turnIndex ?? null)}`);
  } else if (turn.turnIndex !== index) {
    push(C.TURN_INDEX, where, `turnIndex ${turn.turnIndex} != position ${index} (0-based per Spec D3; gaps/duplicates rejected)`);
  }
  if (typeof turn.text !== "string" || turn.text.trim().length === 0) {
    push(C.TEXT_EMPTY, where, "text missing or empty");
  } else {
    const hits = findPronounHits(turn.text);
    if (hits.length > 0) {
      push(C.PRONOUN, where, `anaphora in text (D9): ${hits.join(", ")}`);
    }
  }
  if (index === 0) {
    if (turn.dependsOnTurn !== null && turn.dependsOnTurn !== undefined) {
      push(C.DEPENDS_ON, where, `first turn dependsOnTurn must be empty, got ${JSON.stringify(turn.dependsOnTurn)}`);
    }
  } else if (!Number.isInteger(turn.dependsOnTurn) || turn.dependsOnTurn !== index - 1) {
    push(C.DEPENDS_ON, where, `dependsOnTurn must reference the previous turn (${index - 1}), got ${JSON.stringify(turn.dependsOnTurn ?? null)}`);
  }
  if (
    !Array.isArray(turn.carriedContext) ||
    turn.carriedContext.length === 0 ||
    turn.carriedContext.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    push(C.CARRIED_CONTEXT, where, "carriedContext must be a non-empty list of restated scope items (D9)");
  }
  validateOracle(turn.oracle, where, push);
}

/**
 * @param {object} chain
 * @param {number} index
 * @param {Set<string>} seenIds
 * @param {(code: string, where: string, detail: string) => void} push
 */
function validateChain(chain, index, seenIds, push) {
  const C = PROBLEM_CODES;
  const where = typeof chain?.id === "string" && chain.id ? chain.id : `cases[${index}]`;
  if (!chain || typeof chain !== "object" || Array.isArray(chain)) {
    push(C.CHAIN_FIELD, where, "chain template is not an object");
    return;
  }
  if (typeof chain.id !== "string" || !CHAIN_ID_PATTERN.test(chain.id)) {
    push(C.CHAIN_ID, where, `id must match ${CHAIN_ID_PATTERN}, got ${JSON.stringify(chain.id ?? null)}`);
  } else if (seenIds.has(chain.id)) {
    push(C.CHAIN_ID, where, `duplicate chain id ${chain.id}`);
  } else {
    seenIds.add(chain.id);
  }
  if (!Number.isInteger(chain.version) || chain.version < 1) {
    push(C.CHAIN_FIELD, where, `version must be an integer >= 1, got ${JSON.stringify(chain.version ?? null)}`);
  }
  if (typeof chain.lane !== "string" || chain.lane.trim().length === 0) {
    push(C.CHAIN_FIELD, where, "lane missing or empty");
  }
  if (typeof chain.configProfileId !== "string" || chain.configProfileId.trim().length === 0) {
    push(C.CHAIN_FIELD, where, "configProfileId missing or empty");
  }
  if (!BUDGET_CLASSES.includes(chain.budgetClass)) {
    push(C.BUDGET_CLASS, where, `budgetClass must be one of ${BUDGET_CLASSES.join("/")}, got ${JSON.stringify(chain.budgetClass ?? null)}`);
  }
  if (!ROLE_CLASSES.includes(chain.identity)) {
    push(C.IDENTITY, where, `identity must declare a role class (${ROLE_CLASSES.join("/")}), got ${JSON.stringify(chain.identity ?? null)}`);
  }
  if (typeof chain.connectionId !== "string" || chain.connectionId.trim().length === 0) {
    push(C.CONNECTION, where, "connectionId missing or empty");
  }
  if (
    !Array.isArray(chain.evidence) ||
    chain.evidence.length === 0 ||
    chain.evidence.some((field) => typeof field !== "string" || field.trim().length === 0)
  ) {
    push(C.EVIDENCE, where, "evidence must be a non-empty list of field names");
  } else {
    for (const field of REQUIRED_EVIDENCE_FIELDS) {
      if (!chain.evidence.includes(field)) {
        push(C.EVIDENCE, where, `evidence missing required field "${field}"`);
      }
    }
  }
  const turns = Array.isArray(chain.turns) ? chain.turns : null;
  if (!turns) {
    push(C.TURN_COUNT, where, "turns missing or not an array");
    return;
  }
  if (turns.length < MIN_CHAIN_TURNS) {
    push(C.TURN_COUNT, where, `${turns.length} turns, need >= ${MIN_CHAIN_TURNS} (first turn + >= ${MIN_FOLLOWUP_TURNS} follow-ups)`);
  }
  if (hasDependencyCycle(turns)) {
    push(C.DEPENDS_CYCLE, where, "dependsOnTurn chain contains a cycle");
  }
  turns.forEach((turn, turnIndex) => validateTurn(turn, turnIndex, where, push));
}

/**
 * Validate a long-followup question pack (Spec §3.3). Pure: no network, no credentials, no writes.
 *
 * Options exist so unit tests can exercise chain-level rules on a single-chain fixture;
 * the CLI and the P1-78 consumer always validate with the strict spec defaults.
 *
 * @param {object} pack parsed pack (YAML object)
 * @param {{ minChains?: number, requiredBudgetClasses?: readonly string[], requiredRoleClasses?: readonly string[] }} [options]
 * @returns {{ ok: boolean, digest: string|null, problems: string[] }}
 */
export function validateQuestionPack(pack, options = {}) {
  const C = PROBLEM_CODES;
  const minChains = options.minChains ?? MIN_CHAINS;
  const requiredBudgetClasses = options.requiredBudgetClasses ?? BUDGET_CLASSES;
  const requiredRoleClasses = options.requiredRoleClasses ?? ROLE_CLASSES;
  const problems = [];
  const push = (code, where, detail) => problems.push(`${code} ${where}: ${detail}`);

  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return { ok: false, digest: null, problems: [`${C.PACK_SHAPE} pack: not an object`] };
  }

  if (pack.contract !== CONTRACT_ID) {
    push(C.CONTRACT, "pack", `contract must be "${CONTRACT_ID}", got ${JSON.stringify(pack.contract ?? null)}`);
  }
  if (!isVersionValue(pack.version)) {
    push(C.PACK_SHAPE, "pack.version", "missing or invalid (positive integer or non-empty string)");
  }
  if (typeof pack.packDigestSeed !== "string" || pack.packDigestSeed.trim().length === 0) {
    push(C.PACK_SHAPE, "pack.packDigestSeed", "missing or empty");
  }
  if (pack.pronounBlocklistVersion !== PRONOUN_BLOCKLIST_VERSION) {
    push(
      C.BLOCKLIST_VERSION,
      "pack.pronounBlocklistVersion",
      `must be "${PRONOUN_BLOCKLIST_VERSION}" (validator blocklist version), got ${JSON.stringify(pack.pronounBlocklistVersion ?? null)}`,
    );
  }

  const cases = Array.isArray(pack.cases) ? pack.cases : null;
  if (!cases || cases.length === 0) {
    push(C.PACK_SHAPE, "pack.cases", "missing or empty chain template list");
  } else {
    if (cases.length < minChains) {
      push(C.CHAIN_COUNT, "pack.cases", `${cases.length} chain templates, need >= ${minChains}`);
    }
    const budgetSeen = new Set(cases.map((c) => c?.budgetClass).filter((v) => typeof v === "string"));
    for (const required of requiredBudgetClasses) {
      if (!budgetSeen.has(required)) {
        push(C.BUDGET_CLASS_COVERAGE, "pack.cases", `no chain template with budgetClass "${required}"`);
      }
    }
    const roleSeen = new Set(cases.map((c) => c?.identity).filter((v) => typeof v === "string"));
    for (const required of requiredRoleClasses) {
      if (!roleSeen.has(required)) {
        push(C.ROLE_CLASS_COVERAGE, "pack.cases", `no chain template with identity role class "${required}"`);
      }
    }
    const seenIds = new Set();
    cases.forEach((chain, index) => validateChain(chain, index, seenIds, push));
  }

  // packDigest is always recomputed from content; a declared digest can never bypass this.
  const digest = computePackDigest(pack);
  if (typeof pack.packDigest !== "string" || pack.packDigest.trim().length === 0) {
    push(C.DIGEST, "pack.packDigest", "missing");
  } else if (pack.packDigest !== digest) {
    push(C.DIGEST, "pack.packDigest", `declared ${pack.packDigest} != recomputed ${digest}`);
  }

  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, digest, problems: unique };
}

/**
 * Load a question pack from a filesystem path or an already-parsed object.
 * @param {string|object} source
 */
export function loadQuestionPack(source = DEFAULT_PACK_PATH) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return structuredClone(source);
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("loadQuestionPack requires a file path or pack object");
  }
  const file = path.isAbsolute(source) ? source : path.resolve(REPO_ROOT, source);
  if (!existsSync(file)) {
    throw new Error(`question pack not found: ${file}`);
  }
  const doc = parse(readFileSync(file, "utf8"));
  if (!doc || typeof doc !== "object") {
    throw new Error(`question pack is empty or invalid YAML: ${file}`);
  }
  return doc;
}

/**
 * CLI: node scripts/e2e/lib/mcp-inquiry-question-pack.mjs --pack <path> --validate
 * Exit 0: prints packDigest, chain count, per-chain turn counts.
 * Exit 1: validation failed, one problem code per line on stderr.
 * Exit 2: usage / read errors.
 *
 * @param {string[]} argv
 * @param {{ stdout?: (line: string) => void, stderr?: (line: string) => void }} [io]
 * @returns {number} exit code
 */
export function runCli(argv, io = {}) {
  const out = io.stdout ?? ((line) => console.log(line));
  const err = io.stderr ?? ((line) => console.error(line));
  let packPath = null;
  let validate = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pack") {
      packPath = argv[++i] ?? null;
    } else if (arg === "--validate") {
      validate = true;
    } else {
      err(`${PROBLEM_CODES.CLI} unknown argument: ${arg}`);
      return 2;
    }
  }
  if (!packPath || !validate) {
    err(`${PROBLEM_CODES.CLI} usage: node scripts/e2e/lib/mcp-inquiry-question-pack.mjs --pack <path> --validate`);
    return 2;
  }
  let pack;
  try {
    pack = loadQuestionPack(packPath);
  } catch (error) {
    err(`${PROBLEM_CODES.PACK_READ} ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const result = validateQuestionPack(pack);
  if (!result.ok) {
    for (const problem of result.problems) err(problem);
    return 1;
  }
  out(`packDigest: ${result.digest}`);
  out(`chains: ${pack.cases.length}`);
  for (const chain of pack.cases) {
    out(`chain ${chain.id}: ${chain.turns.length} turns`);
  }
  return 0;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  process.exit(runCli(process.argv.slice(2)));
}
