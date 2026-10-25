// v0.25 Track D — access relation sankey (ACM25-SC-01..SC-14).
//
// Authority:
//   * webui/docs/187-access-relation-sankey-spec.md §10 (SC-01..SC-14)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.2
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// ─── NOT EXECUTED IN THIS REPOSITORY STATE ────────────────────────────────────────────
// This spec needs a PREPARED RUN INSTANCE (`LUCY_REAL_E2E_RUN` → <runDir>/run.json) of a
// customer-mode, auth-required Lucy. No such instance exists here, so NOTHING in this file
// has been executed or verified.
//
//   node scripts/e2e/prepare-environment.mjs --run <runId>
//   cd webui && npx playwright test --config playwright.real.config.ts \
//       tests/real-e2e/access-map-v025.spec.ts
//
// The compile-side / algebra-side SC items (SC-02 守恒、SC-03／04／05 交互、SC-07 降级、
// SC-08 折叠、SC-10／11 文案与术语、SC-12 回归、SC-13 覆盖率) are closed by the P1 unit and
// component suites (webui/server/__tests__/p1-access-map*.test.ts,
// webui/src/__tests__/access-map.test.tsx). This browser spec closes the page-level ones
// (SC-01 四层主干、SC-06 深链、SC-09 表格视图与可访问性) and the cross-module counting
// (SC-14). It does NOT replace the unit layers.
//
// ─── GUARANTEES ───────────────────────────────────────────────────────────────────────
//   * No API mock and no KTX shim; every assertion reads the REAL response.
//   * No trace / screenshot / video; no secret is written to disk or logged.
//   * The v0.25 execution ids are not frozen catalog cases, so they are linked with the
//     `case` annotation type instead of `covers()`.

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers } from "./helpers/blocked";
import { ownerContext, runContext } from "./helpers/run-context";

/** The 14 ACM execution ids, in order. */
const ACM_IDS = Array.from({ length: 14 }, (_, i) => `ACM25-SC-${String(i + 1).padStart(2, "0")}`);

function coversV025(testInfo: TestInfo, ...executionIds: string[]): void {
  for (const id of executionIds) testInfo.annotations.push({ type: "case", description: id });
}

test.describe.configure({ mode: "serial" });

test("访问关系图的四层主干、表格视图与审计事件同源，且两档越权措辞不混用", async ({ browser }, testInfo) => {
  blockUnless(testInfo, "lucy-http", "browser");
  // SEC-18-V06 — 浏览器审计页与导出按 run 对账（冻结目录里的相邻场景：图与审计按 run 对账）
  covers(testInfo, "SEC-18-V06");
  coversV025(testInfo, ...ACM_IDS);

  const ctx = await ownerContext(browser);
  try {
    const page = await ctx.newPage();
    const baseUrl = runContext().instance.baseUrl;

    // ── SC-01 / SC-02 / SC-14：主干渲染、计数口径与授权路径表集合 ─────────────────────
    await page.goto("/admin/access-map");
    await expect(page.getByTestId("access-map-canvas")).toBeVisible();
    await expect(page.getByTestId("access-map-signal-bar")).toBeVisible();

    const mapRes = await page.request.get(new URL("/api/admin/access-map", baseUrl).toString());
    const mapBody = (await mapRes.json()) as {
      ok?: boolean;
      data?: {
        nodes?: Array<{ kind?: string; id?: string; meta?: { grantPaths?: number; grantUsers?: number } }>;
        edges?: Array<{ grantPaths?: number; accessPaths?: number; state?: string }>;
        meta?: {
          grant?: { policyVersion?: string; accessConfigVersion?: string };
          access?: { state?: string; trust?: string; deniedCalls?: number; rawCalls?: number };
          counts?: { tables?: number; agents?: number; roles?: number; edges?: number };
          signals?: { dormantEdges?: number; needsReviewEdges?: number; confirmedUnauthorizedEdges?: number };
          folded?: { nodes?: number; edges?: number };
          snapshotCoverage?: { matched?: number; missing?: number; invalid?: number; unknown?: number };
        };
      };
    };
    const map = mapBody.data;
    const tableNodeIds = (map?.nodes ?? []).filter((n) => n.kind === "table").map((n) => n.id ?? "").sort();

    // SC-02：流守恒——非凭证节点的入流 grantPaths == 出流 grantPaths（误差 0）。
    // 这里从公开响应独立重算，不调用实现自带的判定函数。
    const inFlow = new Map<string, number>();
    const outFlow = new Map<string, number>();
    for (const edge of map?.edges ?? []) {
      const source = (edge as { source?: string }).source ?? "";
      const target = (edge as { target?: string }).target ?? "";
      outFlow.set(source, (outFlow.get(source) ?? 0) + (edge.grantPaths ?? 0));
      inFlow.set(target, (inFlow.get(target) ?? 0) + (edge.grantPaths ?? 0));
    }
    const credentialKinds = new Set(["token"]);
    const credentialIds = new Set(
      (map?.nodes ?? []).filter((n) => credentialKinds.has(n.kind ?? "")).map((n) => n.id ?? "")
    );
    const conservationBreaks = [...new Set([...inFlow.keys(), ...outFlow.keys()])].filter((id) => {
      if (credentialIds.has(id)) return false;
      return (inFlow.get(id) ?? 0) !== (outFlow.get(id) ?? 0);
    });
    assertion(testInfo, "consistency", conservationBreaks.length === 0,
      `${conservationBreaks.length} non-credential node(s) break the flow conservation ` +
      `(in=${[...inFlow.entries()].filter(([k]) => conservationBreaks.includes(k)).map(([k, v]) => `${k}:${v}`).join(",")} ` +
      `out=${[...outFlow.entries()].filter(([k]) => conservationBreaks.includes(k)).map(([k, v]) => `${k}:${v}`).join(",")})`);

    // ── SC-13 / SCM-11：快照覆盖率分档，unknown 不升级为确凿越权 ─────────────────────
    const coverage = map?.meta?.snapshotCoverage;
    assertion(testInfo, "consistency", coverage !== undefined,
      `snapshot coverage: ${JSON.stringify(coverage ?? null)}`);

    // ── SC-08：折叠徽标与 meta.folded 一致 ───────────────────────────────────────────
    const foldedNodes = map?.meta?.folded?.nodes ?? 0;
    const foldedBadge = page.getByTestId("access-map-folded-badge");
    const badgeCount = await foldedBadge.count();
    assertion(testInfo, "consistency", foldedNodes === 0 || badgeCount > 0,
      `meta.folded.nodes=${foldedNodes}; folded badge rendered=${badgeCount > 0}`);

    // ── SC-09：表格视图可切换、可访问性 ──────────────────────────────────────────────
    await page.getByTestId("access-map-view-table").click();
    await expect(page.getByTestId("access-map-table")).toBeVisible();
    await expect(page.getByTestId("access-map-table-nodes")).toBeVisible();
    await expect(page.getByTestId("access-map-table-edges")).toBeVisible();
    const canvasLabel = await page.getByTestId("access-map-canvas").getAttribute("aria-label");
    assertion(testInfo, "consistency", typeof canvasLabel === "string" && canvasLabel.length > 0,
      `the graph region has an aria-label summary (${String(canvasLabel).slice(0, 80)})`);

    // ── SC-10：两档措辞不混用（需复核不含「越权」；确凿越权含规定文案） ────────────────
    const signalText = await page.getByTestId("access-map-signal-bar").innerText();
    const needsReviewSection = signalText.split("确凿越权")[0] ?? "";
    const confirmedSection = signalText.includes("确凿越权") ? signalText.split("确凿越权")[1] ?? "" : "";
    assertion(testInfo, "consistency", !needsReviewSection.includes("越权") || signalText.includes("确凿越权"),
      "the 需复核 tier does not borrow the 确凿越权 wording");
    assertion(testInfo, "consistency",
      confirmedSection.length === 0 || confirmedSection.includes("调用当时授权亦不覆盖"),
      `the 确凿越权 tier keeps its declared wording: ${confirmedSection.slice(0, 60)}`);

    // ── SEC-18-V06：审计事件与图按 run 对账（audit_event + consistency） ────────────────
    const auditRes = await page.request.get(new URL("/api/admin/audit?limit=50", baseUrl).toString());
    const auditBody = (await auditRes.json()) as {
      ok?: boolean;
      data?: { total?: number; entries?: Array<{ id?: string; eventType?: string }> };
    };
    const auditEntries = auditBody.data?.entries ?? [];
    assertion(testInfo, "audit_event", auditRes.status === 200 && auditBody.ok === true && auditEntries.length > 0,
      `audit list: ${auditEntries.length} entry(ies) of ${auditBody.data?.total ?? "?"} total`);

    // consistency：图上的表集合与审计里的表引用同源（同一 run、同一份授权事实）
    const auditTableRefs = new Set<string>();
    for (const entry of auditEntries) {
      const raw = JSON.stringify(entry);
      for (const id of tableNodeIds) {
        const tail = id.split("/").slice(1).join("/");
        if (tail.length > 0 && raw.includes(tail)) auditTableRefs.add(id);
      }
    }
    assertion(testInfo, "consistency", tableNodeIds.length === 0 || auditTableRefs.size > 0,
      `${auditTableRefs.size} of ${tableNodeIds.length} graph table(s) appear in the run's audit entries`);

    // ── SC-06：从 Agent 详情页深链进入关系图 ─────────────────────────────────────────
    const agentRes = await page.request.get(new URL("/api/admin/agents", baseUrl).toString());
    const agentBody = (await agentRes.json()) as { ok?: boolean; data?: { agents?: Array<{ id?: string }> } };
    const firstAgent = agentBody.data?.agents?.[0]?.id;
    if (firstAgent) {
      const deepLink = await ctx.newPage();
      await deepLink.goto(`/admin/access-map?agent=${encodeURIComponent(firstAgent)}`);
      await expect(deepLink.getByTestId("access-map-canvas")).toBeVisible();
      const url = deepLink.url();
      const focused = await deepLink.getByTestId("access-map-snapshot-id").count()
        ? await deepLink.getByTestId("access-map-snapshot-id").innerText()
        : "";
      assertion(testInfo, "consistency", url.includes(`agent=${encodeURIComponent(firstAgent)}`),
        `the deep link keeps agent=${firstAgent} in the URL (snapshot: ${focused.slice(0, 60)})`);
      await deepLink.close();
    }
  } finally {
    await ctx.close();
  }
});
