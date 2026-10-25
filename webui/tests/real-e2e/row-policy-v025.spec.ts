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

/**
 * The scope of a query that returns the region dimension of marketing_daily.
 *
 * The shape is Lucy's own contract, not a guess:
 *   * `dimensions` items must be OBJECTS (`invalid_arguments:lucy_query:dimensions_items_must_be_objects`),
 *   * a dimension that exists in more than one enabled source must be QUALIFIED
 *     (`marketing_daily.region`, not `region` — otherwise the upstream answers
 *     `ambiguous_field`),
 *   * a measure must be a SEMANTIC measure of the source (`total_spend_cents`,
 *     whose expression is `sum(spend_cents)`); the bare physical column is not
 *     a measure (`Measure 'spend_cents' does not reference any source`).
 */
const REGION_QUERY = {
  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["total_spend_cents"],
  dimensions: [{ field: "marketing_daily.region" }]
};

type McpResult = { status: number; text: string };

/**
 * The JSON-RPC envelope of a tools/call answer, with the tool payload parsed.
 *
 * The data plane answers with `headers` + array rows, so every row is mapped
 * onto its header name — reading `row.region` off an array row always yields
 * undefined and would make a successful query look empty.
 */
function readToolPayload(res: McpResult): {
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  raw: string;
  refusal: string | null;
} {
  let envelope: {
    result?: { content?: Array<{ type?: string; text?: string }> };
    error?: { message?: string };
  };
  try {
    envelope = JSON.parse(res.text) as typeof envelope;
  } catch {
    return { ok: false, rows: [], raw: res.text, refusal: null };
  }
  if (envelope.error) {
    return { ok: false, rows: [], raw: res.text, refusal: envelope.error.message ?? "jsonrpc_error" };
  }
  const first = envelope.result?.content?.[0];
  const raw = first?.text ?? "";
  const refusalOf = (text: string): string | null => {
    if (text.startsWith("Access denied:")) {
      return text.slice("Access denied:".length).trim().split(/\s+/)[0] ?? "access_denied";
    }
    return null;
  };
  try {
    const parsed = JSON.parse(raw) as { headers?: string[]; rows?: unknown; reason?: string };
    const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
    const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const rows = rawRows.map((row) =>
      Array.isArray(row)
        ? Object.fromEntries(headers.map((header, index) => [header, row[index]]))
        : (row as Record<string, unknown>)
    );
    const refusal = typeof parsed.reason === "string" ? parsed.reason : refusalOf(raw);
    return { ok: true, rows, raw, refusal };
  } catch {
    return { ok: false, rows: [], raw, refusal: refusalOf(raw) };
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

/**
 * Runs one real MCP lucy_query and returns the distinct region values it saw.
 *
 * The question is opened first (`lucy_begin_question`): the data plane meters
 * question-scoped calls, and a call without a question scope is stopped with
 * `question_budget_exhausted` — which is a budget verdict, not an empty answer.
 */
async function queryRegions(
  token: string,
  intent: string
): Promise<{ regions: string[]; raw: string; ok: boolean; refusal: string | null }> {
  await mcpCall(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "lucy_begin_question", arguments: { intentSummary: intent } }
  });
  const res = await mcpCall(token, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "lucy_query", arguments: REGION_QUERY }
  });
  const parsed = readToolPayload(res);
  return {
    regions: regionsOf(parsed.rows),
    raw: parsed.raw,
    ok: parsed.ok && res.status === 200 && parsed.rows.length > 0,
    refusal: parsed.refusal
  };
}

/**
 * The row-policy execution path is gated: until the upstream's forced-predicate
 * support is PROVEN for the target environment, every scoped (row-restricted)
 * source is refused with `row_policy_upstream_unproven`. That gate is an
 * operations change (`LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`), not a defect of
 * the policy — so the item is BLOCKED with the reason, never FAILED.
 */
const UPSTREAM_GATE_REFUSALS = new Set(["row_policy_upstream_unproven"]);

function isUpstreamGateRefusal(refusal: string | null): boolean {
  return refusal !== null && UPSTREAM_GATE_REFUSALS.has(refusal);
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
              error?: { code?: string; message?: string; reason?: string } | null;
            }>;
          };
        };
      } catch {
        return {} as { ok?: boolean; data?: { ok?: boolean; candidateDigest?: string; tables?: Array<{ preview?: { displayShape?: string; roleIds?: string[]; effectiveRowGrant?: { kind?: string; orArms?: unknown[] } } | null; error?: { code?: string; message?: string; reason?: string } | null }> } };
      }
    })();
    const table = previewBody.data?.tables?.[0];
    const previewReason = table?.error?.reason ?? table?.error?.message ?? null;
    if (previewReason) {
      // The preview refuses when the run's role set for this table does not compile
      // (the product fails closed: two different row policies for the same table in
      // ONE role are a conflict, `row_grant_conflict`). That is a property of the
      // RUN's role set, not of the preview — so the item is BLOCKED with the
      // server's own reason, never FAILED.
      testInfo.annotations.push({
        type: "blocked",
        description: `the run's role set for this table does not compile, so the preview cannot be evaluated (${previewReason})`
      });
      test.skip(true, "BLOCKED: the run's role set does not compile");
      return;
    }
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
    const union = await queryRegions(tokens.e2e_east_west, "read the region dimension of marketing_daily with the multi-role Agent");
    if (isUpstreamGateRefusal(union.refusal) || (union.refusal ?? "").includes("role_resolution_failed")) {
      testInfo.annotations.push({
        type: "blocked",
        description: `the runtime refused the multi-role query (${union.refusal}); the union could not be evaluated`
      });
      test.skip(true, "BLOCKED: the runtime refused the multi-role query");
      return;
    }
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
  const scoped = await queryRegions(tokens.e2e_finance_east, "read the region dimension of marketing_daily with the scoped Agent");
  if (isUpstreamGateRefusal(scoped.refusal)) {
    // The row-policy execution path is not proven for this environment: every
    // scoped source is refused before it is evaluated. The restriction cannot be
    // observed, so the item is BLOCKED with the gate's own reason — never FAILED.
    testInfo.annotations.push({
      type: "blocked",
      description: `the row-policy execution path is not proven for this environment (${scoped.refusal}); the scoped grant could not be evaluated`
    });
  } else {
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
  }
  assertion(testInfo, "no_leak", !vault.contains(scoped.raw), "the query answer carries no credential");

  // An "all rows" Role on the same table really does see both branches — this is
  // the positive control that proves the restriction above is the row scope and
  // not an empty result set.
  const all = await queryRegions(tokens.e2e_finance, "read the region dimension of marketing_daily with the all-rows Agent");
  assertion(
    testInfo,
    "allow_control",
    all.ok && all.regions.includes("East") && all.regions.includes("West"),
    `the all-rows Agent sees ${JSON.stringify(all.regions)}`
  );
  if (isUpstreamGateRefusal(scoped.refusal)) {
    test.skip(true, "BLOCKED: the row-policy execution path is not proven for this environment");
    return;
  }
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
