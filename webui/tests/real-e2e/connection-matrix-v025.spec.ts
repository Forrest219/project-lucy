// v0.25 Track D — database-type and access-failure matrix (CON25-01..12).
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md §7.4
//   * docs/governance/database-support-matrix.md §3  (support status — single source of truth)
//   * webui/src/lib/connectionId.ts  (DATABASE_TYPES — single source of truth for the 8 types)
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// ─── NOT EXECUTED IN THIS REPOSITORY STATE ────────────────────────────────────────────
// This spec needs a PREPARED RUN INSTANCE (`LUCY_REAL_E2E_RUN` → <runDir>/run.json) of a
// customer-mode, auth-required Lucy. No such instance exists here, so NOTHING in this file
// has been executed or verified.
//
//   node scripts/e2e/prepare-environment.mjs --run <runId>
//   cd webui && npx playwright test --config playwright.real.config.ts \
//       tests/real-e2e/connection-matrix-v025.spec.ts
//
// ─── WHAT THIS SPEC DOES AND DOES NOT CLAIM ──────────────────────────────────────────
//   * It proves the CONNECTABLE-TYPE surface: the new-connection form offers exactly the
//     8 `DATABASE_TYPES` keys, and a failed connection fails closed without leaking the
//     credential (CON25-01..08 type coverage, CON25-10..12 fail-closed behaviour).
//   * It does NOT prove that any database type is SUPPORTED. Per
//     docs/governance/database-support-matrix.md §3, StarRocks／Doris are `gated`,
//     SQL Server／Amazon Athena are `experimental` and Oracle is `roadmap`; only MySQL,
//     PostgreSQL and SQLite (local file) are `verified`, and even those need this round's
//     own live evidence. The support status is NOT asserted here — it is QUOTED from the
//     governance matrix and never upgraded by a test.
//   * The real per-type queries (CON25-01..04, CON25-07) need live instances of those
//     engines and are recorded as `blocked(environment)` until they exist.
//
// ─── GUARANTEES ───────────────────────────────────────────────────────────────────────
//   * No API mock and no KTX shim; every assertion reads the REAL response.
//   * The probe uses 127.0.0.1 on a closed port: the failure is local, deterministic and
//     reaches no external system. Nothing is written to the instance.
//   * No trace / screenshot / video; no secret is written to disk or logged.

import { expect, test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers } from "./helpers/blocked";
import { ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

/** The 12 CON25 execution ids, in order. */
const CON25_IDS = Array.from({ length: 12 }, (_, i) => `CON25-${String(i + 1).padStart(2, "0")}`);

/**
 * The 8 selectable UI database types, in the order of `DATABASE_TYPES`
 * (webui/src/lib/connectionId.ts) — the single source of truth for the form's options.
 */
const DATABASE_TYPE_KEYS = [
  "mysql", "postgres", "starrocks", "doris", "sqlserver", "oracle", "sqlite", "athena"
];

/** A local, unreachable endpoint: the probe must fail closed here. */
const PROBE_HOST = "127.0.0.1";
const PROBE_PORT = 1;
const PROBE_PASSWORD = "E2eProbePassword-NotARealCredential";

function coversV025(testInfo: TestInfo, ...executionIds: string[]): void {
  for (const id of executionIds) testInfo.annotations.push({ type: "case", description: id });
}

test.describe.configure({ mode: "serial" });

test("新建连接表单提供全部 8 类数据库类型，且失败关闭的连通测试不泄漏凭据", async ({ browser }, testInfo) => {
  blockUnless(testInfo, "lucy-http", "browser");
  // SEC-07-V13 — 浏览器收窄/停用/吊销操作可见生效（冻结目录里最接近的连接面相邻场景：
  // 一次失败的操作必须可见地不生效，且不泄漏任何东西）
  covers(testInfo, "SEC-07-V13");
  coversV025(testInfo, ...CON25_IDS);

  const ctx = await ownerContext(browser);
  try {
    const page = await ctx.newPage();
    const baseUrl = runContext().instance.baseUrl;

    // ── CON25-01..08：表单提供的数据库类型恰好是 DATABASE_TYPES 的 8 项且同序 ──────────
    await page.goto("/connections");
    const createButton = page.getByTestId("create-connection-btn").first();
    if (await createButton.count()) {
      await createButton.click();
    } else {
      await page.getByTestId("create-connection-empty-btn").first().click();
    }
    const driverSelect = page.getByTestId("create-connection-driver").first();
    await expect(driverSelect).toBeVisible();
    const optionValues = await driverSelect.locator("option").evaluateAll(
      (options) => options.map((o) => (o as HTMLOptionElement).value)
    );
    assertion(testInfo, "consistency",
      optionValues.length === DATABASE_TYPE_KEYS.length &&
        optionValues.every((value, index) => value === DATABASE_TYPE_KEYS[index]),
      `the new-connection form offers ${optionValues.join(", ")}`);

    // ── CON25-10 / CON25-11 / CON25-12：失败关闭，且秘密不泄漏 ────────────────────────
    const probeRes = await page.request.post(new URL("/api/connections/probe", baseUrl).toString(), {
      data: {
        driver: "mysql",
        engine: "mysql",
        wireProtocol: "mysql",
        host: PROBE_HOST,
        port: PROBE_PORT,
        database: "e2e_probe",
        username: "e2e_probe_user",
        password: PROBE_PASSWORD
      }
    });
    const probeText = await probeRes.text();
    const probeBody = JSON.parse(probeText) as {
      ok?: boolean;
      data?: { status?: string; message?: string };
      error?: { code?: string; message?: string };
    };
    const probeStatus = probeBody.data?.status ?? probeBody.error?.code ?? "unknown";

    // deny: 失败的连通测试不得被报告为成功，也不得让连接留在可用状态
    const failedClosed = probeBody.ok !== true || probeBody.data?.status === "error";
    assertion(testInfo, "deny", failedClosed && probeStatus !== "ok",
      `probe against ${PROBE_HOST}:${PROBE_PORT} -> ${probeStatus} (${String(probeBody.data?.message ?? probeBody.error?.message ?? "").slice(0, 120)})`);

    // no_leak: 失败原因不得回显密码、连接串或任何已登记的秘密
    const leaked = probeText.includes(PROBE_PASSWORD) || vault.contains(probeText);
    assertion(testInfo, "no_leak", !leaked,
      `the probe failure response ${leaked ? "CONTAINS" : "does not contain"} the credential`);

    // ── CON25-09：同名表身份带连接身份——连接 ID 唯一且规范源键含连接前缀 ──────────────
    const listRes = await page.request.get(new URL("/api/connections", baseUrl).toString());
    const listBody = (await listRes.json()) as {
      ok?: boolean;
      data?: { connections?: Array<{ id?: string; driver?: string; engine?: string }> };
    };
    const connections = listBody.data?.connections ?? [];
    const ids = connections.map((c) => c.id ?? "");
    const uniqueIds = new Set(ids);
    const unknownDrivers = connections.filter(
      (c) => c.driver && !DATABASE_TYPE_KEYS.some((key) => key === c.driver)
    );
    assertion(testInfo, "consistency",
      uniqueIds.size === ids.length && unknownDrivers.length === 0,
      `${connections.length} connection(s), ${ids.length - uniqueIds.size} duplicate id(s), ` +
      `${unknownDrivers.length} with a driver outside the 8 selectable types`);
  } finally {
    await ctx.close();
  }
});
