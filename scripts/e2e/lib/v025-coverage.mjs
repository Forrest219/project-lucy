// v0.25 coverage manifest loader / validator (Plan W0-2).
//
// Loads scripts/e2e/contracts/v025-coverage.yaml and proves it is a faithful
// projection of its three authorities:
//   * the frozen release catalog (scripts/e2e/contracts/case-catalog.yaml + lock)
//     -> 255 existing variants, one owner each;
//   * the P0/P1 source Specs -> 160 requirement ids, no omission / no fabrication;
//   * the approved design Spec §6.1 / §4.2 / §7.4 -> owner table, stage table,
//     and the CON25 / LOG25 increment scenarios.
//
// The manifest never becomes a second source of truth: existing variants carry
// `ownerBranch` (+ the requirement attribution + cross-domain refs); their
// executors / requires / assert / artifacts / gold stay in the frozen catalog.
// Run status never lives here — it lives in the result file (v025-result.mjs).
//
// Schema validation reuses scripts/e2e/lib/schema.mjs `validateAgainstSchema()`
// and the frozen-catalog check reuses catalog.mjs `checkLock()`; neither is
// re-implemented here.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { ASSERTION_TOKENS, CAPABILITIES, EXECUTOR_LETTERS, checkLock, loadCatalog, readLock } from "./catalog.mjs";
import { REPO_ROOT } from "./common.mjs";
import { validateAgainstSchema } from "./schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const V025_COVERAGE_PATH = path.join(HERE, "..", "contracts", "v025-coverage.yaml");
export const V025_COVERAGE_SCHEMA_PATH = path.join(HERE, "..", "contracts", "v025-coverage.schema.json");
export const V025_LEGACY_MAP_PATH = path.join(HERE, "..", "contracts", "v025-legacy-map.yaml");

export const OWNER_BRANCHES = Object.freeze(["CONN", "SEM", "ACCESS", "OBSERVE", "AGENT", "LIFECYCLE"]);
export const JOURNEY_ID = "J25-01";
export const STAGE_IDS = Object.freeze([
  "J01-01", "J01-02", "J01-03", "J01-04", "J01-05", "J01-06", "J01-07", "J01-08"
]);
export const JOURNEY_CATALOG_EVIDENCE = Object.freeze(["UX-01-V01", "UX-01-V02", "UX-01-V03"]);

/**
 * The only three scenarios whose variants split below scenario level
 * (approved Spec §6.1 "variant 级规则"). Each row is anchored to a verbatim
 * substring of that scenario's rule cell, so a Spec change breaks the test
 * instead of silently drifting.
 */
export const VARIANT_OWNER_EXCEPTIONS = Object.freeze([
  { executionId: "SEC-20-V05", ownerBranch: "LIFECYCLE", specRef: "V05 备份恢复归 LIFECYCLE" },
  { executionId: "UX-06-V04", ownerBranch: "ACCESS", specRef: "V04–V07" },
  { executionId: "UX-06-V05", ownerBranch: "ACCESS", specRef: "V04–V07" },
  { executionId: "UX-06-V06", ownerBranch: "ACCESS", specRef: "V04–V07" },
  { executionId: "UX-06-V07", ownerBranch: "ACCESS", specRef: "V04–V07" },
  { executionId: "UX-07-V01", ownerBranch: "ACCESS", specRef: "V01、V03、V04 归 ACCESS" },
  { executionId: "UX-07-V03", ownerBranch: "ACCESS", specRef: "V01、V03、V04 归 ACCESS" },
  { executionId: "UX-07-V04", ownerBranch: "ACCESS", specRef: "V01、V03、V04 归 ACCESS" }
]);

/**
 * The 11 approved P0/P1 requirement groups (Spec §7.2 / §7.3).
 * `strip` reproduces the approved executionId form verbatim: the approved table
 * keeps the whole source id for AUD25/ROW25/SEM25/ARV25/ACM25/HIV25 and drops
 * the source letter prefix for RTP25/RTV25/ASV25/UPG25/RVC25.
 */
export const SOURCE_GROUPS = Object.freeze([
  { key: "AUD25", file: "docs/specs/lucy-20261020-v2p5-audit-increment-spec.md", pattern: /^A\d{2}$/, count: 12, ownerBranch: "OBSERVE", strip: "" },
  { key: "ROW25", file: "docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md", pattern: /^V\d{2}$/, count: 22, ownerBranch: "ACCESS", strip: "" },
  { key: "SEM25", file: "docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md", pattern: /^V\d{2}$/, count: 22, ownerBranch: "SEM", strip: "" },
  { key: "ARV25", file: "docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md", pattern: /^V\d{2}$/, count: 12, ownerBranch: "OBSERVE", strip: "" },
  { key: "RTP25", file: "docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md", pattern: /^RTP-\d{2}$/, count: 10, ownerBranch: "ACCESS", strip: "RTP-" },
  { key: "RTV25", file: "docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md", pattern: /^RTV-\d{2}$/, count: 8, ownerBranch: "ACCESS", strip: "RTV-" },
  { key: "ASV25", file: "docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md", pattern: /^ASV-\d{2}$/, count: 14, ownerBranch: "ACCESS", strip: "ASV-" },
  { key: "ACM25", file: "webui/docs/187-access-relation-sankey-spec.md", pattern: /^SC-\d{2}$/, count: 14, ownerBranch: "OBSERVE", strip: "" },
  { key: "HIV25", file: "docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md", pattern: /^V\d{2}$/, count: 17, ownerBranch: "CONN", strip: "" },
  { key: "UPG25", file: "docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md", pattern: /^UPG-\d{2}$/, count: 16, ownerBranch: "LIFECYCLE", strip: "UPG-" },
  { key: "RVC25", file: "docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md", pattern: /^RVC-\d{2}$/, count: 13, ownerBranch: "LIFECYCLE", strip: "RVC-" }
]);

/** The approved executionId for a group's source requirement id. */
export function executionIdFor(group, requirementId) {
  const tail = group.strip && requirementId.startsWith(group.strip)
    ? requirementId.slice(group.strip.length)
    : requirementId;
  return `${group.key}-${tail}`;
}

export const CON25_IDS = Object.freeze([
  "CON25-01", "CON25-02", "CON25-03", "CON25-04", "CON25-05", "CON25-06",
  "CON25-07", "CON25-08", "CON25-09", "CON25-10", "CON25-11", "CON25-12"
]);
export const LOG25_IDS = Object.freeze(["LOG25-01"]);

/** Fields a frozen variant mapping must NOT carry — they stay in the catalog. */
const CATALOG_OWNED_FIELDS = Object.freeze(["executors", "requires", "assert", "artifacts", "gold", "runner", "status"]);

function readText(relPath) {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

/** Loads the coverage manifest. */
export function loadCoverage(file = V025_COVERAGE_PATH) {
  const doc = parse(readFileSync(file, "utf8"));
  return {
    doc,
    file,
    existing: doc.existingCatalogMappings ?? [],
    newScenarios: doc.newScenarios ?? [],
    journeys: doc.journeys ?? []
  };
}

/**
 * Parses the approved Spec §6.1 frozen-scenario responsibility table.
 * Returns Map<scenarioId, { title, owner, rule }>.
 */
export function parseSpecScenarioOwners(specText) {
  const section = specText.split("### 6.1")[1]?.split("### 6.2")[0] ?? "";
  const out = new Map();
  // AUD25／ARV25 于 2026-10-28（D2 路径 A）并入冻结 catalog，因而也进入本表的
  // 场景责任表 —— 它们是 release 门禁的一部分，必须有明确 owner，否则
  // 「owner 一致性」校验会静默跳过它们。
  // 注意：这两个场景 id **没有**数字后缀（场景名即 AUD25／ARV25），
  // 而变体 id 才是 AUD25-A01／ARV25-V01。
  for (const m of section.matchAll(
    /^\|\s*((?:SEC|UX|OPS|GATE)-\d+|AUD25|ARV25)\s*\|([^|]*)\|\s*([A-Z]+)\s*\|([^|]*)\|/gm
  )) {
    out.set(m[1], { title: m[2].trim(), owner: m[3].trim(), rule: m[4].trim() });
  }
  return out;
}

/** Parses the approved Spec §4.2 stage table -> stageId list. */
export function parseSpecStageIds(specText) {
  const section = specText.split("### 4.2")[1]?.split("### 4.3")[0] ?? "";
  // the stage id and its title share the first table cell
  return [...section.matchAll(/^\|\s*(J01-\d{2})(?![0-9])/gm)].map((m) => m[1]);
}

/** Parses the approved Spec §7.4 increment table -> executionIds. */
export function parseSpecIncrementIds(specText) {
  const section = specText.split("### 7.4")[1]?.split("### 7.5")[0] ?? "";
  return [...section.matchAll(/^\|\s*`((?:CON|LOG)25-\d{2})`/gm)].map((m) => m[1]);
}

/** Extracts a group's requirement ids from its source Spec's acceptance table. */
export function extractSourceRequirementIds(text, pattern) {
  const raw = [...text.matchAll(/^\|\s*([A-Z0-9]+-\d{2}|[A-Z]\d{2})(?![0-9-])/gm)].map((m) => m[1]);
  return [...new Set(raw)].filter((id) => pattern.test(id)).sort();
}

/** The 160 approved P0/P1 requirement ids, read live from the source Specs. */
export function sourceRequirementBaseline() {
  const byGroup = new Map();
  for (const g of SOURCE_GROUPS) {
    const ids = extractSourceRequirementIds(readText(g.file), g.pattern);
    byGroup.set(g.key, ids);
  }
  return byGroup;
}

function setDiff(a, b) {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

/**
 * Validates the coverage manifest against all three authorities.
 * Returns a list of human-readable problems; empty means valid.
 */
export function validateCoverage(loaded, options = {}) {
  const { doc, existing, newScenarios, journeys } = loaded;
  const problems = [];
  const specText = options.specText ?? readText(doc.spec);
  const catalogCases = options.catalogCases ?? loadCatalog().cases;
  const lock = options.lock ?? readLock();

  // 1. schema
  const schema = JSON.parse(readFileSync(V025_COVERAGE_SCHEMA_PATH, "utf8"));
  problems.push(...validateAgainstSchema(schema, doc));

  // 2. the frozen release directory must be untouched
  problems.push(...checkLock(catalogCases, lock).map((p) => `frozen catalog: ${p}`));

  // 3. existing mappings cover the frozen required ids exactly
  const required = new Set(lock.requiredIds);
  const existingIds = existing.map((m) => m.executionId);
  for (const id of setDiff([...required], existingIds)) problems.push(`existingCatalogMappings missing ${id}`);
  for (const id of setDiff(existingIds, [...required])) problems.push(`existingCatalogMappings has non-frozen id ${id}`);
  if (existingIds.length !== required.size) {
    problems.push(`existingCatalogMappings count ${existingIds.length} != locked ${required.size}`);
  }

  // 4. owner table agreement with the approved Spec §6.1
  const owners = parseSpecScenarioOwners(specText);
  // 2026-10-28（D2 路径 A）：AUD25／ARV25 并入冻结 catalog 后也进入本表，
  // 场景行数由 32 增至 34。
  const expectedOwnerRows = 34;
  if (owners.size !== expectedOwnerRows) problems.push(`Spec §6.1 scenario rows ${owners.size} != ${expectedOwnerRows}`);
  const exceptionById = new Map(VARIANT_OWNER_EXCEPTIONS.map((e) => [e.executionId, e]));
  const byId = new Map(existing.map((m) => [m.executionId, m]));
  for (const [scenarioId, info] of owners) {
    for (const c of catalogCases.filter((c) => c.scenario === scenarioId)) {
      const m = byId.get(c.id);
      if (!m) continue;
      const exception = exceptionById.get(c.id);
      const expected = exception ? exception.ownerBranch : info.owner;
      if (m.ownerBranch !== expected) {
        problems.push(`${c.id} owner ${m.ownerBranch} != Spec §6.1 expected ${expected}`);
      }
    }
  }
  // every declared exception must be anchored in the Spec rule cell
  for (const e of VARIANT_OWNER_EXCEPTIONS) {
    const scenarioId = e.executionId.replace(/-[A-Z0-9]+$/, "");
    const rule = owners.get(scenarioId)?.rule ?? "";
    if (!rule.includes(e.specRef)) {
      problems.push(`exception ${e.executionId} specRef "${e.specRef}" not found in Spec §6.1 rule cell for ${scenarioId}`);
    }
  }
  // no undeclared variant-level split may exist
  for (const m of existing) {
    const scenarioId = m.executionId.replace(/-[A-Z0-9]+$/, "");
    const info = owners.get(scenarioId);
    if (!info) continue;
    if (m.ownerBranch !== info.owner && !exceptionById.has(m.executionId)) {
      problems.push(`${m.executionId} splits from scenario owner ${info.owner} without a declared exception`);
    }
  }
  // existing mappings must not re-declare catalog-owned fields (F-08)
  for (const m of existing) {
    for (const f of CATALOG_OWNED_FIELDS) {
      if (f in m) problems.push(`existingCatalogMappings ${m.executionId} re-declares catalog-owned field ${f}`);
    }
  }
  for (const m of existing) {
    for (const ref of m.crossDomainRefs ?? []) {
      if (!OWNER_BRANCHES.includes(ref)) problems.push(`${m.executionId} crossDomainRefs has unknown branch ${ref}`);
    }
  }

  // 5. new scenarios: 160 source requirements, no omission / no fabrication
  const baseline = sourceRequirementBaseline();
  const expectedIds = new Set();
  for (const [key, ids] of baseline) {
    const group = SOURCE_GROUPS.find((g) => g.key === key);
    if (ids.length !== group.count) {
      problems.push(`${key} source spec yields ${ids.length} ids, expected ${group.count}`);
    }
    for (const id of ids) expectedIds.add(executionIdFor(group, id));
  }
  const withSource = newScenarios.filter((s) => s.sourceRequirementId !== null && s.sourceRequirementId !== undefined);
  const actualIds = new Set(withSource.map((s) => s.executionId));
  // 2026-10-28（D2 路径 A）：AUD25-A01..A12 与 ARV25-V01..V12 已**并入冻结
  // catalog**，因此它们在覆盖清单里从 newScenarios 移到 existingCatalogMappings
  // （existing 必须恰好等于 lock.requiredIds，两者不可重叠）。
  //
  // 它们的 source requirement 覆盖**没有丢失**：那 24 个 requirement id 现在由
  // 冻结 catalog 承载（catalog 是 executors/requires/assert/artifacts/gold 的
  // 唯一真源，且已进入 evidence.cases 与 passedIds）。所以下面的覆盖检查必须
  // 把「已并入冻结 catalog 的执行项」也计入已覆盖集合，否则会把一次**加强**
  // （从影子清单提升为冻结门禁）误报成「遗漏」。
  const frozenIds = new Set(lock.requiredIds);
  const coveredIds = new Set([
    ...actualIds,
    ...[...expectedIds].filter((id) => frozenIds.has(id))
  ]);
  for (const id of setDiff([...expectedIds], [...coveredIds])) problems.push(`newScenarios missing ${id}`);
  for (const id of setDiff([...actualIds], [...expectedIds])) problems.push(`newScenarios has unapproved id ${id}`);
  for (const s of withSource) {
    const group = SOURCE_GROUPS.find((g) => s.executionId.startsWith(`${g.key}-`));
    if (!group) { problems.push(`${s.executionId} has no matching approved group prefix`); continue; }
    if (s.ownerBranch !== group.ownerBranch) {
      problems.push(`${s.executionId} owner ${s.ownerBranch} != approved ${group.ownerBranch}`);
    }
    if (s.sourceSpec !== group.file) {
      problems.push(`${s.executionId} sourceSpec ${s.sourceSpec} != ${group.file}`);
    }
    // the approved executionId form is exact — it is not uniform across groups
    const approvedId = executionIdFor(group, s.sourceRequirementId);
    if (s.executionId !== approvedId) {
      problems.push(`${s.executionId} does not match the approved form ${approvedId}`);
    }
  }

  // 6. increment scenarios (Spec §7.4)
  const specIncrements = parseSpecIncrementIds(specText);
  const actualIncrements = newScenarios
    .filter((s) => /^(CON|LOG)25-/.test(s.executionId))
    .map((s) => s.executionId);
  for (const id of setDiff(specIncrements, actualIncrements)) problems.push(`newScenarios missing increment ${id}`);
  for (const id of setDiff(actualIncrements, specIncrements)) problems.push(`newScenarios has unapproved increment ${id}`);

  // 7. vocabulary reuse
  for (const s of newScenarios) {
    for (const e of s.executors ?? []) if (!EXECUTOR_LETTERS.includes(e)) problems.push(`${s.executionId} unknown executor ${e}`);
    for (const r of s.requires ?? []) if (!CAPABILITIES.includes(r)) problems.push(`${s.executionId} unknown capability ${r}`);
    for (const a of s.assert ?? []) if (!ASSERTION_TOKENS.includes(a)) problems.push(`${s.executionId} unknown assertion token ${a}`);
    if (!Array.isArray(s.artifacts) || s.artifacts.length === 0) problems.push(`${s.executionId} artifacts missing`);
    const needsGold = (s.assert ?? []).includes("typed_gold");
    if (needsGold && s.gold !== null && typeof s.gold !== "string") problems.push(`${s.executionId} gold must be a key or null`);
    if (!needsGold && s.gold !== null) problems.push(`${s.executionId} binds a gold key but does not assert typed_gold`);
  }

  // 8. global uniqueness
  const allIds = [...existingIds, ...newScenarios.map((s) => s.executionId)];
  const seen = new Set();
  for (const id of allIds) {
    if (seen.has(id)) problems.push(`duplicate executionId ${id}`);
    seen.add(id);
  }

  // 9. journeys: exactly one, eight stages, three catalog evidence ids
  if (journeys.length !== 1) problems.push(`journeys count ${journeys.length} != 1`);
  for (const j of journeys) {
    if (j.journeyId !== JOURNEY_ID) problems.push(`journeyId ${j.journeyId} != ${JOURNEY_ID}`);
    const stageIds = (j.stages ?? []).map((s) => s.stageId);
    if (stageIds.length !== STAGE_IDS.length) problems.push(`journey ${j.journeyId} has ${stageIds.length} stages`);
    for (const id of STAGE_IDS) if (!stageIds.includes(id)) problems.push(`journey ${j.journeyId} missing stage ${id}`);
    const specStages = parseSpecStageIds(specText);
    if (specStages.length !== STAGE_IDS.length) problems.push(`Spec §4.2 stage rows ${specStages.length} != 8`);
    for (const id of specStages) if (!stageIds.includes(id)) problems.push(`journey ${j.journeyId} stage set differs from Spec §4.2 (${id})`);
    const evidence = j.catalogEvidenceIds ?? [];
    if (evidence.join(",") !== JOURNEY_CATALOG_EVIDENCE.join(",")) {
      problems.push(`journey ${j.journeyId} catalogEvidenceIds ${evidence.join(",")} != ${JOURNEY_CATALOG_EVIDENCE.join(",")}`);
    }
    for (const id of evidence) if (!byId.has(id)) problems.push(`journey ${j.journeyId} evidence id ${id} not in existingCatalogMappings`);
  }

  return problems;
}

/** Aggregate counters for reports; never implies any run status. */
export function coverageSummary(loaded) {
  const { existing, newScenarios, journeys } = loaded;
  const byOwner = {};
  for (const m of existing) byOwner[m.ownerBranch] = (byOwner[m.ownerBranch] ?? 0) + 1;
  for (const s of newScenarios) byOwner[s.ownerBranch] = (byOwner[s.ownerBranch] ?? 0) + 1;
  return {
    existingCount: existing.length,
    newScenarioCount: newScenarios.length,
    journeyCount: journeys.length,
    withSourceRequirement: newScenarios.filter((s) => s.sourceRequirementId !== null && s.sourceRequirementId !== undefined).length,
    byOwner
  };
}
