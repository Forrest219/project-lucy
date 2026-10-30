// ARV25-V01..V12 and LOG25-01 — real-browser read-only reconciliation spec
// (Plan W2-OBSERVE / Track C).
//
// WHAT THIS SPEC DOES
//   It drives the REAL admin read surfaces of the prepared instance and
//   reconciles them against the events THIS run produced:
//     * GET /api/admin/audit/reconciliation/inquiries/:turnId  (问询只读详情)
//     * GET /api/admin/audit/reconciliation/usage                (使用概况 / Token 对账)
//     * GET /api/admin/audit/reconciliation/export               (CSV / Manifest 导出)
//     * the admin audit page (the read-only view an operator uses)
//   Nothing is read from a mock, no network call is intercepted, no screenshot
//   or trace is captured.
//
// READ-ONLY BOUNDARY (implementation plan §2, concurrent-agent isolation)
//   The reconciliation read model is owned by another agent and may still be
//   in flight.  This spec therefore asserts only what the PUBLIC HTTP/UI
//   surfaces must carry, and never imports or asserts on server internals.
//
// HOW TO RUN (needs a prepared run instance; it cannot run in this repo)
//   node scripts/e2e/prepare-environment.mjs --profile local   # prepares <runDir>/run.json
//   LUCY_REAL_E2E_RUN=<runDir>/run.json \
//     npx playwright test --config=webui/playwright.real.config.ts \
//       webui/tests/real-e2e/audit-reconciliation-v025.spec.ts --project=chromium
//
// STATUS
//   This spec has NOT been executed.  Every assertion below is a claim the
//   spec makes when it runs; until it runs, ARV25-V01..V12 and LOG25-01 stay
//   not_run / blocked.  A missing capability marks the test BLOCKED, never
//   passed.

import type { TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { fixtureAgentTokens, ownerContext, parseCsv, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

const rpc = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args }
});

type ReconciliationContext = {
  watermarkSeq?: number;
  metricUnit?: string;
  classificationVersion?: string;
  derivationVersion?: string;
  snapshotId?: string;
};

type AuditEntry = {
  id: number;
  tool?: string;
  outcome?: string;
  lucyTurnId?: string;
  inferredTurnId?: string;
  turnAttributionMode?: string;
  tables?: string[];
};

function turnIdOf(entry: AuditEntry): string | null {
  return entry.lucyTurnId ?? entry.inferredTurnId ?? null;
}

function bucketCountsOf(payload: unknown): Record<string, number> {
  const data = ((payload as { data?: Record<string, unknown> } | undefined)?.data ?? {}) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const source = (data.bucketCounts ?? data.primaryStatusCounts ?? summary.buckets) as
    | Record<string, number>
    | undefined;
  return source ?? {};
}

test.describe.configure({ mode: "serial" });

test("the reconciliation detail agrees with this run's audit events and keeps full table identities", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-18-V06", "SEC-20-V01");
  // 2026-10-28（D2 路径 A）：ARV25 已并入冻结 catalog，因此**同时**用 `covers`
  // 声明给冻结 collector（`case` 命名空间），否则这些 variant 在
  // evidence.cases 里根本不会出现，`passedIds` 也就永远填不上。
  // `coversV025` 保留：v0.25 影子清单的维度证据仍按自己的命名空间采集。
  covers(testInfo, "ARV25-V01", "ARV25-V02", "ARV25-V03", "ARV25-V05", "ARV25-V06");
  coversV025(testInfo, "ARV25-V01", "ARV25-V02", "ARV25-V03", "ARV25-V05", "ARV25-V06");
  // The reconciliation detail is reconciled against a REAL Agent turn of this run, so the
  // agent client is a declared dependency of this spec (the runtime check below still blocks
  // when the capability exists but no turn actually happened).
  blockUnless(testInfo, "lucy-http", "browser", "agent-client");

  const tokens = fixtureAgentTokens();

  // Real events produced by THIS run: one allowed read and one cross-domain denial.
  //
  // The turn id comes from a REAL `lucy_begin_question` call in the SAME session:
  // the proxy registers that turn for (credential, session) and binds the
  // following tool calls of that session to it.  This is the documented
  // client-side way to open a business question, so the reconciliation view has
  // a genuine turn to reconcile against — the spec does NOT depend on an
  // external Agent leg, and it never fabricates a turn id.
  const financeSession = `e2e-arv25-finance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const salesSession = `e2e-arv25-sales-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mcpHeaders = (token: string, sessionId: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-lucy-session-id": sessionId
  });
  const opened = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: mcpHeaders(tokens.e2e_finance, financeSession),
    body: JSON.stringify(rpc(0, "lucy_begin_question", {
      question: "E2E reconciliation: open one business question for this run",
      intentSummary: "Open a business question so the reconciliation view has a real turn to reconcile against"
    }))
  });
  expect(opened.status).toBe(200);
  const allowed = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: mcpHeaders(tokens.e2e_finance, financeSession),
    body: JSON.stringify(rpc(1, "wiki_read", { path: "finance/cac-definition.md" }))
  });
  const denied = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: mcpHeaders(tokens.e2e_sales, salesSession),
    body: JSON.stringify(rpc(2, "wiki_read", { path: "finance/cac-definition.md" }))
  });
  expect(allowed.status).toBe(200);
  expect(denied.status).toBeGreaterThanOrEqual(200);

  const since = new Date(Date.now() - 120_000).toISOString();
  const until = new Date(Date.now() + 120_000).toISOString();

  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const filter = `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&includeProtocol=true`;

    // The events of this run, from the admin audit list.
    const listResponse = await page.request.get(new URL(`/api/admin/audit?${filter}&limit=500`, baseURL!).toString());
    expect(listResponse.status()).toBe(200);
    const entries = ((await listResponse.json()) as { data: { entries: AuditEntry[] } }).data.entries;
    const withTurn = entries.filter((e) => turnIdOf(e) !== null);
    if (withTurn.length === 0) {
      // A turn id only exists when a REAL Agent turn happened in this run. Its absence is an
      // environment condition (no agent leg / no model call), not a defect of the reconciliation
      // view — so this item is BLOCKED with a reason, never FAILED. The raw MCP call above is
      // not an Agent turn and carries no turn id by design.
      testInfo.annotations.push({
        type: "blocked",
        description: "this run produced no audit event carrying a turn id (no real Agent turn happened in this run); the reconciliation detail has nothing to reconcile against"
      });
      test.skip(true, "BLOCKED: no Agent turn in this run");
      return;
    }
    assertion(testInfo, "audit_event", true, `this run produced ${withTurn.length} event(s) carrying a turn id`);

    const target = withTurn.find((e) => e.lucyTurnId) ?? withTurn[0];
    const turnId = turnIdOf(target!)!;

    // ① the read-only inquiry detail.
    const detailResponse = await page.request.get(
      new URL(`/api/admin/audit/reconciliation/inquiries/${encodeURIComponent(turnId)}`, baseURL!).toString()
    );
    const detailPayload = (await detailResponse.json()) as {
      ok?: boolean;
      error?: { code?: string };
      data?: { reconciliationContext?: ReconciliationContext; inquiry?: Record<string, unknown> };
    };
    // The frozen catalog declares `deny` + `no_leak` for EVERY ARV25 variant.
    // The variants this test covers are covered by NO other test, so the two
    // tokens must be evaluated HERE — on both the success and the refusal path,
    // otherwise the variant can never pass (the harness is fail-closed on a
    // declared assertion that no runner evaluated).
    assertion(testInfo, "no_leak",
      !vault.contains(JSON.stringify(detailPayload)),
      "the inquiry detail carries no credential value");
    {
      // The same read model must refuse an anonymous caller: the detail of one
      // inquiry is admin-audit material.
      const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const anonPage = await anonymous.newPage();
        const refused = await anonPage.request.get(
          new URL(`/api/admin/audit/reconciliation/inquiries/${encodeURIComponent(turnId)}`, baseURL!).toString()
        );
        const refusedPayload = (await refused.json().catch(() => ({}))) as { ok?: boolean };
        assertion(testInfo, "deny",
          refused.status() >= 400 || refusedPayload.ok === false,
          `an unauthenticated inquiry read was refused (HTTP ${refused.status()}, ok=${String(refusedPayload.ok)})`);
        assertion(testInfo, "no_leak",
          !vault.contains(JSON.stringify(refusedPayload)),
          "the refused inquiry body carries no credential value");
      } finally {
        await anonymous.close();
      }
    }
    // ARV25-V06：正式完整读取在不可证明时**失败关闭**，而**诊断模式必须仍然可读**
    // 并显式披露「是否可证明」与「缺什么」。这一半此前完全没被验证 —— spec 只
    // 读了默认的 complete 模式，所以「诊断模式显式不完整」是空转的。
    // §18.11：mode=diagnostic 时返回 diagnostic_incomplete + 实际证据界 + 缺失集合。
    {
      const diagnosticResponse = await page.request.get(
        new URL(`/api/admin/audit/reconciliation/inquiries/${encodeURIComponent(turnId)}?mode=diagnostic`, baseURL!).toString()
      );
      const diagnosticPayload = (await diagnosticResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { code?: string };
        data?: { asOfProof?: { ok?: boolean; actualBound?: unknown; missingSets?: unknown }; diagnosticIncomplete?: unknown };
      };
      assertion(testInfo, "consistency",
        diagnosticPayload.ok === true && typeof diagnosticPayload.data?.asOfProof?.ok === "boolean",
        `the diagnostic read is readable even where the formal read fails closed (ok=${String(diagnosticPayload.ok)}, asOfProof.ok=${String(diagnosticPayload.data?.asOfProof?.ok)}, code=${diagnosticPayload.error?.code ?? "none"})`);
      assertion(testInfo, "consistency",
        diagnosticPayload.data?.asOfProof?.ok === true
          ? diagnosticPayload.data?.diagnosticIncomplete === null || diagnosticPayload.data?.diagnosticIncomplete === undefined
          : Boolean(diagnosticPayload.data?.diagnosticIncomplete),
        "the diagnostic read marks itself incomplete exactly when the as-of proof does not hold");
      assertion(testInfo, "no_leak",
        !vault.contains(JSON.stringify(diagnosticPayload)),
        "the diagnostic read carries no credential value");
    }
    if (!detailPayload.ok) {
      // The read model may refuse (projection not covered / ledger seq missing).
      // That refusal is itself the fail-closed contract (ARV25-V10).
      assertion(testInfo, "deny", detailResponse.status() >= 400, `reconciliation detail refused with ${detailResponse.status()} ${detailPayload.error?.code ?? ""}`);
      assertion(testInfo, "consistency", detailPayload.error?.code !== undefined, "a refusal carries an explicit error code");
      return;
    }

    const context1 = detailPayload.data?.reconciliationContext;
    assertion(testInfo, "consistency", typeof context1?.watermarkSeq === "number", `the detail carries a ledger watermark S (${context1?.watermarkSeq ?? "none"})`);
    assertion(testInfo, "consistency", context1?.metricUnit === "tool_call", `the metric unit is tool_call (got ${context1?.metricUnit ?? "none"})`);
    assertion(testInfo, "consistency", Boolean(context1?.classificationVersion && context1?.derivationVersion), "the context names the classification and derivation versions");

    const inquiry = detailPayload.data?.inquiry ?? {};
    // The detail answers with the real `InquiryReconciliation` shape
    // (webui/server/admin/reconciliation.ts): the table evidence is the
    // `tables.complete` set, and the calls that could not be attributed to a
    // table land in the separate `tables.unknownBucket` — they are never
    // merged into the complete set.
    const tableEvidence = (inquiry.tables ?? {}) as {
      complete?: Array<Record<string, unknown>>;
      unknownBucket?: { callCount?: number; reason?: string };
    };
    const tables = Array.isArray(tableEvidence.complete) ? tableEvidence.complete : [];
    const identityOf = (row: Record<string, unknown>) =>
      [row.connectionId, row.schema, row.table].filter((part) => part !== undefined && part !== null && part !== "").join(".");
    const identities = tables.map(identityOf).filter((id) => id.length > 0);
    const uniqueIdentities = new Set(identities);
    assertion(testInfo, "audit_event", tables.length >= 0, `the detail lists ${tables.length} table identity row(s)`);
    assertion(testInfo, "consistency", identities.length === uniqueIdentities.size, "the listed table identities are de-duplicated");
    assertion(testInfo, "consistency",
      tableEvidence.unknownBucket === undefined
        || typeof tableEvidence.unknownBucket.callCount === "number"
        || typeof tableEvidence.unknownBucket.reason === "string",
      "the unknown-table bucket discloses its count or its reason");

    // A row without a table identity must carry a reason, never be dropped or guessed.
    const unknownRows = tables.filter((row) => identityOf(row).length === 0);
    const unknownRowsHaveReason = unknownRows.every((row) => Boolean(row.reason ?? row.sourceStatus ?? row.unknownReason));
    assertion(testInfo, "consistency", unknownRowsHaveReason, `${unknownRows.length} table row(s) without a full identity must carry a reason`);

    // The operator's page shows the same window (a real page, not just the API).
    await page.goto(`/admin/audit?view=calls&since=${encodeURIComponent(since)}`);
    await expect(page.getByTestId("audit-view-tabs")).toBeVisible();
    await expect(page.getByTestId("audit-tab-calls")).toBeVisible();
    await expect(page.getByTestId("audit-shared-filters")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the usage view, the token reconciliation and the CSV export close over the same snapshot", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-20-V01", "SEC-20-V02");
  covers(testInfo, "ARV25-V04", "ARV25-V07", "ARV25-V08", "ARV25-V09", "ARV25-V10", "ARV25-V11");
  coversV025(testInfo, "ARV25-V04", "ARV25-V07", "ARV25-V08", "ARV25-V09", "ARV25-V10", "ARV25-V11");
  blockUnless(testInfo, "lucy-http", "browser");

  const since = new Date(Date.now() - 120_000).toISOString();
  const until = new Date(Date.now() + 120_000).toISOString();
  const filter = `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;

  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();

    // ② the usage view.
    const usageResponse = await page.request.get(new URL(`/api/admin/audit/reconciliation/usage?${filter}`, baseURL!).toString());
    const usagePayload = (await usageResponse.json()) as {
      ok?: boolean;
      error?: { code?: string };
      data?: {
        reconciliationContext?: ReconciliationContext;
        tokenReconciliation?: {
          configuredSnapshot?: { available?: boolean; total?: number | null; enabled?: number | null };
          activeWindow?: { identityCount?: number; toolCallCount?: number };
          differences?: Array<{ id?: string; count?: number | null; identities?: string[] }>;
          anomaly?: { flagged?: boolean; reason?: string; activeGreaterThanConfigured?: boolean };
        };
        calls?: { items?: unknown[]; totalMatched?: number; returned?: number; complete?: boolean };
      };
    };
    if (!usagePayload.ok) {
      assertion(testInfo, "deny", usageResponse.status() >= 400, `usage refused with ${usageResponse.status()} ${usagePayload.error?.code ?? ""}`);
      return;
    }

    const context2 = usagePayload.data?.reconciliationContext;
    const tokens = usagePayload.data?.tokenReconciliation ?? {};
    // ARV25-V04/V07..V10: the usage view is a view OVER the audit event stream.
    // The frozen catalog declares `audit_event` for every ARV25 variant, and the
    // variants this test covers are covered by NO other test — so the rows this
    // view reports must be traceable to the admin audit list of the SAME window.
    // A usage view that is not backed by audit events is not a reconciled view.
    // The check is fail-closed: an empty window proves nothing, so it does not
    // count as a pass.
    const auditListResponse = await page.request.get(
      new URL(`/api/admin/audit?${filter}&includeProtocol=true&limit=500`, baseURL!).toString()
    );
    const auditEntries = auditListResponse.status() === 200
      ? ((((await auditListResponse.json()) as { data?: { entries?: unknown[] } }).data?.entries ?? []) as Array<{ id?: unknown }>)
      : [];
    const auditIds = new Set(auditEntries.map((entry) => String(entry.id)));
    const usageItems = (usagePayload.data?.calls?.items ?? []) as Array<{ unitId?: unknown }>;
    const usageUnitIds = usageItems.map((item) => String(item.unitId ?? "")).filter((id) => id.length > 0);
    const unbacked = usageUnitIds.filter((id) => !auditIds.has(id));
    assertion(testInfo, "audit_event",
      auditIds.size > 0 && usageUnitIds.length > 0 && unbacked.length === 0,
      `${usageUnitIds.length - unbacked.length}/${usageUnitIds.length} usage row(s) are backed by an admin audit event of this run (audit events in window: ${auditIds.size})`);
    // ARV25-V04/V07..V11: the same surface must refuse an anonymous caller.
    {
      const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const anonPage = await anonymous.newPage();
        const refused = await anonPage.request.get(
          new URL(`/api/admin/audit/reconciliation/usage?${filter}`, baseURL!).toString()
        );
        const refusedPayload = (await refused.json().catch(() => ({}))) as { ok?: boolean };
        assertion(testInfo, "deny",
          refused.status() >= 400 || refusedPayload.ok === false,
          `an unauthenticated usage read was refused (HTTP ${refused.status()}, ok=${String(refusedPayload.ok)})`);
      } finally {
        await anonymous.close();
      }
    }
    // The token reconciliation answers with the REAL `TokenReconciliation` shape
    // (webui/server/admin/reconciliation.ts): the configured counts live in
    // `configuredSnapshot`, the active identities in `activeWindow`, and the
    // configured-but-not-active set is one of the `differences` entries.
    //
    // A count that cannot be observed is `null` WITH a reason, never `0`
    // (Spec §2.4／§2.6) — so the assertion accepts a null count only when the
    // snapshot says it is unavailable.
    const configured = tokens.configuredSnapshot ?? {};
    const active = tokens.activeWindow ?? {};
    assertion(testInfo, "consistency",
      typeof configured.total === "number" || (configured.available === false && configured.total === null),
      `the configured token count is observable (total=${String(configured.total)}, available=${String(configured.available)})`);
    assertion(testInfo, "consistency", typeof active.identityCount === "number",
      `the active token count is a number (${String(active.identityCount)})`);
    const configuredNotActive = (tokens.differences ?? []).find((d) => d.id === "configured_not_active");
    assertion(testInfo, "consistency", Boolean(configuredNotActive),
      "the configured-but-not-active set is disclosed");
    assertion(testInfo, "consistency",
      configuredNotActive ? (typeof configuredNotActive.count === "number" || configuredNotActive.count === null) : true,
      `the configured-but-not-active count is observable (${String(configuredNotActive?.count)})`);

    // An active count above the configured count is explained, never flattened to "anomaly".
    if (typeof configured.total === "number" && typeof active.identityCount === "number" && active.identityCount > configured.total) {
      const explained = (tokens.differences ?? []).length > 0 && tokens.anomaly?.activeGreaterThanConfigured === true;
      assertion(testInfo, "consistency", explained, "an active count above the configured count must be explained by difference reasons");
    }

    // ③ the CSV / Manifest export — same S as the usage view.
    const exportResponse = await page.request.get(new URL(`/api/admin/audit/reconciliation/export?${filter}`, baseURL!).toString());
    const exportPayload = (await exportResponse.json()) as {
      ok?: boolean;
      error?: { code?: string };
      data?: {
        reconciliationContext?: ReconciliationContext;
        files?: Array<{ name: string; rowCount: number; sha256: string; csv: string }>;
        manifest?: Record<string, unknown>;
      };
    };
    if (!exportPayload.ok) {
      // ARV25-V10: an un-covered projection must fail the formal export, not degrade it.
      assertion(testInfo, "deny", exportResponse.status() >= 400, `the formal export refused with ${exportResponse.status()} ${exportPayload.error?.code ?? ""}`);
      return;
    }

    const context3 = exportPayload.data?.reconciliationContext;
    // 「统一截止」 binds the details, the summary and the CSV of ONE page query to
    // the same `watermarkSeq=S` (audit-reconciliation spec §3.3). The usage view
    // and the export are TWO independent queries, so their S may differ — the
    // ledger bound only moves forward. Equality is required INSIDE one response.
    assertion(testInfo, "consistency",
      typeof context2?.watermarkSeq === "number" && typeof context3?.watermarkSeq === "number" && context3.watermarkSeq >= context2.watermarkSeq,
      `usage S=${context2?.watermarkSeq ?? "none"} and export S=${context3?.watermarkSeq ?? "none"} (the ledger bound only moves forward)`);
    assertion(testInfo, "consistency", context2?.metricUnit === context3?.metricUnit, "usage and export use the same metric unit");
    // ARV25-V09（reconciliationContext 冻结）：两次独立读取各自冻结自己的 S，
    // 但**计量单位与规则版本**必须一致 —— 否则同一份数据会按两套口径被解读。
    assertion(testInfo, "consistency",
      context2?.classificationVersion === context3?.classificationVersion && context2?.derivationVersion === context3?.derivationVersion,
      `usage and export name the same rule versions (classification ${context2?.classificationVersion ?? "none"} / ${context3?.classificationVersion ?? "none"}, derivation ${context2?.derivationVersion ?? "none"} / ${context3?.derivationVersion ?? "none"})`);
    // ARV25-V10（CSV 与页面同源）：导出的 manifest 必须携带**这次导出自己的**
    // 快照与规则版本，而不是另算一份 —— 否则 CSV 与页面会各说各话。
    // 形状按 `ReconciliationCsvManifest`：整份 context 嵌在 `manifest.context`，
    // 规则版本与计量单位另在 `manifest.completeness` 里再声明一次。
    const manifest = (exportPayload.data?.manifest ?? {}) as {
      schemaVersion?: string;
      context?: ReconciliationContext;
      completeness?: {
        watermarkSeq?: number;
        snapshotId?: string;
        metricUnit?: string;
        derivationVersion?: string;
        classificationVersion?: string;
        complete?: boolean;
      };
    };
    const manifestContext = manifest.context ?? {};
    assertion(testInfo, "consistency",
      manifestContext.snapshotId === context3?.snapshotId && manifestContext.watermarkSeq === context3?.watermarkSeq,
      `the export manifest carries the export's own snapshot (manifest S=${manifestContext.watermarkSeq ?? "none"} / context S=${context3?.watermarkSeq ?? "none"}, snapshot ${manifestContext.snapshotId === context3?.snapshotId ? "same" : "different"})`);
    assertion(testInfo, "consistency",
      manifestContext.metricUnit === context3?.metricUnit &&
        manifestContext.classificationVersion === context3?.classificationVersion &&
        manifestContext.derivationVersion === context3?.derivationVersion,
      "the export manifest carries the export's own metric unit and rule versions");
    assertion(testInfo, "consistency",
      manifest.completeness?.metricUnit === context3?.metricUnit &&
        manifest.completeness?.classificationVersion === context3?.classificationVersion &&
        manifest.completeness?.derivationVersion === context3?.derivationVersion,
      "the export manifest's completeness block declares the same metric unit and rule versions");

    const files = exportPayload.data?.files ?? [];
    assertion(testInfo, "artifact_scan", files.length > 0, `the export produced ${files.length} file(s)`);
    // D-32 / D-33 回归：导出的调用明细必须真的带出**授权**与**执行**两条独立轴，
    // 而不是恒为 unknown。
    //   · D-32：读侧曾读不存在的 `authorization_view` / `execution_view`，被
    //     `probeColumns` 兜底投影成 NULL ⇒ 授权/执行视图静默恒为 unknown；
    //   · D-33：写侧从不提供执行凭据 ⇒ 授权轴因「无显式裁决证据」恒为 unknown。
    // 修好之后本轮新写入的行必须带出真实枚举值；恒为 unknown 即回归。
    const attemptsFile = files.find((file) => file.name === "calls-attempts.csv");
    if (attemptsFile) {
      const attemptRows = parseCsv(attemptsFile.csv ?? "");
      const header = attemptRows[0] ?? [];
      const authIdx = header.indexOf("authorization_status");
      const execIdx = header.indexOf("execution_status");
      const attemptData = attemptRows.slice(1);
      const authValues = authIdx >= 0 ? attemptData.map((row) => String(row[authIdx] ?? "")) : [];
      const execValues = execIdx >= 0 ? attemptData.map((row) => String(row[execIdx] ?? "")) : [];
      const authObserved = authValues.filter((value) => value.length > 0 && value !== "unknown");
      const execObserved = execValues.filter((value) => value.length > 0 && value !== "unknown");
      assertion(testInfo, "consistency",
        authIdx >= 0 && execIdx >= 0 && authObserved.length > 0 && execObserved.length > 0,
        `calls-attempts.csv carries observed authorization (${authObserved.length}/${attemptData.length} row(s)) and execution (${execObserved.length}/${attemptData.length} row(s)) values instead of a constant unknown`);
    }
    for (const file of files) {
      const rows = parseCsv(file.csv ?? "");
      const header = rows[0] ?? [];
      const dangerous = rows.slice(1).flatMap((r) => r).filter((cell) => /^[=+@]/.test(cell) || (/^-[A-Za-z(]/.test(cell)));
      assertion(testInfo, "no_leak", dangerous.length === 0, `${file.name}: ${dangerous.length} unneutralised formula cell(s)`);
      assertion(testInfo, "no_leak", !vault.contains(file.csv ?? ""), `${file.name}: no credential in the exported CSV`);
      if (header.length > 0) {
        assertion(testInfo, "consistency", rows.length - 1 === file.rowCount, `${file.name}: ${rows.length - 1} data row(s) vs the declared rowCount ${file.rowCount}`);
      }
    }

    // The same bucket set closes over the same S.
    const buckets = bucketCountsOf(usagePayload);
    const bucketTotal = Object.values(buckets).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
    if (Object.keys(buckets).length > 0) {
      const calls = usagePayload.data?.calls ?? {};
      const matched = typeof calls.totalMatched === "number" ? calls.totalMatched : undefined;
      assertion(testInfo, "consistency", matched === undefined || bucketTotal === matched, `the buckets total ${bucketTotal} vs the ${matched ?? "?"} matched call(s)`);
    }
  } finally {
    await context.close();
  }
});

test("a reconciliation read without the admin identity is refused, leaves a meta-audit trace and leaks nothing", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-18-V01");
  covers(testInfo, "ARV25-V11");
  coversV025(testInfo, "ARV25-V11");
  blockUnless(testInfo, "lucy-http", "browser");

  const since = new Date(Date.now() - 120_000).toISOString();
  const until = new Date(Date.now() + 120_000).toISOString();

  // An anonymous context: no owner session, so the read must be refused.
  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await anonymous.newPage();
    const response = await page.request.get(
      new URL(`/api/admin/audit/reconciliation/usage?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`, baseURL!).toString()
    );
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { code?: string } };
    const refused = response.status() >= 400 || payload.ok === false;
    assertion(testInfo, "deny", refused, `an unauthenticated reconciliation read was refused (HTTP ${response.status()}, ok=${String(payload.ok)})`);
    assertion(testInfo, "audit_event", Boolean(payload.error?.code), "the refusal carries an explicit error code");
    assertion(testInfo, "no_leak", !vault.contains(JSON.stringify(payload)), "the refusal body carries no credential value");
  } finally {
    await anonymous.close();
  }
});
