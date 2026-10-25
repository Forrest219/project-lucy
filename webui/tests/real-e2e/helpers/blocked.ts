// Evidence helpers shared by the real-user specs.
//   covers()      links a test to catalog case ids (the collector reads these annotations, not test titles)
//   coversV025()  links a test to v0.25 execution ids (their OWN annotation namespace)
//   assertion()   records one declared assertion token with its verdict
//   blockUnless() marks the test BLOCKED (never passed, never plain-skipped) when a capability is missing
// scripts/e2e/collect-management-results.mjs turns the `case` annotations into per-case evidence;
// scripts/e2e/collect-v025-results.mjs turns the `v025-case` annotations into per-execution-item evidence.

import type { TestInfo } from "@playwright/test";
import { runContext } from "./run-context";

export function covers(testInfo: TestInfo, ...caseIds: string[]): void {
  for (const id of caseIds) testInfo.annotations.push({ type: "case", description: id });
}

/**
 * Links a test to v0.25 execution ids.
 *
 * These ids live in their OWN annotation namespace on purpose: `case` belongs to the
 * frozen release catalog (32 scenarios / 255 required variants), and the frozen
 * collector must never see a v0.25 id — it would silently drop it, and the v0.25
 * browser dimension would stay invisible.
 */
export function coversV025(testInfo: TestInfo, ...executionIds: string[]): void {
  for (const id of executionIds) testInfo.annotations.push({ type: "v025-case", description: id });
}

export function assertion(testInfo: TestInfo, token: string, passed: boolean, detail = ""): void {
  testInfo.annotations.push({ type: "assert", description: JSON.stringify({ token, passed, detail: detail.slice(0, 300) }) });
}

/**
 * Declares that this runner is a BINDING-CONTRACT runner: it proves the shape of a
 * case (which endpoint, which command, which client set) and deliberately does NOT
 * produce the live evidence the frozen catalog declares for that case.
 *
 * Why this has to be machine-readable
 * ----------------------------------
 * The frozen catalog's rule is fail-closed: a declared assertion token that the
 * runner never evaluated means the case FAILED, so no case can pass vacuously.
 * That rule is right for a live runner that forgot to assert something.
 *
 * It is wrong for a runner that SAYS it never claims a live pass. Such a runner
 * can never evaluate `real_query` / `typed_gold` / `consistency` — those need a
 * live data plane and a typed gold comparison, not an endpoint constant — so the
 * case was never evaluated at all. Recording that as `failed` blames a product that
 * was never exercised; the honest verdict is BLOCKED (not accepted, not passed).
 *
 * The distinction is only safe if it is EXPLICIT: a runner that stays silent keeps
 * the fail-closed `failed` verdict. `scripts/e2e/collect-management-results.mjs`
 * turns this annotation into a blocked verdict only for the tokens listed here.
 */
export function contractOnly(testInfo: TestInfo, tokensById: Record<string, string[]>): void {
  testInfo.annotations.push({
    type: "contract-only",
    description: JSON.stringify(tokensById)
  });
}

/**
 * Capabilities whose presence must be PROVEN, never declared.
 *
 * `ktx-upstream` is the data plane the Lucy proxy forwards every query to. If
 * it is not listening, every query answers empty — which reads like a product
 * defect and is not one. So a capability that can be probed is granted only by
 * the runner's own probe (`LUCY_REAL_E2E_UPSTREAM_READY`), never by somebody
 * writing the capability into the environment.
 */
const PROVEN_CAPABILITIES = new Set(["ktx-upstream"]);

function declaredCapabilities(): string[] {
  return (process.env.LUCY_REAL_E2E_CAPABILITIES ?? "")
    .split(",")
    .map((cap) => cap.trim())
    .filter(Boolean);
}

export function capabilities(): Set<string> {
  const caps = new Set<string>(["lucy-http", "browser"]);
  const run = runContext();
  if (run.db.applied) caps.add("postgres");
  for (const cap of declaredCapabilities()) {
    // A declaration alone is never enough for a probe-backed capability.
    if (PROVEN_CAPABILITIES.has(cap)) continue;
    caps.add(cap);
  }
  for (const cap of PROVEN_CAPABILITIES) {
    // Local runs: the runner started the upstream and saw it answer.
    // External runs: the upstream lives inside the cluster and cannot be probed
    // from here, so the operator's attestation is the only signal available.
    const proven = run.executionMode === "release"
      ? declaredCapabilities().includes(cap)
      : process.env.LUCY_REAL_E2E_UPSTREAM_READY === "1";
    if (proven) caps.add(cap);
  }
  return caps;
}

/** Marks the test blocked and stops it when any capability is absent. Returns normally when all are present. */
export function blockUnless(testInfo: TestInfo, ...required: string[]): void {
  const have = capabilities();
  const missing = required.filter((cap) => !have.has(cap));
  if (missing.length === 0) return;
  testInfo.annotations.push({ type: "blocked", description: `missing capability: ${missing.join(", ")}` });
  testInfo.skip(true, `BLOCKED: missing capability ${missing.join(", ")}`);
}
