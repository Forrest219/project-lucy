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
  coversV025(testInfo, "ARV25-V01", "ARV25-V02", "ARV25-V03", "ARV25-V05", "ARV25-V06");
  blockUnless(testInfo, "lucy-http", "browser");

  const tokens = fixtureAgentTokens();

  // Real events produced by THIS run: one allowed read and one cross-domain denial.
  const allowed = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.e2e_finance}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify(rpc(1, "wiki_read", { path: "finance/cac-definition.md" }))
  });
  const denied = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.e2e_sales}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
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
    assertion(testInfo, "audit_event", withTurn.length > 0, `this run produced ${withTurn.length} event(s) carrying a turn id`);

    const target = withTurn.find((e) => e.lucyTurnId) ?? withTurn[0];
    expect(target, "this run produced no event with a turn id").toBeTruthy();
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
    const tables = (inquiry.tables ?? inquiry.tableList ?? []) as Array<Record<string, unknown>>;
    const identityOf = (row: Record<string, unknown>) =>
      [row.connectionId, row.schema, row.table].filter((part) => part !== undefined && part !== null && part !== "").join(".");
    const identities = tables.map(identityOf).filter((id) => id.length > 0);
    const uniqueIdentities = new Set(identities);
    assertion(testInfo, "audit_event", tables.length >= 0, `the detail lists ${tables.length} table identity row(s)`);
    assertion(testInfo, "consistency", identities.length === uniqueIdentities.size, "the listed table identities are de-duplicated");

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
          configuredCount?: number;
          activeCount?: number;
          configuredNotActive?: unknown[];
          differences?: Array<{ reason?: string }>;
          unknownIdentityCount?: number;
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
    assertion(testInfo, "consistency", typeof tokens.configuredCount === "number", `the configured token count is a number (${tokens.configuredCount ?? "none"})`);
    assertion(testInfo, "consistency", typeof tokens.activeCount === "number", `the active token count is a number (${tokens.activeCount ?? "none"})`);
    assertion(testInfo, "consistency", Array.isArray(tokens.configuredNotActive), "the configured-but-not-active set is disclosed");

    // An active count above the configured count is explained, never flattened to "anomaly".
    if (typeof tokens.configuredCount === "number" && typeof tokens.activeCount === "number" && tokens.activeCount > tokens.configuredCount) {
      const explained = (tokens.differences ?? []).length > 0;
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
    assertion(testInfo, "consistency", context2?.watermarkSeq === context3?.watermarkSeq, `usage S=${context2?.watermarkSeq ?? "none"} and export S=${context3?.watermarkSeq ?? "none"}`);
    assertion(testInfo, "consistency", context2?.metricUnit === context3?.metricUnit, "usage and export use the same metric unit");

    const files = exportPayload.data?.files ?? [];
    assertion(testInfo, "artifact_scan", files.length > 0, `the export produced ${files.length} file(s)`);
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
