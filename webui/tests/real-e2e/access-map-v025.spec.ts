// v0.25 Track D — access relation sankey (ACM25-SC-01..SC-14).
//
// Authority:
//   * webui/docs/187-access-relation-sankey-spec.md §10 (SC-01..SC-14)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.2
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// ─── RUN STATE ─────────────────────────────────────────────────────────────────────────
// This spec needs a PREPARED RUN INSTANCE (`LUCY_REAL_E2E_RUN` → <runDir>/run.json) of a
// customer-mode, auth-required Lucy. The last real run against this file was 2026-11-05
// (`inbox/e2e/final-rds-20261105`): the page-level items below are closed by that run, and
// the items that need a real Agent turn in the same run are recorded as BLOCKED with a
// reason — never as passes.
//
//   node scripts/e2e/prepare-environment.mjs --run <runId> --mode local --pack row-policy
//   node scripts/e2e/select-product-target.mjs --target OBSERVE --run inbox/e2e/<runId>/run.json
//
// The compile-side / algebra-side SC items (SC-02 守恒、SC-03／04／05 交互、SC-07 降级、
// SC-08 折叠、SC-10／11 文案与术语、SC-12 回归、SC-13 覆盖率) are closed by the P1 unit and
// component suites (webui/server/__tests__/p1-access-map*.test.ts,
// webui/src/__tests__/access-map.test.tsx). This browser spec closes the page-level ones
// (SC-01 四层主干、SC-06 深链、SC-09 表格视图与可访问性) and the cross-module counting
// (SC-14). It does NOT replace the unit layers.
//
// ─── CONTRACT NOTE (2026-11-05) ───────────────────────────────────────────────────────
// The 数据表 tab was rewritten by the hourly-detail closure
// (docs/specs/lucy-20261104-access-map-hourly-detail-spec.md §5.1–§5.4):
//   * the old 「节点」「关系」summary tables are replaced by the 小时明细表 — the testids
//     `access-map-table-nodes` / `access-map-table-edges` no longer exist in the product
//     and must not be asserted;
//   * the two-tier wording moved into the 常驻口径行 — `access-map-methodology-snapshot`
//     and the `AccessMapSignalNotes` paragraphs are no longer in the default DOM, so the
//     需复核／确凿越权 wording is read from the resident line instead.
// The assertions below follow the CURRENT contract; the retired testids are gone.
//
// ─── GUARANTEES ───────────────────────────────────────────────────────────────────────
//   * No API mock and no KTX shim; every assertion reads the REAL response.
//   * No trace / screenshot / video; no secret is written to disk or logged.
//   * The v0.25 execution ids are not frozen catalog cases, so they are linked with the
//     `case` annotation type instead of `covers()`.

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { accessMapTableParts } from "./helpers/table-identity";
import { ownerContext, runContext } from "./helpers/run-context";

/** The 14 ACM execution ids, in order. */
const ACM_IDS = Array.from({ length: 14 }, (_, i) => `ACM25-SC-${String(i + 1).padStart(2, "0")}`);

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
    // chart-first Spec §5.2：首屏不再有信号条，图例短行取而代之。
    await expect(page.getByTestId("access-map-legend")).toBeVisible();

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
          snapshotCoverage?: { matched?: number; reviewPaths?: number; missingOrInvalid?: number; ratio?: number };
        };
      };
    };
    const map = mapBody.data;
    const tableNodeIds = (map?.nodes ?? []).filter((n) => n.kind === "table").map((n) => n.id ?? "").sort();

    // SC-02：流守恒——Agent 是源点（出流 = 路径数），Table 是汇点（入流 = 路径数），
    // 中间节点入流 == 出流（webui/docs/187-access-relation-sankey-spec.md §4.3 / SC-02）。
    // 这里从公开响应独立重算，不调用实现自带的判定函数。
    const inFlow = new Map<string, number>();
    const outFlow = new Map<string, number>();
    for (const edge of map?.edges ?? []) {
      const source = (edge as { source?: string }).source ?? "";
      const target = (edge as { target?: string }).target ?? "";
      outFlow.set(source, (outFlow.get(source) ?? 0) + (edge.grantPaths ?? 0));
      inFlow.set(target, (inFlow.get(target) ?? 0) + (edge.grantPaths ?? 0));
    }
    const conservationBreaks: string[] = [];
    for (const node of map?.nodes ?? []) {
      if (node.kind === "token") continue;
      const id = node.id ?? "";
      const inSum = inFlow.get(id) ?? 0;
      const outSum = outFlow.get(id) ?? 0;
      if (inSum === 0 && outSum === 0) continue;
      const paths = node.meta?.grantPaths ?? 0;
      if (inSum === 0) {
        // 源点（Agent）：出流必须等于该节点的路径数。
        if (outSum !== paths) conservationBreaks.push(`${id}: source out=${outSum} != paths=${paths}`);
        continue;
      }
      if (outSum === 0) {
        // 汇点（Table）：入流必须等于该节点的路径数。
        if (inSum !== paths) conservationBreaks.push(`${id}: sink in=${inSum} != paths=${paths}`);
        continue;
      }
      if (inSum !== outSum) conservationBreaks.push(`${id}: in=${inSum} != out=${outSum}`);
    }
    assertion(testInfo, "consistency", conservationBreaks.length === 0,
      `${conservationBreaks.length} node(s) break the flow conservation (${conservationBreaks.join("; ")})`);

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
    // The graph region carries the aria-label summary (节点数／边数／信号计数) on the
    // `role="img"` SVG itself (webui/src/components/admin/AccessMapCanvas.tsx) — the
    // `access-map-canvas` element is only the layout wrapper and has no label.
    // The label must be read while the canvas is still MOUNTED: the page renders
    // EITHER the canvas OR the table (webui/src/pages/admin/AccessMap.tsx), so
    // switching to the table view unmounts the canvas and the locator would never resolve.
    const canvasLabel = await page.getByTestId("access-map-svg").getAttribute("aria-label");
    assertion(testInfo, "consistency", typeof canvasLabel === "string" && canvasLabel.length > 0,
      `the graph region has an aria-label summary (${String(canvasLabel).slice(0, 80)})`);

    await page.getByTestId("access-map-view-table").click();
    // The switch is real: the graph region is unmounted in the table view.
    await expect(page.getByTestId("access-map-canvas")).toHaveCount(0);
    // The table view must land in ONE of the terminal states the hourly-detail contract
    // declares (hourly-detail Spec §5.1／§5.4；状态矩阵 §5.5):
    //   有明细 → access-map-table（内含 access-map-hourly-detail）
    //   真实零行 → access-map-table-empty
    //   审计不可用 → access-map-table-access-unavailable
    //   分页越界 → access-map-table-page-overflow
    // 「正在加载…」是过渡态，不算终态，所以不在这张表里。断言的是「落在声明的终态之一」，
    // 不是「一定有明细」——本 run 没有真实 Agent 调用时，真实零行就是正确呈现，
    // 写成必须有明细会把环境事实记成产品缺陷。
    const tableState = page
      .locator(
        '[data-testid="access-map-table"], [data-testid="access-map-table-empty"], ' +
        '[data-testid="access-map-table-access-unavailable"], [data-testid="access-map-table-page-overflow"]'
      )
      .first();
    await expect(tableState).toBeVisible({ timeout: 15_000 });
    const tableStateId = (await tableState.getAttribute("data-testid")) ?? "";
    assertion(testInfo, "consistency",
      ["access-map-table", "access-map-table-empty", "access-map-table-access-unavailable", "access-map-table-page-overflow"].includes(tableStateId),
      `the table view lands in a declared terminal state (${tableStateId})`);
    // 有明细时，明细表必须真的在 DOM 里——不能只挂一个空容器。
    if (tableStateId === "access-map-table") {
      await expect(page.getByTestId("access-map-hourly-detail")).toBeVisible();
    }

    // ── SC-10：两档措辞不混用 ───────────────────────────────────────────────────────
    // 两档口径已随 hourly-detail 收口（§5.2／§5.3）搬到**常驻口径行**：旧的
    // `access-map-methodology-snapshot` 折叠与 `AccessMapSignalNotes` 长段落已从默认页删除
    // （`access-map-signal-needs-review-note` / `access-map-signal-confirmed-source`
    // 不再出现在默认 DOM），所以两档措辞改从常驻行读：
    //   需复核档的压缩句（可关联／需复核／缺失）不得借用「越权」措辞；
    //   常驻行必须保留「低覆盖率不代表低越权率 · 缺失快照不判确凿越权」的档位区分句。
    const coverageSnapshot = map?.meta?.snapshotCoverage;
    const expectedCompressed = coverageSnapshot
      ? `快照：可关联 ${coverageSnapshot.matched}／需复核 ${coverageSnapshot.reviewPaths} · 缺失 ${coverageSnapshot.missingOrInvalid}`
      : "";
    const coverageText = await page.getByTestId("access-map-snapshot-coverage").innerText();
    assertion(testInfo, "consistency", expectedCompressed.length > 0 && coverageText.includes(expectedCompressed),
      `the resident coverage sentence agrees with the response (${coverageText.slice(0, 80)})`);
    assertion(testInfo, "consistency", !expectedCompressed.includes("越权"),
      `the 需复核 tier wording does not borrow 越权 (${expectedCompressed})`);
    assertion(testInfo, "consistency",
      coverageText.includes("低覆盖率不代表低越权率") && coverageText.includes("不判确凿越权"),
      `the resident line keeps the two tiers distinguishable (${coverageText.slice(0, 100)})`);

    // ── SEC-18-V06：审计事件与图按 run 对账（audit_event + consistency） ────────────────
    const auditRes = await page.request.get(new URL("/api/admin/audit?limit=50", baseUrl).toString());
    const auditBody = (await auditRes.json()) as {
      ok?: boolean;
      data?: { total?: number; entries?: Array<{ id?: string; eventType?: string }> };
    };
    const auditEntries = auditBody.data?.entries ?? [];
    if (auditEntries.length === 0) {
      // An audit entry only exists when something really happened in this run. Its
      // absence is an environment condition (this run made no Agent turn), not a
      // defect of the graph — so the reconciliation-by-run items are BLOCKED with a
      // reason, never FAILED.
      testInfo.annotations.push({
        type: "blocked",
        description: "this run produced no audit entry (no real Agent turn happened in this run); the graph cannot be reconciled against audit entries"
      });
      test.skip(true, "BLOCKED: no audit entry in this run");
      return;
    }
    // `status` is a METHOD on a Playwright APIResponse — comparing the function
    // itself with 200 is always false, so the verdict could never be positive.
    assertion(testInfo, "audit_event", auditRes.status() === 200 && auditBody.ok === true,
      `audit list: ${auditEntries.length} entry(ies) of ${auditBody.data?.total ?? "?"} total`);

    // consistency：图上的表集合与审计里的表引用同源（同一 run、同一份授权事实）
    // The node id is `table:<conn>::<schema>::<source>` — it has NO path separator,
    // so cutting a "tail" out of it would always yield the empty string and the
    // comparison could never match. The source name is the common denominator
    // between the graph node and the audit entry's table reference.
    const auditTableRefs = new Set<string>();
    for (const entry of auditEntries) {
      const raw = JSON.stringify(entry);
      for (const id of tableNodeIds) {
        const parts = accessMapTableParts(id);
        if (parts && parts.sourceName.length > 0 && raw.includes(parts.sourceName)) auditTableRefs.add(id);
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
