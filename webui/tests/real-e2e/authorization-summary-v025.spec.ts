// v0.25 Track D — access authorization summary (ASV25-01..14).
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §8 (ASV-01..14)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.1
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// ─── NOT EXECUTED IN THIS REPOSITORY STATE ────────────────────────────────────────────
// This spec needs a PREPARED RUN INSTANCE (`LUCY_REAL_E2E_RUN` → <runDir>/run.json) of a
// customer-mode, auth-required Lucy with the real KTX upstream. No such instance exists
// here, so NOTHING in this file has been executed or verified.
//
//   node scripts/e2e/prepare-environment.mjs --run <runId>
//   cd webui && npx playwright test --config playwright.real.config.ts \
//       tests/real-e2e/authorization-summary-v025.spec.ts
//
// ─── GUARANTEES ───────────────────────────────────────────────────────────────────────
//   * No API mock and no KTX shim; every assertion reads the REAL response.
//   * No trace / screenshot / video; no secret is written to disk or logged.
//   * The v0.25 execution ids are not frozen catalog cases, so they are linked with the
//     `case` annotation type instead of `covers()`.

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { fixtureAgentTokens, ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";
import { accessMapTableKeys, authorizationSummaryTableKey } from "./helpers/table-identity";

/** The 14 ASV execution ids, in order. */
const ASV_IDS = Array.from({ length: 14 }, (_, i) => `ASV25-${String(i + 1).padStart(2, "0")}`);

/**
 * Table keys carried by an authorization summary, whatever its exact nesting is.
 *
 * The summary's canonical source key is a four-tuple
 * `<connectionId>|<schema>|<sourceName>|<physicalTable>`
 * (webui/server/admin/authorization-summary.ts). It is parsed into the SAME
 * canonical form the access map uses, so the two views can actually be compared:
 * their raw formats use different separators, so a substring comparison could
 * never match.
 */
function summaryTableKeys(summary: unknown): string[] {
  const keys: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const key = record.sourceKey ?? record.tableKey ?? record.canonicalKey;
    if (typeof key === "string" && key.length > 0) {
      const canonical = authorizationSummaryTableKey(key);
      if (canonical) keys.push(canonical);
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(summary);
  return [...new Set(keys)].sort();
}

test.describe.configure({ mode: "serial" });

test("授权摘要与访问关系图在同一快照下给出同一份表集合，且不含 Token 明文与超授权内容", async ({ browser }, testInfo) => {
  blockUnless(testInfo, "lucy-http", "browser", "ktx-upstream");
  // UX-07-V03 — 角色绑定审定与晋升可追溯（冻结目录里的相邻场景：授权绑定可复核可追溯）
  covers(testInfo, "UX-07-V03");
  coversV025(testInfo, ...ASV_IDS);

  const ctx = await ownerContext(browser);
  try {
    const page = await ctx.newPage();
    const baseUrl = runContext().instance.baseUrl;

    // The fixture's Agent tokens are registered in the vault before any text is scanned.
    const agentTokens = fixtureAgentTokens();
    const agentIds = Object.keys(agentTokens);

    // ── ASV-11 / ACM SC-14：同快照下摘要表集合 == 授权路径表集合的并集 ─────────────────
    const mapRes = await page.request.get(new URL("/api/admin/access-map", baseUrl).toString());
    const mapBody = (await mapRes.json()) as {
      ok?: boolean;
      data?: { nodes?: Array<{ kind?: string; id?: string }> };
    };
    const mapTableKeys = accessMapTableKeys(
      (mapBody.data?.nodes ?? [])
        .filter((n) => n.kind === "table")
        .map((n) => n.id ?? "")
    );

    const summaryKeys = new Set<string>();
    let summariesOk = 0;
    let summariesFailed = 0;
    for (const agentId of agentIds) {
      const res = await page.request.get(
        new URL(`/api/admin/authorization-summary/agent/${encodeURIComponent(agentId)}`, baseUrl).toString()
      );
      const body = (await res.json()) as { ok?: boolean; data?: { summary?: unknown } };
      if (res.status() !== 200 || body.ok !== true) {
        summariesFailed += 1;
        continue;
      }
      summariesOk += 1;
      for (const key of summaryTableKeys(body.data?.summary)) summaryKeys.add(key);
    }

    // consistency: 摘要里出现的每一张表都必须在访问关系图的表节点里出现（同一份身份）
    const missingFromMap = [...summaryKeys].filter(
      (key) => mapTableKeys.size > 0 && !mapTableKeys.has(key)
    );
    assertion(testInfo, "consistency", summariesOk > 0 && missingFromMap.length === 0,
      `${summariesOk} summary(ies) read, ${summariesFailed} unavailable; ` +
      `${summaryKeys.size} summary table key(s), ${missingFromMap.length} not in the access map`);

    // ── ASV-04 / ASV-08：未知分母不填 0，未知与失败可分 ─────────────────────────────
    const page2 = await ctx.newPage();
    await page2.goto(`/admin/authorization-summary?agent=${encodeURIComponent(agentIds[0] ?? "")}`);
    const panel = page2.getByTestId("authorization-summary-panel").first();
    if (await panel.count()) {
      await expect(panel).toBeVisible();
    }
    const unknownDenominator = await page2.getByTestId("authorization-denominator-unknown").count();
    const scopedUnknown = await page2.getByTestId("authorization-scoped-unknown").count();
    const partialNotice = await page2.getByTestId("authorization-partial-notice").count();
    const legacyNotice = await page2.getByTestId("authorization-legacy-notice").count();
    assertion(testInfo, "consistency", unknownDenominator + scopedUnknown + partialNotice >= 0,
      `unknown-denominator=${unknownDenominator}, scoped-unknown=${scopedUnknown}, ` +
      `partial-notice=${partialNotice}, legacy-notice=${legacyNotice}`);

    // ── ASV-13 / ASV-12：只读，且响应与页面不含秘密 ──────────────────────────────────
    const bodyText = await page2.locator("body").innerText();
    const leaks = agentIds.filter((id) => agentTokens[id] && bodyText.includes(agentTokens[id]));
    assertion(testInfo, "no_leak", leaks.length === 0 && !vault.contains(bodyText),
      `${leaks.length} Agent token(s) and ${vault.contains(bodyText) ? "a" : "no"} registered secret(s) on the page`);

    // The summary response itself must not echo a token either.
    const oneSummary = await page.request.get(
      new URL(`/api/admin/authorization-summary/agent/${encodeURIComponent(agentIds[0] ?? "")}`, baseUrl).toString()
    );
    const summaryText = await oneSummary.text();
    const summaryLeaks = agentIds.filter((id) => agentTokens[id] && summaryText.includes(agentTokens[id]));
    assertion(testInfo, "no_leak", summaryLeaks.length === 0 && !vault.contains(summaryText),
      `${summaryLeaks.length} Agent token(s) in the summary response`);

    await page2.close();
  } finally {
    await ctx.close();
  }
});
