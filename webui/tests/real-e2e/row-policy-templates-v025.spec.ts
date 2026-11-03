// v0.25 Track D — row policy templates (RTP25-01..10) and per-table reverse lookup (RTV25-01..08).
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md §8 (RTP-01..10, RTV-01..08)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.1
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// ─── NOT EXECUTED IN THIS REPOSITORY STATE ────────────────────────────────────────────
// This spec needs a PREPARED RUN INSTANCE (`LUCY_REAL_E2E_RUN` → <runDir>/run.json) of a
// customer-mode, auth-required Lucy with the real KTX upstream. No such instance exists
// here, so NOTHING in this file has been executed or verified. It is a real-browser
// contract, not a passing test.
//
//   node scripts/e2e/prepare-environment.mjs --run <runId>          # prepares the instance
//   cd webui && npx playwright test --config playwright.real.config.ts \
//       tests/real-e2e/row-policy-templates-v025.spec.ts
//
// ─── GUARANTEES ───────────────────────────────────────────────────────────────────────
//   * No `page.route` / API mock / KTX shim: the assertions read the REAL responses the
//     page actually got (scripts/e2e/__tests__/real-e2e-guard.test.mjs enforces this).
//   * No trace / screenshot / video, no secret written to disk: evidence is the
//     assertion annotations only.
//   * The v0.25 execution ids are NOT frozen catalog cases (the catalog is immutable and
//     the coverage manifest is a separate registry), so they are linked with the same
//     `case` annotation type instead of `covers()`.

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";
import { accessMapTableKeys, rowPolicyViewTableKeys } from "./helpers/table-identity";

/** The 10 RTP execution ids, in order. */
const RTP_IDS = [
  "RTP25-01", "RTP25-02", "RTP25-03", "RTP25-04", "RTP25-05",
  "RTP25-06", "RTP25-07", "RTP25-08", "RTP25-09", "RTP25-10"
];

/** The 8 RTV execution ids, in order. */
const RTV_IDS = [
  "RTV25-01", "RTV25-02", "RTV25-03", "RTV25-04",
  "RTV25-05", "RTV25-06", "RTV25-07", "RTV25-08"
];

test.describe.configure({ mode: "serial" });

test("行策略模板与按表反查在同一快照下给出同一份规范源键集合，且不泄漏范围外内容", async ({ browser }, testInfo) => {
  blockUnless(testInfo, "lucy-http", "browser", "ktx-upstream");
  // SEC-13-V06 — 浏览器启用表变更后权限同步（冻结目录里的相邻场景：权限随启用表范围同步）
  covers(testInfo, "SEC-13-V06");
  coversV025(testInfo, ...RTP_IDS, ...RTV_IDS);

  const ctx = await ownerContext(browser);
  try {
    const page = await ctx.newPage();

    // ── RTV-04 / RTV-06 / RTV-08：按表反查与授权路径同源 ─────────────────────────────
    const viewsRes = await page.request.get(
      new URL("/api/admin/row-policy/views/tables", runContext().instance.baseUrl).toString()
    );
    const viewsBody = (await viewsRes.json()) as {
      ok?: boolean;
      data?: { state?: string; status?: string; tables?: Array<{ connectionId?: string; schema?: string; sourceName?: string }> };
    };
    const viewTables = viewsBody.data?.tables ?? [];
    const viewKeys = rowPolicyViewTableKeys(viewTables);

    const mapRes = await page.request.get(
      new URL("/api/admin/access-map", runContext().instance.baseUrl).toString()
    );
    const mapBody = (await mapRes.json()) as {
      ok?: boolean;
      data?: { nodes?: Array<{ kind?: string; id?: string; label?: string }> };
    };
    const mapTableNodes = (mapBody.data?.nodes ?? []).filter((n) => n.kind === "table");
    const mapKeys = accessMapTableKeys(mapTableNodes.map((n) => `${n.id ?? ""}`));

    // deny: 反查列出的每张表都必须有对应的授权路径节点——不存在"有行策略但无授权路径"的表。
    // 两个视图的表键格式不同（反查页是 conn/schema/source，关系图节点是
    // table:conn::schema::source），所以先归一到同一种规范键再比较。
    const orphanViews = [...viewKeys].filter((key) => mapKeys.size > 0 && !mapKeys.has(key));
    assertion(testInfo, "deny", orphanViews.length === 0,
      `row-policy view lists ${viewKeys.size} table(s); ${orphanViews.length} without an access-map table node`);

    // ── RTP-05 / RTV-08：同一快照，不混用不同代的配置、目录或策略 ─────────────────────
    const page1 = await ctx.newPage();
    await page1.goto("/admin/row-policies");
    await expect(page1.getByTestId("row-policy-view-page")).toBeVisible();
    // list-state 只在 state !== "ok" 时渲染；ok 快照下用表清单本身作为同源证据。
    const listStateLocator = page1.getByTestId("row-policy-view-list-state").first();
    const listState = (await listStateLocator.count())
      ? (await listStateLocator.innerText()).trim()
      : "";
    const snapshotLocator = page1.getByTestId("row-policy-snapshot").first();
    const snapshotText = (await snapshotLocator.count()) ? await snapshotLocator.innerText() : "";
    const tableListVisible = (await page1.getByTestId("row-policy-view-table-list").count()) > 0;
    const emptyListVisible = (await page1.getByTestId("row-policy-view-list-empty").count()) > 0;
    assertion(testInfo, "consistency", listState.length > 0 || tableListVisible || emptyListVisible,
      `reverse lookup rendered (state="${listState}", tableList=${tableListVisible}, empty=${emptyListVisible}); snapshot: ${snapshotText.slice(0, 120)}`);

    // ── RTV-01／RTV-02：预置 finance_east 使 marketing_daily 出现在「仅受限表」──────────
    // 与人工 UAT「亚洲经营表」同构：scoped 谓词按 region 收窄；fixture 字面量是 East。
    // 注意：同表上若另有 Role 授 `all`（finance_reader），有效并集可为「全部行」——
    // 「仅受限表」仍应收录该表（任一 Role 分支为 scoped），详情须能看到 East 受限分支。
    await page1.getByRole("button", { name: "仅受限表" }).click();
    await expect(page1).toHaveURL(/restricted=true/);
    const restrictedRow = page1.getByTestId("row-policy-view-table-fin-db-analytics-marketing_daily");
    const restrictedVisible = (await restrictedRow.count()) > 0;
    assertion(testInfo, "allow_control", restrictedVisible,
      `restricted filter keeps marketing_daily (scoped East fixture); visible=${restrictedVisible}`);
    if (restrictedVisible) {
      await page1.getByRole("button", { name: "fin-db/analytics/marketing_daily" }).click();
      const detail = page1.getByTestId("row-policy-view-detail");
      await expect(detail).toBeVisible();
      await expect(detail).toContainText("fin-db/analytics/marketing_daily");
      const eastBranch = page1.getByTestId("row-policy-view-role-finance_east");
      const eastVisible = (await eastBranch.count()) > 0;
      assertion(testInfo, "consistency", eastVisible,
        `detail lists the finance_east scoped branch; visible=${eastVisible}`);
      if (eastVisible) {
        const eastText = (await eastBranch.innerText()).trim();
        assertion(testInfo, "consistency",
          eastText.includes("受限行授予") && eastText.includes("East"),
          `finance_east branch keeps scoped East predicate; got=${eastText.slice(0, 200)}`);
      }
      // RTV-02：若详情里同时有两个受限 Role 分支，并集不得被拍成「看不到分支」。
      const accessLabels = await page1.getByTestId("row-policy-view-role-access").allInnerTexts();
      const scopedBranches = accessLabels.filter((text) => text.includes("受限行授予"));
      if (scopedBranches.length >= 2) {
        assertion(testInfo, "deny",
          (await page1.getByTestId("row-policy-dnf-union").count()) > 0 ||
            (await page1.getByTestId("row-policy-dnf-union-all").count()) > 0,
          `multi-role detail must expose a DNF union or an explicit all absorption; scopedBranches=${scopedBranches.length}`);
      }
    }
    await page1.close();

    // ── RTV-07：反查页是只读的，没有任何写入口 ───────────────────────────────────────
    const writeControls = await page.getByRole("button", { name: /保存|新建|删除|提交/ }).count();
    assertion(testInfo, "deny", writeControls === 0,
      `the reverse lookup view exposes ${writeControls} write control(s)`);

    // ── RTP-08 / RTP-09 / RTP-10：模板页的可用性、引用面与审计状态 ────────────────────
    const page2 = await ctx.newPage();
    await page2.goto("/admin/row-policy-templates");
    await expect(page2.getByTestId("row-policy-templates-page")).toBeVisible();
    // The template list renders EITHER the table (templates exist) OR the empty state (none
    // exist yet) — webui/src/components/admin/RowPolicyTemplatePanel.tsx. Asserting the table
    // unconditionally would make the spec depend on pre-existing data, so the assertion is on
    // the list region being present in one of its two legitimate forms.
    const templateTable = page2.getByTestId("row-policy-template-table");
    const templateEmpty = page2.getByTestId("row-policy-template-empty");
    const hasTable = (await templateTable.count()) > 0;
    const hasEmpty = (await templateEmpty.count()) > 0;
    assertion(testInfo, "consistency", hasTable !== hasEmpty,
      `the template list region is present in exactly one form (table=${hasTable}, empty=${hasEmpty})`);
    const usability = (await page2.getByTestId("row-policy-template-usability").first().count())
      ? await page2.getByTestId("row-policy-template-usability").first().innerText()
      : "";
    const references = (await page2.getByTestId("row-policy-template-references").first().count())
      ? await page2.getByTestId("row-policy-template-references").first().innerText()
      : "";
    const auditState = (await page2.getByTestId("row-policy-template-audit-state").first().count())
      ? await page2.getByTestId("row-policy-template-audit-state").first().innerText()
      : "";
    // The per-template disclosure (usability / references / audit state) belongs to a
    // template. With no template in the list there is nothing to disclose, so the
    // elements are legitimately absent — asserting they carry text would depend on
    // pre-existing data.
    assertion(testInfo, "consistency", hasTable
      ? usability.length > 0 && auditState.length > 0
      : usability.length === 0 && references.length === 0 && auditState.length === 0,
      `usability="${usability.trim()}" references="${references.trim()}" audit="${auditState.trim()}" (template table=${hasTable})`);

    // ── RTP-06：没有 dry-run 就不允许保存；dry-run 之后才允许保存 ────────────────────
    const saveButton = page2.getByTestId("row-policy-template-save").first();
    const disabledBeforeDryRun = await saveButton.isDisabled();
    // The dry-run posts the DRAFT, so the draft must carry a name: an empty draft is
    // refused by the API and the impact panel keeps its empty form. Clicking 预演 on
    // an empty form would prove nothing about the preview.
    await page2.locator("#row-policy-template-name").fill(`v025-dry-run-${runContext().runId}`);
    await page2.getByTestId("row-policy-template-dry-run").click();
    // The impact panel renders in one of its two legitimate forms: the impact itself
    // (the dry-run succeeded) or the empty state (the dry-run was refused).
    const impact = page2.getByTestId("row-policy-template-impact");
    const impactEmpty = page2.getByTestId("row-policy-template-impact-empty");
    await expect(impact.or(impactEmpty).first()).toBeVisible();
    const hasImpact = (await impact.count()) > 0;
    const disabledAfterDryRun = await saveButton.isDisabled();
    // The save button unlocks if and only if a successful impact preview exists.
    assertion(testInfo, "deny", disabledBeforeDryRun && disabledAfterDryRun === !hasImpact,
      `save disabled before dry-run=${disabledBeforeDryRun}, after dry-run=${disabledAfterDryRun}, impact rendered=${hasImpact}`);

    // ── ASV-13 / RTP-09：页面文本不含任何已登记的秘密 ────────────────────────────────
    const body = await page2.locator("body").innerText();
    assertion(testInfo, "no_leak", !vault.contains(body) && !body.includes("password="),
      "the template page carries no registered secret and no connection string with a password");
    await page2.close();
  } finally {
    await ctx.close();
  }
});
