// ROW25 — real preview + MCP for the row-policy pack (RDS mysql-aliyun / superstore_orders).
//
// Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §9
//   and docs/design/design-row-policy-real-e2e-pack.md §3.
// Each test title is ROW25_OWNER_SYMBOLS so `run-row-policy-b --grep` selects one id.
// coversV025 lists only the id that test's assertions evaluate.
// V04/V05 are compile-failure previews. V09 is the rp_all union. V10 is the
// personal-constraint intersection. They are not hung on an ungranted table.
//
// No page.route. Without LUCY_REAL_E2E_RUN the Playwright config does not load;
// blockUnless still records BLOCKED (never passed) when ktx-upstream is unproven.
//
//   cd webui && LUCY_REAL_E2E_RUN=<runDir>/run.json \
//     npx playwright test --config playwright.real.config.ts tests/real-e2e/row-policy-v025.spec.ts

import { test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, covers, coversV025 } from "./helpers/blocked";
import { fixtureAgentTokens, mcpCall, ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";
import {
  AGENTS,
  CONNECTION_ID,
  REGIONS,
  ROLES,
  ROW25_OWNER_SYMBOLS,
  TABLES
} from "../../../scripts/e2e/lib/row-policy-pack.mjs";

test.describe.configure({ mode: "serial" });

const FACT = {
  connection: CONNECTION_ID,
  schema: TABLES.fact.schema,
  name: TABLES.fact.name
};

const REGION_FIELD = `${TABLES.fact.name}.${TABLES.fact.field}`;

const REGION_QUERY = {
  connectionId: CONNECTION_ID,
  source: `${TABLES.fact.schema}.${TABLES.fact.name}`,
  measures: ["total_sales"],
  dimensions: [{ field: REGION_FIELD }]
};

const TPL_EQ = "tpl_eq_east";
const TPL_IN = "tpl_in_regions";
const TPL_UNKNOWN_FIELD = "tpl_unknown_field";
const TPL_MEASURE = "tpl_measure_field";
const TPL_ILLEGAL_OP = "tpl_illegal_op";
const MISSING_TEMPLATE = "tpl_does_not_exist";

const LIVE = ["lucy-http", "browser", "ktx-upstream"] as const;

type Json = Record<string, any>;

type McpResult = { status: number; text: string };

type RegionRead = { regions: string[]; raw: string; ok: boolean; refusal: string | null };

function adminUrl(pathname: string): string {
  return new URL(pathname, runContext().instance.baseUrl).toString();
}

function parseJson(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return {};
  }
}

function requireLive(testInfo: TestInfo): void {
  blockUnless(testInfo, ...LIVE);
}

function markBlocked(testInfo: TestInfo, description: string): void {
  testInfo.annotations.push({ type: "blocked", description });
  testInfo.skip(true, `BLOCKED: ${description}`);
}

function forcedPredicateProven(): boolean {
  const instance = runContext().instance as { env?: Record<string, string | undefined> };
  const raw = instance.env?.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  return raw === "1" || raw === "true" || raw === "TRUE";
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((value, index) => value === sorted[index]);
}

function isEastOnly(regions: string[]): boolean {
  return sameSet(regions, [REGIONS.A]);
}

function isEastWest(regions: string[]): boolean {
  return sameSet(regions, [REGIONS.A, REGIONS.B]);
}

function hasOutsideRegion(regions: string[]): boolean {
  return regions.some((region) => region !== REGIONS.A && region !== REGIONS.B);
}

function scopedRole(
  rowPolicy: Json,
  table: { connection: string; schema: string; name: string } = FACT
): Json {
  return {
    permission_model_version: 2,
    allow: {
      connections: [table.connection],
      tableSelectors: [
        {
          connection: table.connection,
          schema: table.schema,
          names: [table.name],
          row_access: "scoped",
          row_policy: rowPolicy
        }
      ],
      tools: [
        "lucy_catalog",
        "lucy_query",
        "lucy_read_source",
        "lucy_explain_query",
        "lucy_begin_question",
        "wiki_search",
        "wiki_read",
        "lucy_skill_search",
        "lucy_skill_read",
        "connection_list"
      ]
    }
  };
}

function eqPredicate(value: string): Json {
  return { field: TABLES.fact.field, op: "eq", value };
}

function inPredicate(values: string[]): Json {
  return { field: TABLES.fact.field, op: "in", values };
}

async function withOwner(browser: Browser, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await ownerContext(browser);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function requestJson(
  page: Page,
  method: "get" | "post" | "patch" | "delete",
  pathname: string,
  data?: Json
): Promise<{ status: number; text: string; body: Json }> {
  const url = adminUrl(pathname);
  const res =
    method === "get"
      ? await page.request.get(url)
      : method === "post"
        ? await page.request.post(url, { data })
        : method === "patch"
          ? await page.request.patch(url, { data })
          : await page.request.delete(url, { data });
  const text = await res.text();
  return { status: res.status(), text, body: parseJson(text) };
}

async function previewRole(page: Page, data: Json): Promise<{ status: number; text: string; body: Json }> {
  return requestJson(page, "post", "/api/admin/roles/preview-row-policy", data);
}

function previewTable(body: Json): Json | undefined {
  const tables = body?.data?.tables;
  return Array.isArray(tables) ? tables[0] : undefined;
}

function previewReason(body: Json): string {
  const table = previewTable(body);
  return [table?.error?.reason, table?.error?.message, table?.error?.code, table?.catalog?.reason]
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ");
}

/**
 * Did the preview REFUSE the draft?
 *
 * A refusal has two legitimate shapes and the contract does not pick one:
 *   * a REQUEST-level rejection — HTTP 4xx with the top-level `{ ok:false, error }`
 *     envelope. A draft that cannot even be normalized (unknown field, unresolved
 *     measure, missing template) is rejected before any table is previewed, and
 *     the save path rejects the very same draft the same way (Spec §14.2.1: the
 *     preview and the save build the SAME candidate).
 *   * a TABLE-level diagnostic — HTTP 200 with `data.ok === false` and the reason on
 *     `data.tables[].error`. The draft was fine; that table could not be previewed.
 *
 * This helper only answers "was it refused". It never answers "is it good": the
 * reason code, the no-leak check and the "no saveable confirmation" check stay
 * separate assertions, so accepting either shape does NOT weaken them.
 */
function previewRefused(body: Json, status: number): boolean {
  if (status >= 400) return body?.ok === false || body?.error !== undefined;
  return body?.data?.ok === false;
}

function agentGrant(body: Json, agentId: string): Json | undefined {
  const rows = previewTable(body)?.preview?.finalRowsByAgent;
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row: Json) => row?.agentId === agentId)?.finalRows;
}

function grantRegionValues(grant: Json | undefined): string[] {
  if (!grant || grant.kind !== "scoped") return [];
  const found = new Set<string>();
  const predicates = [
    ...(Array.isArray(grant.predicates) ? grant.predicates : []),
    ...(Array.isArray(grant.orArms) ? grant.orArms.flat() : [])
  ];
  for (const pred of predicates) {
    if (String(pred?.field ?? "").toLowerCase() !== String(TABLES.fact.field).toLowerCase()) continue;
    if (typeof pred?.value === "string") found.add(pred.value);
    if (Array.isArray(pred?.values)) {
      for (const value of pred.values) if (typeof value === "string") found.add(value);
    }
  }
  return [...found].sort();
}

function grantDigest(grant: Json | undefined): string {
  return grant?.kind === "scoped" && typeof grant.digest === "string" ? grant.digest : "";
}

function orArmCount(grant: Json | undefined): number {
  return grant?.kind === "scoped" && Array.isArray(grant.orArms) ? grant.orArms.length : -1;
}

async function roleDocument(page: Page, roleId: string): Promise<{ status: number; text: string; body: Json }> {
  return requestJson(page, "get", `/api/admin/roles/${roleId}`);
}

function rolePolicyText(body: Json): string {
  return JSON.stringify(body?.data?.role ?? {});
}

async function factView(page: Page): Promise<{ status: number; text: string; body: Json }> {
  const query = new URLSearchParams({
    connectionId: FACT.connection,
    schema: FACT.schema,
    sourceName: FACT.name
  });
  return requestJson(page, "get", `/api/admin/row-policy/views/table?${query.toString()}`);
}

function viewRole(body: Json, roleId: string): Json | undefined {
  const roles = body?.data?.roles;
  if (!Array.isArray(roles)) return undefined;
  return roles.find((role: Json) => role?.roleId === roleId);
}

async function templateCatalog(page: Page): Promise<{ status: number; text: string; body: Json }> {
  return requestJson(page, "get", "/api/admin/row-policy/templates");
}

function templateRows(body: Json): Json[] {
  const rows = body?.data?.templates;
  return Array.isArray(rows) ? rows : [];
}

function templateNames(body: Json): string[] {
  return templateRows(body).map((row) => String(row?.name ?? "")).filter(Boolean).sort();
}

function predicatePayload(raw: unknown): Json[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((pred) => {
    const item = pred as Json;
    if (item?.op === "in") return { field: item.field, op: "in", values: item.values };
    return { field: item?.field, op: item?.op, value: item?.value };
  });
}

async function writeTemplate(
  page: Page,
  method: "post" | "patch" | "delete",
  pathname: string,
  data: Json
): Promise<{ status: number; text: string; body: Json }> {
  const dry = await requestJson(page, method, pathname, { ...data, dryRun: true });
  const digest = dry.body?.data?.candidateDigest;
  const version = dry.body?.data?.version;
  if (dry.status !== 200 || dry.body?.ok === false || typeof digest !== "string" || typeof version !== "string") {
    return dry;
  }
  return requestJson(page, method, pathname, { ...data, dryRun: false, version, candidateDigest: digest });
}

async function policyVersion(page: Page): Promise<string> {
  const res = await requestJson(page, "get", "/api/admin/policy-runtime");
  return typeof res.body?.data?.policyVersion === "string" ? res.body.data.policyVersion : "";
}

function readToolPayload(res: McpResult): { ok: boolean; rows: Array<Record<string, unknown>>; raw: string; refusal: string | null } {
  let envelope: { result?: { content?: Array<{ type?: string; text?: string }> }; error?: { message?: string } };
  try {
    envelope = JSON.parse(res.text) as typeof envelope;
  } catch {
    return { ok: false, rows: [], raw: res.text, refusal: null };
  }
  if (envelope.error) {
    return { ok: false, rows: [], raw: res.text, refusal: envelope.error.message ?? "jsonrpc_error" };
  }
  const raw = envelope.result?.content?.[0]?.text ?? "";
  const known = [
    "row_policy_upstream_unproven",
    "row_policy_requires_wrapped_tool",
    "explicit_table_required",
    "final_rows_unsatisfiable"
  ];
  const refusalOf = (text: string): string | null => {
    if (text.startsWith("Access denied:")) return text.slice("Access denied:".length).trim().split(/\s+/)[0] ?? "access_denied";
    return known.find((code) => text.includes(code)) ?? null;
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

function regionsOf(rows: Array<Record<string, unknown>>): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === String(TABLES.fact.field).toLowerCase() && typeof value === "string") found.add(value);
    }
  }
  return [...found].sort();
}

async function queryRegions(token: string, intent: string): Promise<RegionRead> {
  await mcpCall(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "lucy_begin_question", arguments: { question: intent, intentSummary: intent } }
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
    raw: parsed.raw || res.text,
    ok: parsed.ok && res.status === 200 && parsed.rows.length > 0 && parsed.refusal === null,
    refusal: parsed.refusal
  };
}

async function readRegions(testInfo: TestInfo, token: string, intent: string): Promise<RegionRead | null> {
  const result = await queryRegions(token, intent);
  if (result.refusal !== null && result.refusal.includes("row_policy_upstream_unproven") && !forcedPredicateProven()) {
    markBlocked(testInfo, `scoped read refused with ${result.refusal}; forced-predicate gate is off`);
    return null;
  }
  return result;
}

function assertNoLeak(testInfo: TestInfo, text: string, detail: string): void {
  assertion(testInfo, "no_leak", !vault.contains(text), detail);
}

function tokens(): Record<string, string> {
  return fixtureAgentTokens();
}

test(ROW25_OWNER_SYMBOLS["ROW25-V01"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V01");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = await roleDocument(page, ROLES.east);
    const view = await factView(page);
    const branch = viewRole(view.body, ROLES.east);
    const templateRefs = Array.isArray(branch?.templateRefs) ? branch.templateRefs : [];
    assertion(
      testInfo,
      "allow_control",
      view.status === 200 && branch?.rowAccess === "scoped" && templateRefs.includes(TPL_EQ) && grantRegionValues(branch?.rowGrant).includes(REGIONS.A),
      `rp_east template branch rowAccess=${branch?.rowAccess} refs=${JSON.stringify(templateRefs)} regions=${JSON.stringify(grantRegionValues(branch?.rowGrant))}`
    );
    const committed = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const inline = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [eqPredicate(REGIONS.A)] }),
      tables: [FACT]
    });
    const committedDigest = grantDigest(agentGrant(committed.body, AGENTS.east));
    const inlineDigest = grantDigest(agentGrant(inline.body, AGENTS.east));
    assertion(
      testInfo,
      "consistency",
      committedDigest.length > 0 && committedDigest === inlineDigest,
      `template digest=${committedDigest} inline digest=${inlineDigest}`
    );
    assertion(
      testInfo,
      "deny",
      agentGrant(inline.body, AGENTS.east)?.kind === "scoped" && !grantRegionValues(agentGrant(inline.body, AGENTS.east)).includes(REGIONS.B),
      `inline east grant kind=${agentGrant(inline.body, AGENTS.east)?.kind}`
    );
    const after = await roleDocument(page, ROLES.east);
    assertion(testInfo, "no_side_effect", rolePolicyText(before.body) === rolePolicyText(after.body), "draft preview left rp_east on disk");
    assertNoLeak(testInfo, `${committed.text}\n${inline.text}`, "preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V02"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V02");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = await roleDocument(page, ROLES.east);
    const fromTemplate = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_IN }),
      tables: [FACT]
    });
    const reversed = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [inPredicate([REGIONS.A, REGIONS.B])] }),
      tables: [FACT]
    });
    const templateGrant = agentGrant(fromTemplate.body, AGENTS.east);
    const reversedGrant = agentGrant(reversed.body, AGENTS.east);
    assertion(
      testInfo,
      "allow_control",
      templateGrant?.kind === "scoped" && isEastWest(grantRegionValues(templateGrant)),
      `template in regions=${JSON.stringify(grantRegionValues(templateGrant))} reason=${previewReason(fromTemplate.body)}`
    );
    assertion(
      testInfo,
      "consistency",
      grantDigest(templateGrant).length > 0 && grantDigest(templateGrant) === grantDigest(reversedGrant),
      `template digest=${grantDigest(templateGrant)} reversed digest=${grantDigest(reversedGrant)}`
    );
    assertion(
      testInfo,
      "deny",
      reversedGrant?.kind !== "all",
      "shuffled in-list must stay scoped"
    );
    const after = await roleDocument(page, ROLES.east);
    assertion(testInfo, "no_side_effect", rolePolicyText(before.body) === rolePolicyText(after.body), "in-list preview left rp_east on disk");
    assertNoLeak(testInfo, `${fromTemplate.text}\n${reversed.text}`, "preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V03"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V03");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const view = await factView(page);
    const branch = viewRole(view.body, ROLES.eastPlusInline);
    const templateRefs = Array.isArray(branch?.templateRefs) ? branch.templateRefs.map(String) : [];
    const inline = Array.isArray(branch?.inlinePredicates) ? branch.inlinePredicates : [];
    const inlineFields = inline.map((pred: Json) => String(pred?.field ?? ""));
    const arms = orArmCount(branch?.rowGrant);
    const armWidths = Array.isArray(branch?.rowGrant?.orArms)
      ? branch.rowGrant.orArms.map((arm: unknown[]) => arm.length)
      : [];
    assertion(
      testInfo,
      "allow_control",
      view.status === 200 && branch?.rowAccess === "scoped" && templateRefs.includes(TPL_EQ) && inlineFields.includes("is_deleted"),
      `refs=${JSON.stringify(templateRefs)} inline=${JSON.stringify(inlineFields)}`
    );
    assertion(
      testInfo,
      "consistency",
      arms === 1 && armWidths.length === 1 && armWidths[0] >= 2 && grantRegionValues(branch?.rowGrant).includes(REGIONS.A),
      `orArms=${arms} widths=${JSON.stringify(armWidths)} regions=${JSON.stringify(grantRegionValues(branch?.rowGrant))}`
    );
    assertion(testInfo, "deny", arms === 1, "one Role must not split template and inline into two OR arms");
    assertNoLeak(testInfo, view.text, "view carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V04"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V04");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const missing = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: MISSING_TEMPLATE }),
      tables: [FACT]
    });
    const reason = `${previewReason(missing.body)} ${missing.text}`;
    assertion(
      testInfo,
      "deny",
      previewRefused(missing.body, missing.status) && reason.includes("row_policy_template_unresolved") && !reason.includes("\"kind\":\"all\""),
      `status=${missing.status} reason=${reason.slice(0, 240)}`
    );
    assertion(testInfo, "allow_control", missing.body?.data?.confirmation === undefined, "a failed compile must not mint a save confirmation");
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "missing-template preview wrote rp_east");
    assertion(testInfo, "consistency", after.includes(TPL_EQ), "committed rp_east no longer cites tpl_eq_east");
    assertNoLeak(testInfo, missing.text, "refused preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V05"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V05");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const unknown = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_UNKNOWN_FIELD }),
      tables: [FACT]
    });
    const reason = `${previewReason(unknown.body)} ${unknown.text}`;
    assertion(
      testInfo,
      "deny",
      previewRefused(unknown.body, unknown.status) && reason.includes("code=row_policy_field_unknown") && !reason.includes("row_policy_catalog_unavailable"),
      `status=${unknown.status} reason=${reason.slice(0, 280)}`
    );
    assertion(
      testInfo,
      "consistency",
      reason.includes(`connection=${CONNECTION_ID}`) && reason.includes(`source=${FACT.name}`) && reason.includes("field=ghost_column"),
      `four-tuple missing in ${reason.slice(0, 280)}`
    );
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "unknown-field preview wrote rp_east");
    assertion(testInfo, "allow_control", unknown.body?.data?.confirmation === undefined, "unknown field must not confirm a save");
    assertNoLeak(testInfo, unknown.text, "refused preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V06"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V06");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const measure = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_MEASURE }),
      tables: [FACT]
    });
    const reason = `${previewReason(measure.body)} ${measure.text}`;
    assertion(
      testInfo,
      "deny",
      previewRefused(measure.body, measure.status) && reason.includes("row_policy_field_unresolved:measure") && !reason.includes("row_policy_field_unknown"),
      `status=${measure.status} reason=${reason.slice(0, 280)}`
    );
    assertion(testInfo, "allow_control", measure.body?.data?.confirmation === undefined, "measure binding must not confirm a save");
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "measure preview wrote rp_east");
    assertion(testInfo, "consistency", reason.includes("total_sales") || reason.includes("field=total_sales"), "measure failure does not name total_sales");
    assertNoLeak(testInfo, measure.text, "refused preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V07"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V07");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const illegal = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [{ field: TABLES.fact.field, op: "like", value: "华" }] }),
      tables: [FACT]
    });
    const catalog = await templateCatalog(page);
    const reason = `${previewReason(illegal.body)} ${illegal.text}`;
    const issues = Array.isArray(catalog.body?.data?.issues) ? catalog.body.data.issues : [];
    const illegalIssue = issues.some((issue: Json) => issue?.code === "row_policy_op_forbidden" && issue?.templateName === TPL_ILLEGAL_OP);
    assertion(
      testInfo,
      "deny",
      reason.includes("row_policy_op_forbidden") && illegal.body?.data?.ok !== true,
      `status=${illegal.status} reason=${reason.slice(0, 280)}`
    );
    assertion(testInfo, "consistency", illegalIssue, `catalog issues=${JSON.stringify(issues).slice(0, 240)}`);
    assertion(testInfo, "allow_control", illegal.body?.data?.confirmation === undefined, "illegal op must not confirm a save");
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "illegal-op preview wrote rp_east");
    assertNoLeak(testInfo, `${illegal.text}\n${catalog.text}`, "refused preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V08"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V08");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const preview = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const grant = agentGrant(preview.body, AGENTS.eastWest);
    const shape = previewTable(preview.body)?.preview?.displayShape;
    assertion(
      testInfo,
      "allow_control",
      preview.status === 200 && shape === "OR-of-AND" && grant?.kind === "scoped" && orArmCount(grant) === 2 && isEastWest(grantRegionValues(grant)),
      `shape=${shape} kind=${grant?.kind} arms=${orArmCount(grant)} regions=${JSON.stringify(grantRegionValues(grant))} reason=${previewReason(preview.body)}`
    );
    assertion(testInfo, "deny", grant?.kind !== "all", "ag_east_west must not absorb rp_all into 全部行");
    const seen = await readRegions(testInfo, agentTokens[AGENTS.eastWest], "ROW25-V08 华东并西南");
    if (!seen) return;
    assertion(testInfo, "consistency", seen.ok && isEastWest(seen.regions), `MCP regions=${JSON.stringify(seen.regions)} refusal=${seen.refusal}`);
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "union preview wrote rp_east");
    assertNoLeak(testInfo, `${preview.text}\n${seen.raw}`, "union preview or query carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V09"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V09");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const preview = await previewRole(page, { roleId: ROLES.all, tables: [FACT] });
    const union = previewTable(preview.body)?.preview?.effectiveRowGrant;
    const allAgent = agentGrant(preview.body, AGENTS.all);
    const view = await factView(page);
    const east = viewRole(view.body, ROLES.east);
    assertion(
      testInfo,
      "allow_control",
      preview.status === 200 && union?.kind === "all" && allAgent?.kind === "all",
      `union=${union?.kind} ag_all=${allAgent?.kind} reason=${previewReason(preview.body)}`
    );
    assertion(
      testInfo,
      "consistency",
      east?.rowAccess === "scoped" && grantRegionValues(east?.rowGrant).includes(REGIONS.A),
      `rp_east branch survived the all-rows union rowAccess=${east?.rowAccess}`
    );
    const seen = await readRegions(testInfo, agentTokens[AGENTS.all], "ROW25-V09 全部行");
    if (!seen) return;
    assertion(
      testInfo,
      "deny",
      seen.ok && hasOutsideRegion(seen.regions),
      `all-rows agent must see a region outside 华东/西南, got ${JSON.stringify(seen.regions)} refusal=${seen.refusal}`
    );
    assertNoLeak(testInfo, `${preview.text}\n${seen.raw}`, "all-rows preview or query carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V10"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V10");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const preview = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const union = previewTable(preview.body)?.preview?.effectiveRowGrant;
    const narrowed = agentGrant(preview.body, AGENTS.eastConstrained);
    assertion(
      testInfo,
      "allow_control",
      union?.kind === "all" && narrowed?.kind === "scoped" && isEastOnly(grantRegionValues(narrowed)),
      `union=${union?.kind} intersection=${narrowed?.kind} regions=${JSON.stringify(grantRegionValues(narrowed))}`
    );
    assertion(testInfo, "deny", !grantRegionValues(narrowed).includes(REGIONS.B), "personal limit must drop 西南");
    const seen = await readRegions(testInfo, agentTokens[AGENTS.eastConstrained], "ROW25-V10 交集");
    if (!seen) return;
    assertion(
      testInfo,
      "consistency",
      seen.ok && isEastOnly(seen.regions) && sameSet(seen.regions, grantRegionValues(narrowed)),
      `MCP=${JSON.stringify(seen.regions)} preview=${JSON.stringify(grantRegionValues(narrowed))} refusal=${seen.refusal}`
    );
    assertNoLeak(testInfo, `${preview.text}\n${seen.raw}`, "intersection preview or query carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V11"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V11");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = await requestJson(page, "get", `/api/admin/agents/${AGENTS.eastConstrained}`);
    const beforeConstraints = JSON.stringify(before.body?.data?.agent?.constraints ?? null);
    const refused = await requestJson(page, "patch", `/api/admin/agents/${AGENTS.eastConstrained}`, {
      dryRun: true,
      patch: {
        constraints: {
          sources: [
            {
              connection: FACT.connection,
              schema: FACT.schema,
              names: [FACT.name],
              predicates: [eqPredicate(REGIONS.A), eqPredicate(REGIONS.B)]
            }
          ]
        }
      }
    });
    const code = String(refused.body?.error?.code ?? "");
    const message = String(refused.body?.error?.message ?? "");
    assertion(
      testInfo,
      "deny",
      refused.status >= 400 && (code === "final_rows_unsatisfiable" || message.includes("final_rows_unsatisfiable") || refused.text.includes("final_rows_unsatisfiable")),
      `status=${refused.status} code=${code} message=${message.slice(0, 200)}`
    );
    assertion(testInfo, "allow_control", refused.body?.data?.written !== true, "unsatisfiable constraints must not report a write");
    const after = await requestJson(page, "get", `/api/admin/agents/${AGENTS.eastConstrained}`);
    const afterConstraints = JSON.stringify(after.body?.data?.agent?.constraints ?? null);
    assertion(testInfo, "no_side_effect", beforeConstraints === afterConstraints, `constraints changed ${afterConstraints.slice(0, 180)}`);
    assertion(testInfo, "consistency", before.status === 200 && after.status === 200, `agent read before=${before.status} after=${after.status}`);
    assertNoLeak(testInfo, refused.text, "refused constraint patch carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V12"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V12");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const committed = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const draft = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [eqPredicate(REGIONS.A)] }),
      tables: [FACT]
    });
    const committedRegions = grantRegionValues(agentGrant(committed.body, AGENTS.eastWest));
    const draftRegions = grantRegionValues(agentGrant(draft.body, AGENTS.eastWest));
    const digest = String(draft.body?.data?.candidateDigest ?? "");
    assertion(
      testInfo,
      "allow_control",
      digest.length > 0 && typeof draft.body?.data?.basePolicyVersion === "string" && draft.body.data.basePolicyVersion.length > 0,
      `candidateDigest=${digest} basePolicyVersion=${draft.body?.data?.basePolicyVersion}`
    );
    assertion(
      testInfo,
      "consistency",
      isEastWest(committedRegions) && sameSet(committedRegions, draftRegions),
      `committed=${JSON.stringify(committedRegions)} draft=${JSON.stringify(draftRegions)}`
    );
    const seen = await readRegions(testInfo, agentTokens[AGENTS.eastWest], "ROW25-V12 预览与运行时");
    if (!seen) return;
    assertion(testInfo, "deny", seen.ok && isEastWest(seen.regions) && !hasOutsideRegion(seen.regions), `MCP=${JSON.stringify(seen.regions)}`);
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after && before.includes(TPL_EQ), "draft preview replaced the committed template");
    assertNoLeak(testInfo, `${draft.text}\n${seen.raw}`, "draft preview or query carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V13"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V13");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeRole = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const beforeVersion = await policyVersion(page);
    const failed = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [{ field: "ghost_column", op: "eq", value: "x" }] }),
      tables: [FACT]
    });
    assertion(
      testInfo,
      "deny",
      previewRefused(failed.body, failed.status) && failed.body?.data?.confirmation === undefined,
      `failed preview ok=${failed.body?.data?.ok} confirmation=${failed.body?.data?.confirmation !== undefined}`
    );
    const ready = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const confirmation = ready.body?.data?.confirmation;
    assertion(
      testInfo,
      "allow_control",
      ready.body?.data?.ok === true && confirmation && typeof confirmation === "object",
      `committed preview ok=${ready.body?.data?.ok}`
    );
    if (!confirmation || typeof confirmation !== "object") return;
    const stale = await requestJson(page, "patch", `/api/admin/roles/${ROLES.east}`, {
      dryRun: false,
      patch: { description: "ROW25-V13 stale confirmation" },
      rowPolicyConfirmation: { ...confirmation, candidateDigest: "0".repeat(64) }
    });
    const staleCode = String(stale.body?.error?.code ?? "");
    assertion(
      testInfo,
      "consistency",
      stale.status === 409 && (staleCode === "ROW_POLICY_PREVIEW_REQUIRED" || stale.text.includes("ROW_POLICY_PREVIEW_REQUIRED")),
      `stale save status=${stale.status} code=${staleCode}`
    );
    const afterRole = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const afterVersion = await policyVersion(page);
    assertion(
      testInfo,
      "no_side_effect",
      beforeRole === afterRole && beforeVersion === afterVersion && !afterRole.includes("ROW25-V13 stale confirmation"),
      `policyVersion ${beforeVersion} -> ${afterVersion}`
    );
    assertNoLeak(testInfo, `${failed.text}\n${stale.text}`, "failed preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V14"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V14");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeCatalog = await templateCatalog(page);
    const beforeNames = templateNames(beforeCatalog.body);
    const inTemplate = templateRows(beforeCatalog.body).find((row) => row?.name === TPL_IN);
    const description = typeof inTemplate?.description === "string" ? inTemplate.description : "";
    const predicates = predicatePayload(inTemplate?.predicates);
    const kept = await requestJson(page, "delete", `/api/admin/row-policy/templates/${TPL_EQ}`, { dryRun: false });
    const keptCode = String(kept.body?.error?.code ?? "");
    assertion(
      testInfo,
      "deny",
      kept.status === 409 && keptCode === "row_policy_template_in_use",
      `delete ${TPL_EQ} status=${kept.status} code=${keptCode}`
    );
    const stillThere = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "allow_control", stillThere.includes(TPL_EQ), `${TPL_EQ} disappeared after a refused delete`);
    let removed = false;
    try {
      const deleted = await writeTemplate(page, "delete", `/api/admin/row-policy/templates/${TPL_IN}`, {});
      removed = deleted.body?.data?.written === true;
      const names = templateNames((await templateCatalog(page)).body);
      assertion(
        testInfo,
        "consistency",
        removed && !names.includes(TPL_IN),
        `delete ${TPL_IN} status=${deleted.status} written=${deleted.body?.data?.written} names=${names.join(",")}`
      );
    } finally {
      if (removed) {
        await writeTemplate(page, "post", "/api/admin/row-policy/templates", {
          name: TPL_IN,
          description,
          predicates
        });
      }
    }
    const missing = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: MISSING_TEMPLATE }),
      tables: [FACT]
    });
    assertion(
      testInfo,
      "deny",
      `${previewReason(missing.body)} ${missing.text}`.includes("row_policy_template_unresolved"),
      "external-style missing template reference did not fail closed"
    );
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), `templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`);
    assertNoLeak(testInfo, kept.text, "template delete refusal carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V15"], async ({}, testInfo) => {
  coversV025(testInfo, "ROW25-V15");
  blockUnless(testInfo, ...LIVE, "fault-control");
  markBlocked(testInfo, "fault-control is present but this pack has no intent/terminal audit fault harness");
});

test(ROW25_OWNER_SYMBOLS["ROW25-V16"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V16");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const beforeVersion = await policyVersion(page);
    const catalog = await templateCatalog(page);
    const tpl = templateRows(catalog.body).find((row) => row?.name === TPL_EQ);
    const description = typeof tpl?.description === "string" ? tpl.description : "";
    const predicates = predicatePayload(tpl?.predicates);
    assertion(testInfo, "allow_control", Boolean(tpl) && predicates.length > 0 && beforeVersion.length > 0, `policyVersion=${beforeVersion} template=${Boolean(tpl)}`);
    let changed = false;
    try {
      const written = await writeTemplate(page, "patch", `/api/admin/row-policy/templates/${TPL_EQ}`, {
        description: `${description} v16`,
        predicates
      });
      changed = written.body?.data?.written === true;
      const nextVersion = await policyVersion(page);
      assertion(
        testInfo,
        "consistency",
        changed && nextVersion.length > 0 && nextVersion !== beforeVersion,
        `written=${written.body?.data?.written} policyVersion ${beforeVersion} -> ${nextVersion} status=${written.status}`
      );
      const seen = await readRegions(testInfo, agentTokens[AGENTS.east], "ROW25-V16 换入后仍可取数");
      if (!seen) return;
      assertion(testInfo, "deny", seen.ok && isEastOnly(seen.regions), `after policy swap MCP=${JSON.stringify(seen.regions)} refusal=${seen.refusal}`);
      assertNoLeak(testInfo, `${written.text}\n${seen.raw}`, "template save or query carries no credential");
    } finally {
      if (changed) {
        await writeTemplate(page, "patch", `/api/admin/row-policy/templates/${TPL_EQ}`, { description, predicates });
      }
    }
    const restoredVersion = await policyVersion(page);
    const restored = templateRows((await templateCatalog(page)).body).find((row) => row?.name === TPL_EQ);
    assertion(
      testInfo,
      "no_side_effect",
      restoredVersion === beforeVersion && restored?.description === description,
      `restored policyVersion=${restoredVersion} description=${restored?.description}`
    );
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V17"], async ({}, testInfo) => {
  coversV025(testInfo, "ROW25-V17");
  requireLive(testInfo);
  const agentTokens = tokens();
  const token = agentTokens[AGENTS.east];
  await mcpCall(token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "lucy_begin_question", arguments: { question: "ROW25-V17", intentSummary: "ROW25-V17 unwrapped read" } }
  });
  const denied = await mcpCall(token, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "lucy_read_source",
      arguments: { connectionId: CONNECTION_ID, source: `${FACT.schema}.${FACT.name}` }
    }
  });
  const deniedPayload = readToolPayload(denied);
  assertion(
    testInfo,
    "deny",
    denied.text.includes("row_policy_requires_wrapped_tool") || deniedPayload.refusal === "row_policy_requires_wrapped_tool",
    `read_source status=${denied.status} refusal=${deniedPayload.refusal}`
  );
  const wrapped = await queryRegions(token, "ROW25-V17 wrapped lucy_query");
  assertion(
    testInfo,
    "allow_control",
    wrapped.refusal === null || !wrapped.refusal.includes("row_policy_requires_wrapped_tool"),
    `lucy_query must not be refused as an unwrapped tool, refusal=${wrapped.refusal}`
  );
  if (wrapped.refusal?.includes("row_policy_upstream_unproven") && !forcedPredicateProven()) {
    markBlocked(testInfo, "wrapped lucy_query is behind the unproven gate; the unwrapped refusal was already recorded");
    return;
  }
  assertion(testInfo, "consistency", wrapped.ok && isEastOnly(wrapped.regions), `wrapped query regions=${JSON.stringify(wrapped.regions)} refusal=${wrapped.refusal}`);
  assertion(testInfo, "no_side_effect", deniedPayload.rows.length === 0, "unwrapped read returned rows");
  assertNoLeak(testInfo, `${denied.text}\n${wrapped.raw}`, "unwrapped refusal carries no credential");
});

test(ROW25_OWNER_SYMBOLS["ROW25-V18"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V18");
  requireLive(testInfo);
  const agentTokens = tokens();
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const preview = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const seen = await queryRegions(agentTokens[AGENTS.east], "ROW25-V18 phase-off");
    assertion(
      testInfo,
      "deny",
      seen.refusal !== null && seen.refusal.includes("row_policy_upstream_unproven") && !seen.ok,
      `refusal=${seen.refusal} regions=${JSON.stringify(seen.regions)}`
    );
    assertion(
      testInfo,
      "allow_control",
      preview.status === 200 && (preview.body?.data?.candidateDigest || previewReason(preview.body).length > 0),
      `preview status=${preview.status} did not answer`
    );
    assertion(
      testInfo,
      "consistency",
      seen.refusal !== null && seen.refusal.includes("row_policy_upstream_unproven"),
      "a successful preview must not clear row_policy_upstream_unproven"
    );
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "phase-off preview wrote rp_east");
    assertNoLeak(testInfo, `${preview.text}\n${seen.raw}`, "phase-off refusal carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V19"], async ({}, testInfo) => {
  coversV025(testInfo, "ROW25-V19");
  requireLive(testInfo);
  markBlocked(testInfo, "D-03 needs a case-sensitive filesystem and an uppercase schema manifest such as BIDM.yaml; this pack does not provide one");
});

test(ROW25_OWNER_SYMBOLS["ROW25-V20"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V20");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const missingTable = { connection: CONNECTION_ID, schema: "missing_schema", name: "missing_table" };
    const missingManifest = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [eqPredicate(REGIONS.A)] }, missingTable),
      tables: [missingTable]
    });
    const reason = `${previewReason(missingManifest.body)} ${missingManifest.text}`;
    const catalogFault = reason.includes("row_policy_catalog_unavailable") || reason.includes("row_policy_catalog_capability_unknown");
    if (!catalogFault) {
      markBlocked(
        testInfo,
        "read-only pack cannot inject an unreadable, missing, or unparseable manifest; catalog fault was not observed on the missing table probe"
      );
      return;
    }
    assertion(testInfo, "deny", previewRefused(missingManifest.body, missingManifest.status), `catalog fault did not fail closed: ${reason.slice(0, 240)}`);
    assertion(
      testInfo,
      "consistency",
      reason.includes(CONNECTION_ID) && (reason.includes("missing_schema") || reason.includes("missing_table")),
      `catalog diagnostic is missing the table identity: ${reason.slice(0, 240)}`
    );
    assertion(testInfo, "allow_control", !reason.includes("code=row_policy_field_unknown"), "catalog failure must not be labeled field unknown");
    assertion(testInfo, "no_side_effect", missingManifest.body?.data?.confirmation === undefined, "catalog failure minted a confirmation");
    assertNoLeak(testInfo, missingManifest.text, "catalog failure carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V21"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "ROW25-V21");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const unknown = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [{ field: "ghost_column", op: "eq", value: "x" }] }),
      tables: [FACT]
    });
    const reason = `${previewReason(unknown.body)} ${unknown.text}`;
    assertion(
      testInfo,
      "deny",
      previewRefused(unknown.body, unknown.status) && reason.includes("code=row_policy_field_unknown") && !reason.includes("row_policy_catalog_unavailable") && !reason.includes("row_policy_catalog_capability_unknown"),
      `status=${unknown.status} reason=${reason.slice(0, 280)}`
    );
    assertion(
      testInfo,
      "consistency",
      reason.includes(`connection=${CONNECTION_ID}`) && reason.includes(`schema=${FACT.schema}`) && reason.includes(`source=${FACT.name}`) && reason.includes("field=ghost_column"),
      `four-tuple missing in ${reason.slice(0, 280)}`
    );
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "unknown-field preview wrote rp_east");
    assertion(testInfo, "allow_control", unknown.body?.data?.confirmation === undefined, "field unknown must not confirm a save");
    assertNoLeak(testInfo, unknown.text, "field-unknown preview carries no credential");
  });
});

test(ROW25_OWNER_SYMBOLS["ROW25-V22"], async ({}, testInfo) => {
  coversV025(testInfo, "ROW25-V22");
  requireLive(testInfo);
  markBlocked(testInfo, "D-03 needs a case-sensitive filesystem and an uppercase schema table; this pack's manifest is dataforai.yaml on the developer volume");
});

test("启用但未授权的 superstore_returns 不得被 rp_east 读取", async ({}, testInfo) => {
  covers(testInfo, "SEC-13-V01");
  requireLive(testInfo);
  const agentTokens = tokens();
  const source = `${TABLES.ungranted.schema}.${TABLES.ungranted.name}`;
  const denied = await mcpCall(agentTokens[AGENTS.east], {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "lucy_read_source",
      arguments: { connectionId: CONNECTION_ID, source }
    }
  });
  const payload = readToolPayload(denied);
  assertion(
    testInfo,
    "deny",
    denied.text.includes("explicit_table_required") || denied.text.includes("Access denied") || payload.refusal !== null,
    `ungranted ${source} status=${denied.status} refusal=${payload.refusal}`
  );
  assertion(testInfo, "no_leak", !vault.contains(denied.text), "ungranted read carries no credential");
});
