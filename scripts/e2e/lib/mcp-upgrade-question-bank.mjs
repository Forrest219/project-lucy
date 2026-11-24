/**
 * P1-54 question-bank contract validation + oracle/deny evidence helpers.
 *
 * Authority: docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md (D3/D7a/D10)
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-question-bank-plan.md step 4
 *
 * Pure / filesystem-local only. Does not run Agents or apply live Lucy config
 * (apply/restore lives in mcp-compat-config-profile.mjs; judge in mcp-compatibility.mjs).
 */

import {
  FORBIDDEN_ADMIN_ROLE_ID,
  FROZEN_W0_ROLE_ID,
  PRODUCT_OPS_READER_ROLE_ID,
  computeConfigProfileFingerprint,
} from "./mcp-compat-config-profile.mjs";
import {
  aggregateCompatibility,
  validateJourneySuite,
} from "./mcp-compatibility.mjs";

export const COMPAT_02_REQUIRED_CASE_IDS = Object.freeze([
  "QB-BIZ-02a",
  "QB-BIZ-02b",
  "QB-BIZ-02c",
  "QB-BIZ-02d",
]);

export const DEFAULT_FORBIDDEN_REGION_LABELS = Object.freeze([
  "华东",
  "西南",
  "华北",
  "西北",
  "华南",
]);

/** Allowed W1/W2 gov window knobs (Spec D10). */
export const GOV_WINDOW_KNOB_FIELDS = Object.freeze([
  "gov.calendar_days",
  "gov.window_hours",
]);

/**
 * @param {unknown} filter
 * @returns {string|null}
 */
export function filterFieldName(filter) {
  if (typeof filter === "string") return filter;
  if (filter && typeof filter === "object" && typeof filter.field === "string") {
    return filter.field;
  }
  return null;
}

/**
 * @param {unknown[]} filters
 * @returns {boolean}
 */
export function filtersContainGovStar(filters) {
  return (filters || []).some((f) => {
    const field = filterFieldName(f);
    return typeof field === "string" && field.startsWith("gov.");
  });
}

/**
 * @param {unknown[]} filters
 * @returns {boolean}
 */
export function filtersContainGovWindowKnob(filters) {
  return (filters || []).some((f) => {
    const field = filterFieldName(f);
    if (!field || !field.startsWith("gov.")) return false;
    if (GOV_WINDOW_KNOB_FIELDS.includes(field)) return true;
    // Explicit ISO half-open window fields (start/end) also count per Spec D10.
    return /window|calendar|start|end/i.test(field);
  });
}

/**
 * Collect filters from a mcpControls query, including dual-step queries.
 * @param {object|null|undefined} query
 * @returns {unknown[]}
 */
export function collectQueryFilters(query) {
  if (!query || typeof query !== "object") return [];
  const out = [];
  if (Array.isArray(query.filters)) out.push(...query.filters);
  if (Array.isArray(query.steps)) {
    for (const step of query.steps) {
      if (Array.isArray(step?.filters)) out.push(...step.filters);
    }
  }
  return out;
}

/**
 * Collect Chinese region labels forbidden in fixtures (Spec regionVocabulary).
 * @param {object} suite
 * @returns {string[]}
 */
export function findForbiddenRegionLabelsInSuite(suite) {
  const forbidden = new Set([
    ...(suite?.forbiddenRegionVocabulary || DEFAULT_FORBIDDEN_REGION_LABELS),
  ]);
  const hits = [];
  const visit = (value, path) => {
    if (typeof value === "string") {
      for (const label of forbidden) {
        if (value.includes(label)) hits.push(`${path}=${label}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        // Allow declaring the forbid list itself.
        if (k === "forbiddenRegionVocabulary" || k === "forbidRegionVocabulary") continue;
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };
  visit(suite, "");
  return hits;
}

/**
 * Static contract validation for the question bank (mutated copies welcome).
 *
 * @param {object} suite
 * @param {{ profile?: object, configProfileFingerprint?: string|null }} [options]
 * @returns {{ ok: boolean, status: "PASS"|"FAIL"|"BLOCKED", problems: string[] }}
 */
export function validateQuestionBankContract(suite, options = {}) {
  const problems = [];
  let blocked = false;

  if (!suite || typeof suite !== "object") {
    return { ok: false, status: "FAIL", problems: ["suite is missing or not an object"] };
  }

  const structural = validateJourneySuite(suite);
  if (!structural.ok) {
    problems.push(...structural.problems);
    if (structural.problems.some((p) => /requiredConfigFingerprint/i.test(p))) {
      blocked = true;
    }
  }

  // CompatConfigProfile fingerprint gate (D27 / SC-15): missing runtime fp ⇒ BLOCKED.
  if (
    suite.requiredConfigFingerprint &&
    (options.configProfileFingerprint === undefined ||
      options.configProfileFingerprint === null ||
      (typeof options.configProfileFingerprint === "string" &&
        !options.configProfileFingerprint.trim()))
  ) {
    // Only when caller explicitly opts into runtime fingerprint check via key presence,
    // OR when they pass null/empty string. `options` without the key skips this branch
    // so pure YAML shape checks can still PASS a good suite.
    if (Object.prototype.hasOwnProperty.call(options, "configProfileFingerprint")) {
      problems.push("missing CompatConfigProfile fingerprint (D27)");
      blocked = true;
    }
  } else if (
    Object.prototype.hasOwnProperty.call(options, "configProfileFingerprint") &&
    suite.requiredConfigFingerprint &&
    options.configProfileFingerprint !== suite.requiredConfigFingerprint
  ) {
    problems.push(
      `CompatConfigProfile fingerprint mismatch: got ${options.configProfileFingerprint}, required ${suite.requiredConfigFingerprint}`,
    );
    blocked = true;
  }

  if (options.profile) {
    const expected =
      typeof options.expectedFingerprint === "string"
        ? options.expectedFingerprint
        : computeConfigProfileFingerprint(options.profile);
    if (suite.requiredConfigFingerprint !== expected) {
      problems.push("requiredConfigFingerprint does not match CompatConfigProfile fingerprint");
      blocked = true;
    }
  }

  // COMPAT-02 denominator must include 02c and 02d (and all four).
  const maps = suite.denominatorMaps?.["COMPAT-02"] ?? [];
  const caseIds = new Set((suite.cases || []).map((c) => c?.id).filter(Boolean));
  for (const id of COMPAT_02_REQUIRED_CASE_IDS) {
    if (!maps.includes(id) || !caseIds.has(id)) {
      problems.push(`COMPAT-02 missing ${id}`);
    }
  }

  for (const c of suite.cases || []) {
    const id = c?.id ?? "(unknown)";

    // Deny identities must declare requireToolsCall (D7a contract).
    for (const ident of c.identities || []) {
      if (ident?.expect?.outcome === "deny" && ident.expect.requireToolsCall !== true) {
        problems.push(`${id}/${ident.id ?? "?"}: deny case without tools/call evidence (requireToolsCall)`);
      }
    }

    // QB-ACL-02c must not bind healable lucy_ops_reader as deny carrier.
    if (id === "QB-ACL-02c") {
      for (const ident of c.identities || []) {
        if (ident?.role === PRODUCT_OPS_READER_ROLE_ID) {
          problems.push("QB-ACL-02c bound to healable lucy_ops_reader");
        }
        if (
          ident?.expect?.outcome === "deny" &&
          ident.role !== FROZEN_W0_ROLE_ID &&
          !ident.constraints?.frozenW0Only
        ) {
          problems.push(
            `QB-ACL-02c deny identity must use frozen W0 role ${FROZEN_W0_ROLE_ID}, got ${ident.role}`,
          );
        }
      }
    }

    // QB-DB-01 must not use lucy_admin.
    if (id === "QB-DB-01") {
      for (const ident of c.identities || []) {
        if (ident?.role === FORBIDDEN_ADMIN_ROLE_ID) {
          problems.push("QB-DB-01 identity lucy_admin");
        }
        if (ident?.expect?.forbiddenRole !== FORBIDDEN_ADMIN_ROLE_ID) {
          problems.push("QB-DB-01 must declare forbiddenRole: lucy_admin");
        }
      }
    }

    // QB-ACL-03b-gate v2: scoped row-isolation DEAL (P1-72); NOT unproven deny.
    if (id === "QB-ACL-03b-gate") {
      const ident = c.identities?.[0]?.expect ?? {};
      const oracle = c.oracle?.expect ?? {};
      if (ident.outcome !== "allow" || c.oracle?.kind === "deny") {
        problems.push(
          "QB-ACL-03b-gate expects row isolation success (allow), not unproven deny",
        );
      }
      if (oracle.rowIsolationSuccess !== true && ident.rowIsolationSuccess !== true) {
        problems.push(
          "QB-ACL-03b-gate expects row isolation success (allow), not unproven deny",
        );
      }
      const denyCode =
        oracle.reasonCode ?? ident.reasonCode ?? ident.reasonFamily;
      if (denyCode === "row_policy_upstream_unproven") {
        problems.push(
          "QB-ACL-03b-gate expects row isolation success (allow), not unproven deny",
        );
      }
      if (oracle.notRowIsolationDeal === true || ident.notRowIsolationSuccess === true) {
        problems.push(
          "QB-ACL-03b-gate expects row isolation success (allow), not unproven deny",
        );
      }
    }

    // W0: filters must not contain gov.*
    if (c.lane === "ops-w0") {
      for (const ctrl of c.mcpControls || []) {
        if (filtersContainGovStar(collectQueryFilters(ctrl.query))) {
          problems.push(`${id}: W0 mcpControls filters contain gov.*`);
        }
      }
    }

    // W1/W2: must declare an allowed gov window knob.
    if (c.lane === "ops-w1" || c.lane === "ops-w2") {
      for (const ctrl of c.mcpControls || []) {
        if (!filtersContainGovWindowKnob(collectQueryFilters(ctrl.query))) {
          problems.push(`${id}: W1/W2 missing any allowed gov window knob`);
        }
      }
    }
  }

  const regionHits = findForbiddenRegionLabelsInSuite(suite);
  if (regionHits.length > 0) {
    problems.push(`region vocabulary 华东/西南 in fixture: ${regionHits.slice(0, 5).join("; ")}`);
  }

  const unique = [...new Set(problems)];
  if (unique.length === 0) {
    return { ok: true, status: "PASS", problems: [] };
  }
  return {
    ok: false,
    status: blocked ? "BLOCKED" : "FAIL",
    problems: unique,
  };
}

/**
 * D7a runtime evidence: deny PASS requires explicit tools/call evidence.
 *
 * @param {{
 *   expect?: { outcome?: string, requireToolsCall?: boolean },
 *   observed?: {
 *     outcome?: string,
 *     toolsCallEvidence?: boolean|object|null,
 *     oralDenialOnly?: boolean,
 *     upstreamExecutions?: number,
 *   }
 * }} args
 * @returns {{ verdict: "PASS"|"FAIL", reasons: string[] }}
 */
export function evaluateDenyEvidence({ expect: expectOut, observed } = {}) {
  const reasons = [];
  const needsDeny =
    expectOut?.outcome === "deny" || expectOut?.requireToolsCall === true;
  if (!needsDeny) {
    return { verdict: "PASS", reasons };
  }
  const toolsCall = observed?.toolsCallEvidence;
  const hasToolsCall =
    toolsCall === true ||
    (toolsCall && typeof toolsCall === "object" && toolsCall.method === "tools/call");
  if (!hasToolsCall || observed?.oralDenialOnly === true) {
    reasons.push("deny case without tools/call evidence");
  }
  if (typeof observed?.upstreamExecutions === "number" && observed.upstreamExecutions !== 0) {
    reasons.push(`deny must have zero upstream executions, got ${observed.upstreamExecutions}`);
  }
  return { verdict: reasons.length ? "FAIL" : "PASS", reasons };
}

/**
 * Independent oracle gate (Spec D3): agent self-reported numbers never replace oracle.
 *
 * @param {{
 *   oracle?: { kind?: string, expect?: object },
 *   observed?: {
 *     agentSelfReported?: object|number|string|null,
 *     independentOracleVerified?: boolean,
 *     independentQueryResult?: object|null,
 *     baselineMatch?: boolean,
 *   }
 * }} args
 * @returns {{ verdict: "PASS"|"FAIL", reasons: string[] }}
 */
export function evaluateOracleClaim({ oracle, observed } = {}) {
  const reasons = [];
  const selfReported = observed?.agentSelfReported;
  const hasSelfReport =
    selfReported != null &&
    selfReported !== false &&
    !(typeof selfReported === "object" && Object.keys(selfReported).length === 0);

  const independentOk =
    observed?.independentOracleVerified === true ||
    observed?.baselineMatch === true ||
    (observed?.independentQueryResult != null && observed.independentOracleVerified !== false);

  if (hasSelfReport && !independentOk) {
    reasons.push("agent self-reported number cannot replace oracle");
  }

  // Exact oracle with numeric expect still requires independent verification path.
  if (
    oracle?.kind === "exact" &&
    oracle?.expect &&
    hasSelfReport &&
    observed?.independentOracleVerified !== true &&
    observed?.baselineMatch !== true
  ) {
    if (!reasons.includes("agent self-reported number cannot replace oracle")) {
      reasons.push("agent self-reported number cannot replace oracle");
    }
  }

  return { verdict: reasons.length ? "FAIL" : "PASS", reasons };
}

/**
 * Simulate a case runner that restores fixtures between cases.
 * Restore failure throws and MUST stop subsequent cases (Plan SC-18).
 *
 * @template T
 * @param {{
 *   cases: T[],
 *   runCase: (c: T, index: number) => void|Promise<void>,
 *   restore: () => void|Promise<void>,
 * }} args
 * @returns {Promise<{ ran: number, stopped: boolean, error: Error|null }>}
 */
export async function runCasesWithFixtureRestore({ cases, runCase, restore }) {
  let ran = 0;
  let stopped = false;
  let error = null;
  for (let i = 0; i < cases.length; i++) {
    await runCase(cases[i], i);
    ran += 1;
    try {
      await restore();
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      stopped = true;
      break;
    }
  }
  return { ran, stopped, error };
}

/**
 * Convenience: missing suite requiredConfigFingerprint → aggregate BLOCKED.
 * @param {object} suite
 * @param {object} [axes]
 */
export function aggregateWithMissingFingerprint(suite, axes = {}) {
  const mutated = structuredClone(suite);
  delete mutated.requiredConfigFingerprint;
  return aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite: mutated,
    configProfileFingerprint: axes.configProfileFingerprint ?? "sha256:deadbeef",
    functionalCases: axes.functionalCases ?? [],
    mcp: axes.mcp ?? { samplesMs: Array(20).fill(10), budgetClass: "simple", baselineP95Ms: 10 },
    agent: axes.agent ?? {
      turns: [
        { turnWallClockMs: 1000 },
        { turnWallClockMs: 1100 },
        { turnWallClockMs: 1200 },
      ],
      baselineMedianMs: 1000,
    },
  });
}
