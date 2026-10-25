// ROW25 — the browser dimension of the W2-ACCESS responsibility branch (Plan §5.3).
//
// Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §9
//   (V08–V13, V20–V21) — the management-console preview of the final row
//   constraints and the runtime that must agree with it.
// The permission algebra is NOT re-implemented here: this spec drives the real
//   POST /api/admin/roles/preview-row-policy route
//   (webui/server/admin/row-policy-routes.ts) and the real MCP data plane, and
//   asserts their contract.
//
// covers() links the FROZEN catalog ids that the approved coverage manifest
//   assigns to the ACCESS branch and whose declared assertion tokens this
//   spec's assertions really evaluate
//   (scripts/e2e/contracts/v025-coverage.yaml → existingCatalogMappings).
//   ROW25-V01..V22 are NEW scenarios: they are not in the frozen catalog
//   (case-catalog.yaml is frozen and must not gain rows), so each test records
//   them in an `execution` annotation for the v0.25 result writer.
//
// NOT EXECUTED in the authoring environment — there is no prepared run instance
//   here. The command that runs it:
//   cd webui && LUCY_REAL_E2E_RUN=<runDir>/run.json \
//     npx playwright test --config playwright.real.config.ts tests/real-e2e/row-policy-v025.spec.ts
//   (the instance itself comes from scripts/e2e/prepare-environment.mjs).

import { test, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { fixtureAgentTokens, mcpCall, ownerContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

test.describe.configure({ mode: "serial" });

const FIN = { connection: "fin-db", schema: "analytics", name: "marketing_daily" };
const FIN_ORDERS = { connection: "fin-db", schema: "analytics", name: "orders_masked" };

/** The scope of a query that returns the region dimension of marketing_daily. */
const REGION_QUERY = {
  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["spend_cents"],
  dimensions: ["region"]
};

type McpResult = { status: number; text: string };

/** The JSON-RPC envelope of a tools/call answer, with the tool payload parsed. */
function readToolPayload(res: McpResult): { ok: boolean; rows: Array<Record<string, unknown>>; raw: string } {
  let envelope: {
    result?: { content?: Array<{ type?: string; text?: string }> };
    error?: { message?: string };
  };
  try {
    envelope = JSON.parse(res.text) as typeof envelope;
  } catch {
    return { ok: false, rows: [], raw: res.text };
  }
  if (envelope.error) return { ok: false, rows: [], raw: res.text };
  const first = envelope.result?.content?.[0];
  const raw = first?.text ?? "";
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown };
    return {
      ok: true,
      rows: Array.isArray(parsed.rows) ? (parsed.rows as Array<Record<string, unknown>>) : [],
      raw
    };
  } catch {
    return { ok: false, rows: [], raw };
  }
}

/** The distinct region values of a query result; empty when the shape is unknown. */
function regionsOf(rows: Array<Record<string, unknown>>): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === "region" && typeof value === "string") found.add(value);
    }
  }
  return [...found].sort();
}

/** Runs one real MCP lucy_query and returns the distinct region values it saw. */
async function queryRegions(token: string): Promise<{ regions: string[]; raw: string; ok: boolean }> {
  const res = await mcpCall(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "lucy_query", arguments: REGION_QUERY }
  });
  const parsed = readToolPayload(res);
  return { regions: regionsOf(parsed.rows), raw: parsed.raw, ok: parsed.ok && res.status === 200 };
}

test("the preview of a multi-role grant keeps the OR-of-AND shape and the runtime honours the same union", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-14-V04", "SEC-14-V10");
  coversV025(testInfo, "ROW25-V08", "ROW25-V12");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "agent-client");

  const tokens = fixtureAgentTokens();
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();

    // 1. the committed multi-role grant is readable by the console
    const role = await page.request.get(new URL("/api/admin/roles/finance_east_west", baseURL!).toString());
    assertion(testInfo, "allow_control", role.status() === 200, `the multi-role Role is readable -> ${role.status()}`);

    // 2. the preview of that grant keeps two OR branches and is NOT flattened into one AND
    const preview = await page.request.post(new URL("/api/admin/roles/preview-row-policy", baseURL!).toString(), {
      data: { roleId: "finance_east_west", tables: [FIN] }
    });
    const previewText = await preview.text();
    const previewBody = (() => {
      try {
        return JSON.parse(previewText) as {
          ok?: boolean;
          data?: {
            ok?: boolean;
            candidateDigest?: string;
            tables?: Array<{
              preview?: {
                displayShape?: string;
                roleIds?: string[];
                effectiveRowGrant?: { kind?: string; orArms?: unknown[] };
              } | null;
              error?: string;
            }>;
          };
        };
      } catch {
        return {} as { ok?: boolean; data?: { ok?: boolean; candidateDigest?: string; tables?: Array<{ preview?: { displayShape?: string; roleIds?: string[]; effectiveRowGrant?: { kind?: string; orArms?: unknown[] } } | null; error?: string }> } };
      }
    })();
    const table = previewBody.data?.tables?.[0];
    const shape = table?.preview?.displayShape;
    const orArms = table?.preview?.effectiveRowGrant?.orArms;
    assertion(
      testInfo,
      "allow_control",
      preview.status() === 200 && previewBody.data?.ok === true && shape === "OR-of-AND",
      `preview status=${preview.status()} shape=${shape}`
    );
    assertion(
      testInfo,
      "allow_control",
      Array.isArray(orArms) && orArms.length === 2,
      `the union keeps ${Array.isArray(orArms) ? orArms.length : "no"} OR arms, not one flattened AND`
    );
    assertion(
      testInfo,
      "consistency",
      Boolean(previewBody.data?.candidateDigest) && table?.preview?.roleIds?.includes("finance_east_west") === true,
      `candidateDigest=${previewBody.data?.candidateDigest} roleIds=${JSON.stringify(table?.preview?.roleIds)}`
    );
    assertion(testInfo, "no_leak", !vault.contains(previewText), "the preview carries no credential");

    // 3. the runtime agrees with the preview: the union really covers East AND West
    const union = await queryRegions(tokens.e2e_east_west);
    assertion(
      testInfo,
      "allow_control",
      union.ok && union.regions.includes("East") && union.regions.includes("West"),
      `the multi-role Agent sees ${JSON.stringify(union.regions)}`
    );
    assertion(testInfo, "no_leak", !vault.contains(union.raw), "the query answer carries no credential");
  } finally {
    await context.close();
  }
});

test("a single restricted Role sees only its own rows and never the other Role's branch", async ({}, testInfo) => {
  covers(testInfo, "SEC-14-V03");
  coversV025(testInfo, "ROW25-V09", "ROW25-V10");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "agent-client");

  const tokens = fixtureAgentTokens();
  const scoped = await queryRegions(tokens.e2e_finance_east);
  // The scoped Role may only read its own branch.
  assertion(
    testInfo,
    "allow_control",
    scoped.ok && scoped.regions.includes("East"),
    `the scoped Agent sees ${JSON.stringify(scoped.regions)}`
  );
  assertion(
    testInfo,
    "deny",
    scoped.regions.length > 0 && !scoped.regions.includes("West"),
    `the scoped Agent must not see the other branch (${JSON.stringify(scoped.regions)})`
  );
  assertion(testInfo, "no_leak", !vault.contains(scoped.raw), "the query answer carries no credential");

  // An "all rows" Role on the same table really does see both branches — this is
  // the positive control that proves the restriction above is the row scope and
  // not an empty result set.
  const all = await queryRegions(tokens.e2e_finance);
  assertion(
    testInfo,
    "allow_control",
    all.ok && all.regions.includes("East") && all.regions.includes("West"),
    `the all-rows Agent sees ${JSON.stringify(all.regions)}`
  );
});

test("a table the Role does not grant stays invisible, and an unknown Role id matches no Role", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-13-V01", "SEC-14-V05");
  coversV025(testInfo, "ROW25-V04", "ROW25-V05");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "agent-client");

  const tokens = fixtureAgentTokens();
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();

    // orders_masked IS enabled on fin-db, but the scoped Role does not grant it:
    // an enabled table must not widen the permission.
    const denied = await mcpCall(tokens.e2e_finance_east, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "lucy_read_source",
        arguments: { connectionId: FIN_ORDERS.connection, source: `${FIN_ORDERS.schema}.${FIN_ORDERS.name}` }
      }
    });
    const deniedPayload = readToolPayload(denied);
    assertion(
      testInfo,
      "deny",
      denied.status !== 200 || !deniedPayload.ok || deniedPayload.rows.length === 0,
      `an ungranted table must not be readable -> HTTP ${denied.status}`
    );
    assertion(testInfo, "no_leak", !vault.contains(denied.text), "the refused answer carries no credential");

    // an unknown Role id matches no Role: the preview refuses instead of guessing
    const unknown = await page.request.post(new URL("/api/admin/roles/preview-row-policy", baseURL!).toString(), {
      data: { roleId: "e2e_no_such_role", tables: [FIN] }
    });
    const unknownText = await unknown.text();
    const unknownBody = (() => {
      try {
        return JSON.parse(unknownText) as { ok?: boolean; error?: { code?: string }; data?: { ok?: boolean } };
      } catch {
        return {} as { ok?: boolean; error?: { code?: string }; data?: { ok?: boolean } };
      }
    })();
    assertion(
      testInfo,
      "deny",
      unknown.status() >= 400 || unknownBody.data?.ok === false,
      `an unknown Role id must not resolve to any Role -> HTTP ${unknown.status()}`
    );
    assertion(testInfo, "no_leak", !vault.contains(unknownText), "the refused preview carries no credential");
  } finally {
    await context.close();
  }
});
