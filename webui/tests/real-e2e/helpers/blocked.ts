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

export function capabilities(): Set<string> {
  const caps = new Set<string>(["lucy-http", "browser"]);
  if (runContext().db.applied) caps.add("postgres");
  for (const extra of (process.env.LUCY_REAL_E2E_CAPABILITIES ?? "").split(",")) {
    if (extra.trim()) caps.add(extra.trim());
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
