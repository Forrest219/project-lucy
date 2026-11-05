// RTP25-01..10 and RTV25-01..08 — real template writes and per-table reverse lookup.
//
// Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md §8
//   and docs/design/design-row-policy-real-e2e-pack.md §1 / §3.
// Each test title is RTP_RTV_OWNER_SYMBOLS so `run-row-policy-b --grep` selects one id.
// coversV025 lists only the id that test's assertions evaluate.
// Table identity is mysql-aliyun / dataforai / superstore_orders.
//
// No page.route. Without LUCY_REAL_E2E_RUN the Playwright config does not load;
// blockUnless still records BLOCKED (never passed) when ktx-upstream is unproven.
//
//   cd webui && LUCY_REAL_E2E_RUN=<runDir>/run.json \
//     npx playwright test --config playwright.real.config.ts tests/real-e2e/row-policy-templates-v025.spec.ts

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { assertion, blockUnless, coversV025 } from "./helpers/blocked";
import { ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";
import { accessMapTableKeys, canonicalTableKey, rowPolicyViewTableKeys } from "./helpers/table-identity";
import {
  AGENTS,
  CONNECTION_ID,
  REGIONS,
  ROLES,
  RTP_RTV_OWNER_SYMBOLS,
  TABLES
} from "../../../scripts/e2e/lib/row-policy-pack.mjs";

test.describe.configure({ mode: "serial" });

const FACT = {
  connection: CONNECTION_ID,
  schema: TABLES.fact.schema,
  name: TABLES.fact.name
};

const FACT_KEY = canonicalTableKey({
  connectionId: FACT.connection,
  schema: FACT.schema,
  sourceName: FACT.name
});

const UNGRANTED = {
  connection: CONNECTION_ID,
  schema: TABLES.ungranted.schema,
  name: TABLES.ungranted.name
};

const TPL_EQ = "tpl_eq_east";
const TPL_IN = "tpl_in_regions";
const TPL_UNKNOWN_FIELD = "tpl_unknown_field";
const TPL_MEASURE = "tpl_measure_field";
const TPL_ILLEGAL_OP = "tpl_illegal_op";
const MISSING_TEMPLATE = "tpl_does_not_exist";

const PROBE_UNREFERENCED = "rtp_probe_unreferenced";
const PROBE_STALE = "rtp_probe_stale";
const PROBE_AUDIT = "rtp_probe_audit";
const PROBE_GENERATION = "rtp_probe_generation";
const PROBE_V1 = "rtp10_v1_probe";
const PROBE_ALL = "rtp10_all_probe";

const LIVE = ["lucy-http", "browser", "ktx-upstream"] as const;

type Json = Record<string, any>;

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

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((value, index) => value === sorted[index]);
}

function scopedRole(rowPolicy: Json): Json {
  return {
    permission_model_version: 2,
    allow: {
      connections: [FACT.connection],
      tableSelectors: [
        {
          connection: FACT.connection,
          schema: FACT.schema,
          names: [FACT.name],
          row_access: "scoped",
          row_policy: rowPolicy
        }
      ],
      tools: ["lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_begin_question"]
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
 * Did the preview REFUSE the draft? Two legitimate shapes, and the contract does
 * not pick one:
 *   * a REQUEST-level rejection — HTTP 4xx with the top-level `{ ok:false, error }`
 *     envelope (the draft cannot be normalized, so no table is previewed at all);
 *   * a TABLE-level diagnostic — HTTP 200 with `data.ok === false` and the reason
 *     on `data.tables[].error`.
 *
 * It only answers "was it refused"; the reason code, the no-leak check and the
 * "no saveable confirmation" check stay separate assertions.
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

async function roleDocument(page: Page, roleId: string): Promise<{ status: number; text: string; body: Json }> {
  return requestJson(page, "get", `/api/admin/roles/${roleId}`);
}

function rolePolicyText(body: Json): string {
  return JSON.stringify(body?.data?.role ?? {});
}

function roleTools(body: Json): string[] {
  const tools = body?.data?.role?.allow?.tools;
  return Array.isArray(tools) ? tools.map(String) : [];
}

async function templateCatalog(page: Page, query = ""): Promise<{ status: number; text: string; body: Json }> {
  return requestJson(page, "get", `/api/admin/row-policy/templates${query}`);
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

async function deleteProbe(page: Page, name: string): Promise<void> {
  const names = templateNames((await templateCatalog(page)).body);
  if (!names.includes(name)) return;
  await writeTemplate(page, "delete", `/api/admin/row-policy/templates/${name}`, {});
}

async function policyVersion(page: Page): Promise<string> {
  const res = await requestJson(page, "get", "/api/admin/policy-runtime");
  return typeof res.body?.data?.policyVersion === "string" ? res.body.data.policyVersion : "";
}

function viewQuery(parts: { connectionId?: string; schema?: string; sourceName?: string; restricted?: string }): string {
  return new URLSearchParams(
    Object.entries(parts).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  ).toString();
}

async function viewList(page: Page, parts: Parameters<typeof viewQuery>[0] = {}): Promise<{ status: number; text: string; body: Json }> {
  const query = viewQuery(parts);
  return requestJson(page, "get", `/api/admin/row-policy/views/tables${query ? `?${query}` : ""}`);
}

async function viewDetail(
  page: Page,
  table: { connection: string; schema: string; name: string } = FACT
): Promise<{ status: number; text: string; body: Json }> {
  const query = viewQuery({ connectionId: table.connection, schema: table.schema, sourceName: table.name });
  return requestJson(page, "get", `/api/admin/row-policy/views/table?${query}`);
}

function viewTables(body: Json): Json[] {
  const tables = body?.data?.tables;
  return Array.isArray(tables) ? tables : [];
}

function factListRow(body: Json): Json | undefined {
  return viewTables(body).find(
    (row) => row?.connectionId === FACT.connection && row?.schema === FACT.schema && row?.sourceName === FACT.name
  );
}

function viewRole(body: Json, roleId: string): Json | undefined {
  const roles = body?.data?.roles;
  if (!Array.isArray(roles)) return undefined;
  return roles.find((role: Json) => role?.roleId === roleId);
}

function viewAgent(body: Json, agentId: string): Json | undefined {
  const agents = body?.data?.agents;
  if (!Array.isArray(agents)) return undefined;
  return agents.find((agent: Json) => agent?.agentId === agentId);
}

function snapshotIdentity(body: Json): Json {
  const identity = body?.data?.snapshot?.identity;
  return identity && typeof identity === "object" ? identity : {};
}

function identityComplete(identity: Json): boolean {
  return ["configVersion", "policyVersion", "sourceMapVersion", "capabilityDigest"].every(
    (field) => typeof identity[field] === "string" && identity[field].length > 0
  );
}

function errorBlob(res: { status: number; text: string; body: Json }): string {
  return `${res.status} ${res.body?.error?.code ?? ""} ${res.body?.error?.message ?? ""} ${res.text}`;
}

function assertNoLeak(testInfo: TestInfo, text: string, detail: string): void {
  assertion(testInfo, "no_leak", !vault.contains(text) && !text.includes("password=") && !text.includes("sha256:"), detail);
}

function regionProbe(): Json {
  return eqPredicate(REGIONS.A);
}

test(RTP_RTV_OWNER_SYMBOLS["RTP25-01"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-01");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const before = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const fromEq = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const inlineEq = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [eqPredicate(REGIONS.A)] }),
      tables: [FACT]
    });
    const eqTemplate = agentGrant(fromEq.body, AGENTS.east);
    const eqInline = agentGrant(inlineEq.body, AGENTS.east);
    assertion(
      testInfo,
      "allow_control",
      grantDigest(eqTemplate).length > 0 && grantDigest(eqTemplate) === grantDigest(eqInline) && grantRegionValues(eqTemplate).includes(REGIONS.A),
      `RTP25-01 eq template=${grantDigest(eqTemplate)} inline=${grantDigest(eqInline)} regions=${JSON.stringify(grantRegionValues(eqTemplate))}`
    );

    const fromIn = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_IN }),
      tables: [FACT]
    });
    const inlineIn = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [inPredicate([REGIONS.A, REGIONS.B])] }),
      tables: [FACT]
    });
    const reversedIn = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ predicates: [inPredicate([REGIONS.B, REGIONS.A])] }),
      tables: [FACT]
    });
    const inTemplate = agentGrant(fromIn.body, AGENTS.east);
    const inInline = agentGrant(inlineIn.body, AGENTS.east);
    const inReversed = agentGrant(reversedIn.body, AGENTS.east);
    const inDigest = grantDigest(inTemplate);
    assertion(
      testInfo,
      "consistency",
      inDigest.length > 0 && inDigest === grantDigest(inInline) && inDigest === grantDigest(inReversed),
      `RTP25-01 in template=${inDigest} inline=${grantDigest(inInline)} reversed=${grantDigest(inReversed)}`
    );
    assertion(
      testInfo,
      "deny",
      inTemplate?.kind === "scoped" && !grantRegionValues(inTemplate).includes("East") && !grantRegionValues(inTemplate).includes("West"),
      `RTP25-01 in-list must stay a Chinese scoped set, got ${JSON.stringify(grantRegionValues(inTemplate))}`
    );
    const after = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(testInfo, "no_side_effect", before === after, "RTP25-01 preview wrote rp_east");
    assertNoLeak(testInfo, `${fromEq.text}\n${fromIn.text}`, "RTP25-01 preview carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-02"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-02");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const detail = await viewDetail(page);
    const combined = viewRole(detail.body, ROLES.eastPlusInline);
    const inline = Array.isArray(combined?.inlinePredicates) ? combined.inlinePredicates : [];
    const refs = Array.isArray(combined?.templateRefs) ? combined.templateRefs.map(String) : [];
    const arms = Array.isArray(combined?.rowGrant?.orArms) ? combined.rowGrant.orArms : [];
    assertion(
      testInfo,
      "allow_control",
      detail.status === 200 &&
        combined?.rowAccess === "scoped" &&
        refs.includes(TPL_EQ) &&
        inline.some((pred: Json) => pred?.field === "is_deleted") &&
        arms.length === 1 &&
        Array.isArray(arms[0]) &&
        arms[0].length >= 2,
      `RTP25-02 refs=${JSON.stringify(refs)} arms=${arms.length} inline=${JSON.stringify(inline).slice(0, 180)}`
    );

    const union = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const unionGrant = agentGrant(union.body, AGENTS.eastWest);
    const unionArms = Array.isArray(unionGrant?.orArms) ? unionGrant.orArms.length : -1;
    assertion(
      testInfo,
      "consistency",
      union.body?.data?.tables?.[0]?.preview?.displayShape === "OR-of-AND" &&
        unionGrant?.kind === "scoped" &&
        unionArms === 2,
      `RTP25-02 shape=${union.body?.data?.tables?.[0]?.preview?.displayShape} kind=${unionGrant?.kind} arms=${unionArms}`
    );

    const narrowed = agentGrant(union.body, AGENTS.eastConstrained);
    assertion(
      testInfo,
      "deny",
      narrowed?.kind === "scoped" && grantRegionValues(narrowed).includes(REGIONS.A) && !grantRegionValues(narrowed).includes(REGIONS.B),
      `RTP25-02 agent AND regions=${JSON.stringify(grantRegionValues(narrowed))} kind=${narrowed?.kind}`
    );
    assertNoLeak(testInfo, `${detail.text}\n${union.text}`, "RTP25-02 view carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-03"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-03");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const beforeRole = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    const missing = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: MISSING_TEMPLATE }),
      tables: [FACT]
    });
    const illegal = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_ILLEGAL_OP }),
      tables: [FACT]
    });
    const empty = await requestJson(page, "post", "/api/admin/row-policy/templates", {
      dryRun: true,
      name: "rtp_probe_empty",
      predicates: []
    });
    const measure = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_MEASURE }),
      tables: [FACT]
    });
    const unknown = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_UNKNOWN_FIELD }),
      tables: [FACT]
    });
    const classes = [
      ["row_policy_template_unresolved", `${previewReason(missing.body)} ${missing.text}`],
      ["row_policy_op_forbidden", `${previewReason(illegal.body)} ${illegal.text}`],
      ["row_policy_predicates_required", errorBlob(empty)],
      ["row_policy_field_unresolved:measure", `${previewReason(measure.body)} ${measure.text}`],
      ["row_policy_field_unknown", `${previewReason(unknown.body)} ${unknown.text}`]
    ] as const;
    const distinct = new Set(classes.map(([code]) => code));
    const allNamed = classes.every(([code, text]) => text.includes(code));
    assertion(
      testInfo,
      "deny",
      distinct.size === 5 && allNamed && missing.body?.data?.confirmation === undefined && unknown.body?.data?.confirmation === undefined,
      `RTP25-03 classes=${classes.map(([code, text]) => `${code}:${text.includes(code)}`).join(",")}`
    );
    assertion(
      testInfo,
      "allow_control",
      empty.status >= 400 && empty.body?.data?.written !== true && previewRefused(measure.body, measure.status) && illegal.body?.data?.ok !== true,
      `RTP25-03 empty=${empty.status} measureOk=${measure.body?.data?.ok} illegalOk=${illegal.body?.data?.ok}`
    );
    const afterNames = templateNames((await templateCatalog(page)).body);
    const afterRole = rolePolicyText((await roleDocument(page, ROLES.east)).body);
    assertion(
      testInfo,
      "no_side_effect",
      sameSet(beforeNames, afterNames) && beforeRole === afterRole && !afterNames.includes("rtp_probe_empty"),
      `RTP25-03 templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`
    );
    assertNoLeak(testInfo, `${missing.text}\n${empty.text}\n${unknown.text}`, "RTP25-03 refusal carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-04"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-04");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const removed = await requestJson(page, "delete", `/api/admin/row-policy/templates/${TPL_EQ}`, { dryRun: false });
    const renamed = await requestJson(page, "patch", `/api/admin/row-policy/templates/${TPL_EQ}`, {
      dryRun: true,
      name: "rtp_eq_renamed",
      description: "must not rename",
      predicates: [regionProbe()]
    });
    assertion(
      testInfo,
      "deny",
      removed.status === 409 &&
        String(removed.body?.error?.code ?? "") === "row_policy_template_in_use" &&
        renamed.status === 409 &&
        String(renamed.body?.error?.code ?? "") === "row_policy_template_in_use",
      `RTP25-04 delete=${removed.status}/${removed.body?.error?.code} rename=${renamed.status}/${renamed.body?.error?.code}`
    );

    let created = false;
    try {
      const saved = await writeTemplate(page, "post", "/api/admin/row-policy/templates", {
        name: PROBE_UNREFERENCED,
        description: "RTP25-04 unreferenced",
        predicates: [regionProbe()]
      });
      created = saved.body?.data?.written === true;
      const names = templateNames((await templateCatalog(page)).body);
      assertion(
        testInfo,
        "allow_control",
        created && saved.body?.data?.runtimeAck === true && names.includes(PROBE_UNREFERENCED) && names.includes(TPL_EQ),
        `RTP25-04 save status=${saved.status} written=${saved.body?.data?.written} runtimeAck=${saved.body?.data?.runtimeAck}`
      );
    } finally {
      if (created) await deleteProbe(page, PROBE_UNREFERENCED);
    }

    const external = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: MISSING_TEMPLATE }),
      tables: [FACT]
    });
    assertion(
      testInfo,
      "consistency",
      `${previewReason(external.body)} ${external.text}`.includes("row_policy_template_unresolved") && previewRefused(external.body, external.status),
      `RTP25-04 external missing template was accepted: ${previewReason(external.body).slice(0, 180)}`
    );
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), `RTP25-04 templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`);
    assertNoLeak(testInfo, `${removed.text}\n${renamed.text}`, "RTP25-04 refusal carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-05"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-05");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeVersion = await policyVersion(page);
    const beforeRole = await roleDocument(page, ROLES.east);
    const beforeTools = roleTools(beforeRole.body);
    const catalog = await templateCatalog(page);
    const tpl = templateRows(catalog.body).find((row) => row?.name === TPL_EQ);
    const description = typeof tpl?.description === "string" ? tpl.description : "";
    const predicates = predicatePayload(tpl?.predicates);
    assertion(
      testInfo,
      "allow_control",
      Boolean(tpl) && predicates.length > 0 && beforeVersion.length > 0 && beforeTools.includes("lucy_query"),
      `RTP25-05 policyVersion=${beforeVersion} tools=${beforeTools.join(",")}`
    );
    let changed = false;
    try {
      const written = await writeTemplate(page, "patch", `/api/admin/row-policy/templates/${TPL_EQ}`, {
        description: `${description} rtp05`,
        predicates
      });
      changed = written.body?.data?.written === true;
      const nextVersion = await policyVersion(page);
      const nextTools = roleTools((await roleDocument(page, ROLES.east)).body);
      assertion(
        testInfo,
        "consistency",
        changed &&
          written.body?.data?.runtimeAck === true &&
          nextVersion.length > 0 &&
          nextVersion !== beforeVersion &&
          sameSet(beforeTools, nextTools),
        `RTP25-05 written=${written.body?.data?.written} runtimeAck=${written.body?.data?.runtimeAck} ${beforeVersion} -> ${nextVersion}`
      );
      assertNoLeak(testInfo, written.text, "RTP25-05 save carries no credential");
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
      `RTP25-05 restored policyVersion=${restoredVersion} description=${restored?.description}`
    );
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-06"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-06");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const payload = {
      name: PROBE_STALE,
      description: "RTP25-06 baseline",
      predicates: [regionProbe()]
    };
    let created = false;
    try {
      const dry = await requestJson(page, "post", "/api/admin/row-policy/templates", { ...payload, dryRun: true });
      const digest = dry.body?.data?.candidateDigest;
      const version = dry.body?.data?.version;
      const stale = await requestJson(page, "post", "/api/admin/row-policy/templates", {
        ...payload,
        dryRun: false,
        version,
        candidateDigest: "0".repeat(64)
      });
      const absent = templateNames((await templateCatalog(page)).body);
      assertion(
        testInfo,
        "deny",
        dry.status === 200 &&
          dry.body?.data?.written === false &&
          typeof digest === "string" &&
          digest.length > 0 &&
          stale.status === 409 &&
          String(stale.body?.error?.code ?? "") === "NEW_PREVIEW_REQUIRED" &&
          !absent.includes(PROBE_STALE),
        `RTP25-06 dry=${dry.status} stale=${stale.status}/${stale.body?.error?.code}`
      );
      const commit = await requestJson(page, "post", "/api/admin/row-policy/templates", {
        ...payload,
        dryRun: false,
        version,
        candidateDigest: digest
      });
      created = commit.body?.data?.written === true;
      assertion(
        testInfo,
        "allow_control",
        created && commit.body?.data?.runtimeAck === true && commit.body?.data?.candidateDigest !== "0".repeat(64),
        `RTP25-06 commit status=${commit.status} written=${commit.body?.data?.written} runtimeAck=${commit.body?.data?.runtimeAck}`
      );

      const moved = await requestJson(page, "patch", `/api/admin/row-policy/templates/${PROBE_STALE}`, {
        dryRun: true,
        description: "RTP25-06 moved",
        predicates: [regionProbe()]
      });
      const rejectedOld = await requestJson(page, "patch", `/api/admin/row-policy/templates/${PROBE_STALE}`, {
        dryRun: false,
        version,
        candidateDigest: digest,
        description: "RTP25-06 moved",
        predicates: [regionProbe()]
      });
      assertion(
        testInfo,
        "consistency",
        moved.status === 200 &&
          typeof moved.body?.data?.candidateDigest === "string" &&
          moved.body.data.candidateDigest !== digest &&
          rejectedOld.status === 409 &&
          String(rejectedOld.body?.error?.code ?? "") === "NEW_PREVIEW_REQUIRED",
        `RTP25-06 movedDigest=${moved.body?.data?.candidateDigest} rejected=${rejectedOld.status}/${rejectedOld.body?.error?.code}`
      );
      assertNoLeak(testInfo, `${dry.text}\n${stale.text}\n${commit.text}`, "RTP25-06 preview carries no credential");
    } finally {
      if (created) await deleteProbe(page, PROBE_STALE);
    }
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), `RTP25-06 templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`);
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-07"], async ({}, testInfo) => {
  coversV025(testInfo, "RTP25-07");
  blockUnless(testInfo, ...LIVE, "fault-control");
  markBlocked(testInfo, "fault-control is present but this pack has no template recovery-failure harness");
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-08"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-08");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const query = `?${viewQuery({ connectionId: FACT.connection, schema: FACT.schema, sourceName: FACT.name })}`;
    const catalog = await templateCatalog(page, query);
    const rows = templateRows(catalog.body);
    const unknown = rows.find((row) => row?.name === TPL_UNKNOWN_FIELD);
    const usable = unknown?.usabilityByTable?.find(
      (item: Json) => item?.connectionId === FACT.connection && item?.schema === FACT.schema && item?.sourceName === FACT.name
    );
    const status = String(usable?.usability?.status ?? "");
    const reason = String(usable?.usability?.reason ?? "");
    const fields = Array.isArray(usable?.usability?.fields) ? usable.usability.fields.map(String) : [];
    assertion(
      testInfo,
      "allow_control",
      catalog.status === 200 && Boolean(unknown) && status.length > 0 && status !== "bindable",
      `RTP25-08 ${TPL_UNKNOWN_FIELD} status=${status} on ${FACT_KEY}`
    );
    assertion(
      testInfo,
      "consistency",
      reason.length > 0 || fields.includes("ghost_column"),
      `RTP25-08 reason="${reason}" fields=${JSON.stringify(fields)}`
    );
    assertion(
      testInfo,
      "deny",
      rows.some((row) => row?.name === TPL_EQ) && beforeNames.includes(TPL_UNKNOWN_FIELD),
      "RTP25-08 hid the unbindable template until save"
    );
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), "RTP25-08 usability read wrote the catalog");
    assertNoLeak(testInfo, catalog.text, "RTP25-08 catalog carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-09"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-09");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    let created = false;
    try {
      const saved = await writeTemplate(page, "post", "/api/admin/row-policy/templates", {
        name: PROBE_AUDIT,
        description: "RTP25-09 audit",
        predicates: [regionProbe()]
      });
      created = saved.body?.data?.written === true;
      const patched = created
        ? await writeTemplate(page, "patch", `/api/admin/row-policy/templates/${PROBE_AUDIT}`, {
            description: "RTP25-09 audit patched",
            predicates: [regionProbe()]
          })
        : saved;
      const createId = String(saved.body?.data?.operationId ?? "");
      const patchId = String(patched.body?.data?.operationId ?? "");
      assertion(
        testInfo,
        "allow_control",
        created && patched.body?.data?.written === true && createId.length > 0 && patchId.length > 0,
        `RTP25-09 create=${saved.status}/${createId} patch=${patched.status}/${patchId}`
      );
      await deleteProbe(page, PROBE_AUDIT);
      created = templateNames((await templateCatalog(page)).body).includes(PROBE_AUDIT);

      const audit = await requestJson(page, "get", `/api/admin/config-audit?targetId=${PROBE_AUDIT}&limit=20`);
      const entries = Array.isArray(audit.body?.data?.entries) ? (audit.body.data.entries as Json[]) : [];
      const types = entries.map((entry) => String(entry?.changeType ?? ""));
      const createEntry = entries.find((entry) => entry?.changeType === "row_policy_template_create");
      const patchEntry = entries.find((entry) => entry?.changeType === "row_policy_template_patch");
      const deleteEntry = entries.find((entry) => entry?.changeType === "row_policy_template_delete");
      const summarized = [createEntry, patchEntry, deleteEntry].every((entry) => {
        if (!entry) return false;
        const actor = String(entry.actor ?? "");
        const requestId = String(entry.requestId ?? "");
        const summary = JSON.stringify(entry.newSummary ?? entry.oldSummary ?? {});
        return actor.length > 0 && requestId.length > 0 && summary.length > 2;
      });
      assertion(
        testInfo,
        "consistency",
        audit.status === 200 &&
          types.includes("row_policy_template_create") &&
          types.includes("row_policy_template_patch") &&
          types.includes("row_policy_template_delete") &&
          summarized &&
          String(createEntry?.requestId ?? "") === createId,
        `RTP25-09 types=${types.join(",")} createRequest=${createEntry?.requestId}`
      );
      const impact = JSON.stringify(createEntry?.newSummary ?? {});
      assertion(
        testInfo,
        "deny",
        impact.includes(PROBE_AUDIT) && (impact.includes("digest") || impact.includes("templates")),
        `RTP25-09 create summary=${impact.slice(0, 240)}`
      );
      assertNoLeak(testInfo, `${saved.text}\n${audit.text}`, "RTP25-09 audit carries no credential");
    } finally {
      await deleteProbe(page, PROBE_AUDIT);
    }
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), `RTP25-09 templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`);
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTP25-10"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTP25-10");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const beforeWest = rolePolicyText((await roleDocument(page, ROLES.west)).body);
    const detail = await viewDetail(page);
    const west = viewRole(detail.body, ROLES.west);
    const westRefs = Array.isArray(west?.templateRefs) ? west.templateRefs.map(String) : [];
    const westRegions = grantRegionValues(west?.rowGrant);
    assertion(
      testInfo,
      "allow_control",
      detail.status === 200 &&
        west?.rowAccess === "scoped" &&
        west?.rowGrant?.kind === "scoped" &&
        westRefs.length === 0 &&
        sameSet(westRegions, [REGIONS.B]) &&
        !beforeWest.includes('"template"'),
      `RTP25-10 rp_west refs=${JSON.stringify(westRefs)} regions=${JSON.stringify(westRegions)}`
    );

    const v1 = await requestJson(page, "post", "/api/admin/roles", {
      dryRun: true,
      roleId: PROBE_V1,
      role: {
        description: "RTP25-10 v1 probe",
        permission_model_version: 1,
        allow: {
          connections: [FACT.connection],
          tableSelectors: [
            {
              connection: FACT.connection,
              schema: FACT.schema,
              names: [FACT.name],
              row_access: "scoped",
              row_policy: { template: TPL_EQ }
            }
          ],
          tools: ["lucy_query"]
        }
      }
    });
    const v1Code = String(v1.body?.error?.code ?? "");
    const migration = v1.body?.data?.migration ?? {};
    const migrated = v1.status === 200 && Number(migration.fromVersion) === 1 && Number(migration.toVersion) === 2;
    const stillStoredAsV1 = /permission_model_version:\s*1\b/.test(String(v1.body?.data?.proposedYaml ?? ""));
    const v1Rejected = v1.status >= 400 && (v1Code === "v1_template_reference_forbidden" || v1.text.includes("v1_template_reference_forbidden"));
    const v1Stored = await roleDocument(page, PROBE_V1);
    assertion(
      testInfo,
      "deny",
      (v1Rejected || (migrated && !stillStoredAsV1)) && v1Stored.status === 404 && v1.body?.data?.written !== true,
      `RTP25-10 v1 status=${v1.status} code=${v1Code} migration=${JSON.stringify(migration)} stored=${v1Stored.status}`
    );

    const illegal = await requestJson(page, "post", "/api/admin/roles", {
      dryRun: true,
      roleId: PROBE_ALL,
      role: {
        description: "RTP25-10 all plus template",
        permission_model_version: 2,
        allow: {
          connections: [FACT.connection],
          tableSelectors: [
            {
              connection: FACT.connection,
              schema: FACT.schema,
              names: [FACT.name],
              row_access: "all",
              row_policy: { template: TPL_EQ }
            }
          ],
          tools: ["lucy_query"]
        }
      }
    });
    const legacy = await requestJson(page, "post", "/api/admin/row-policy/templates/validate", {
      operation: {
        kind: "create",
        name: "rtp_probe_legacy",
        definition: { predicates: [regionProbe()], unexpected_key: true }
      }
    });
    const stillForbidden = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_ILLEGAL_OP }),
      tables: [FACT]
    });
    assertion(
      testInfo,
      "consistency",
      illegal.status >= 400 &&
        errorBlob(illegal).includes("scoped") &&
        legacy.status >= 400 &&
        (errorBlob(legacy).includes("row_policy_template_shape_invalid") || errorBlob(legacy).includes("unexpected_key")) &&
        `${previewReason(stillForbidden.body)} ${stillForbidden.text}`.includes("row_policy_op_forbidden"),
      `RTP25-10 all=${illegal.status} legacy=${legacy.status}/${legacy.body?.error?.code} illegalOp=${previewReason(stillForbidden.body).slice(0, 120)}`
    );
    const afterNames = templateNames((await templateCatalog(page)).body);
    const afterWest = rolePolicyText((await roleDocument(page, ROLES.west)).body);
    const storedAll = await roleDocument(page, PROBE_ALL);
    assertion(
      testInfo,
      "no_side_effect",
      sameSet(beforeNames, afterNames) && beforeWest === afterWest && storedAll.status === 404,
      `RTP25-10 west changed or probe role persisted (${storedAll.status})`
    );
    assertNoLeak(testInfo, `${detail.text}\n${v1.text}\n${illegal.text}\n${legacy.text}`, "RTP25-10 refusal carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-01"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-01");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const detail = await viewDetail(page);
    const table = detail.body?.data?.table ?? {};
    const identity = snapshotIdentity(detail.body);
    const roleIds = [ROLES.east, ROLES.west, ROLES.all, ROLES.eastPlusInline];
    const agentIds = [AGENTS.east, AGENTS.eastWest, AGENTS.all, AGENTS.eastConstrained];
    const rolesReady = roleIds.every((roleId) => {
      const role = viewRole(detail.body, roleId);
      return Boolean(role) && (role?.rowGrant?.kind === "scoped" || role?.rowGrant?.kind === "all");
    });
    const agentsReady = agentIds.every((agentId) => {
      const agent = viewAgent(detail.body, agentId);
      return Boolean(agent) && (agent?.finalRows?.kind === "scoped" || agent?.finalRows?.kind === "all");
    });
    assertion(
      testInfo,
      "allow_control",
      detail.status === 200 &&
        table.connectionId === FACT.connection &&
        table.schema === FACT.schema &&
        table.sourceName === FACT.name &&
        rolesReady &&
        agentsReady,
      `RTV25-01 table=${table.connectionId}/${table.schema}/${table.sourceName} roles=${rolesReady} agents=${agentsReady}`
    );
    assertion(
      testInfo,
      "consistency",
      identityComplete(identity) && detail.body?.data?.effectiveRowGrant?.kind !== undefined,
      `RTV25-01 identity=${JSON.stringify(identity)} union=${detail.body?.data?.effectiveRowGrant?.kind}`
    );
    assertNoLeak(testInfo, detail.text, "RTV25-01 detail carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-02"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-02");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const detail = await viewDetail(page);
    const east = viewRole(detail.body, ROLES.east);
    const west = viewRole(detail.body, ROLES.west);
    const all = viewRole(detail.body, ROLES.all);
    assertion(
      testInfo,
      "deny",
      east?.rowAccess === "scoped" &&
        west?.rowAccess === "scoped" &&
        east?.rowGrant?.kind !== "all" &&
        west?.rowGrant?.kind !== "all" &&
        grantRegionValues(east?.rowGrant).includes(REGIONS.A) &&
        grantRegionValues(west?.rowGrant).includes(REGIONS.B),
      `RTV25-02 east=${east?.rowAccess}/${east?.rowGrant?.kind} west=${west?.rowAccess}/${west?.rowGrant?.kind}`
    );
    const union = await previewRole(page, { roleId: ROLES.east, tables: [FACT] });
    const twoRoles = agentGrant(union.body, AGENTS.eastWest);
    assertion(
      testInfo,
      "consistency",
      twoRoles?.kind === "scoped" && twoRoles?.kind !== "all",
      `RTV25-02 ag_east_west kind=${twoRoles?.kind} must not become 全部行`
    );
    assertion(
      testInfo,
      "allow_control",
      all?.rowAccess === "all" && all?.rowGrant?.kind === "all" && detail.body?.data?.effectiveRowGrant?.kind === "all",
      `RTV25-02 rp_all=${all?.rowAccess}/${all?.rowGrant?.kind} union=${detail.body?.data?.effectiveRowGrant?.kind}`
    );
    assertNoLeak(testInfo, `${detail.text}\n${union.text}`, "RTV25-02 view carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-03"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-03");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeAgent = await requestJson(page, "get", `/api/admin/agents/${AGENTS.eastConstrained}`);
    const beforeConstraints = JSON.stringify(beforeAgent.body?.data?.agent?.constraints ?? null);
    const emptyFilter = await viewList(page, {
      connectionId: FACT.connection,
      schema: FACT.schema,
      sourceName: "__rtp_no_such_table__"
    });
    const ungranted = await viewDetail(page, UNGRANTED);
    const compile = await previewRole(page, {
      roleId: ROLES.east,
      role: scopedRole({ template: TPL_UNKNOWN_FIELD }),
      tables: [FACT]
    });
    const unsatisfiable = await requestJson(page, "patch", `/api/admin/agents/${AGENTS.eastConstrained}`, {
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
    const labels = [
      String(emptyFilter.body?.data?.status ?? ""),
      String(ungranted.body?.data?.status ?? ""),
      `${previewReason(compile.body)} ${compile.text}`.includes("row_policy_field_unknown") ? "compile_failed" : "",
      errorBlob(unsatisfiable).includes("final_rows_unsatisfiable") ? "final_rows_unsatisfiable" : ""
    ];
    assertion(
      testInfo,
      "consistency",
      labels[0] === "no_match" &&
        labels[1] === "no_applicable_grant" &&
        labels[2] === "compile_failed" &&
        labels[3] === "final_rows_unsatisfiable" &&
        new Set(labels).size === 4,
      `RTV25-03 states=${labels.join("|")}`
    );
    assertion(
      testInfo,
      "deny",
      emptyFilter.body?.data?.tables?.length === 0 &&
        ungranted.body?.data?.effectiveRowGrant == null &&
        ungranted.body?.data?.effectiveRowGrant?.kind !== "all" &&
        compile.body?.data?.confirmation === undefined &&
        unsatisfiable.body?.data?.written !== true,
      `RTV25-03 empty=${emptyFilter.body?.data?.status} ungrantedGrant=${ungranted.body?.data?.effectiveRowGrant?.kind}`
    );
    const afterAgent = await requestJson(page, "get", `/api/admin/agents/${AGENTS.eastConstrained}`);
    assertion(
      testInfo,
      "no_side_effect",
      beforeConstraints === JSON.stringify(afterAgent.body?.data?.agent?.constraints ?? null),
      "RTV25-03 unsatisfiable dry-run wrote agent constraints"
    );
    assertNoLeak(testInfo, `${ungranted.text}\n${unsatisfiable.text}`, "RTV25-03 refusal carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-04"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-04");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const list = await viewList(page);
    const keys = [...rowPolicyViewTableKeys(viewTables(list.body))];
    const factHits = viewTables(list.body).filter(
      (row) => row?.connectionId === FACT.connection && row?.schema === FACT.schema && row?.sourceName === FACT.name
    );
    const exact = await viewList(page, {
      connectionId: FACT.connection,
      schema: FACT.schema,
      sourceName: FACT.name
    });
    const otherSchema = await viewDetail(page, { connection: FACT.connection, schema: "not_dataforai", name: FACT.name });
    const otherTable = otherSchema.body?.data?.table ?? {};
    const otherGrants = Array.isArray(otherSchema.body?.data?.roles)
      ? otherSchema.body.data.roles.filter((role: Json) => role?.rowGrant)
      : [];
    assertion(
      testInfo,
      "allow_control",
      keys.includes(FACT_KEY) &&
        factHits.length === 1 &&
        viewTables(exact.body).length === 1 &&
        factListRow(exact.body)?.connectionId === FACT.connection,
      `RTV25-04 keys=${keys.join(",")} exact=${viewTables(exact.body).length}`
    );
    assertion(
      testInfo,
      "deny",
      otherTable.schema === "not_dataforai" &&
        otherTable.sourceName === FACT.name &&
        otherSchema.body?.data?.status === "no_applicable_grant" &&
        otherGrants.length === 0,
      `RTV25-04 other schema=${otherTable.schema} status=${otherSchema.body?.data?.status} grants=${otherGrants.length}`
    );
    const restricted = await viewList(page, { restricted: "true" });
    assertion(
      testInfo,
      "consistency",
      Boolean(factListRow(restricted.body)) && factListRow(restricted.body)?.restricted === true,
      `RTV25-04 restricted filter dropped ${FACT_KEY}`
    );

    const deepLink = `/admin/row-policies?connectionId=${encodeURIComponent(FACT.connection)}&schema=${encodeURIComponent(FACT.schema)}&sourceName=${encodeURIComponent(FACT.name)}`;
    await page.goto(deepLink);
    await expect(page.getByTestId("row-policy-view-page")).toBeVisible();
    const row = page.getByTestId(`row-policy-view-table-${FACT.connection}-${FACT.schema}-${FACT.name}`);
    await expect(row).toBeVisible();
    const url = page.url();
    assertion(
      testInfo,
      "consistency",
      url.includes(`connectionId=${encodeURIComponent(FACT.connection)}`) &&
        url.includes(`schema=${encodeURIComponent(FACT.schema)}`) &&
        url.includes(`sourceName=${encodeURIComponent(FACT.name)}`),
      `RTV25-04 deep link ${url}`
    );
    assertNoLeak(testInfo, `${list.text}\n${otherSchema.text}`, "RTV25-04 view carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-05"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-05");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const list = await viewList(page);
    const detail = await viewDetail(page);
    const state = String(list.body?.data?.state ?? "");
    const status = String(list.body?.data?.status ?? "");
    const failures = Array.isArray(list.body?.data?.failures) ? (list.body.data.failures as Json[]) : [];
    const fact = factListRow(list.body);
    const failedSetVisible = failures.every(
      (failure) => typeof failure?.subjectId === "string" && failure.subjectId.length > 0 && typeof failure?.reason === "string" && failure.reason.length > 0
    );
    const zeroAuthorization =
      status === "ok" &&
      (fact?.roleCount === 0 || fact?.grantStatus === "no_applicable_grant");
    let classified = false;
    if (state === "ok") {
      classified = failures.length === 0 && status === "ok" && Number(fact?.roleCount ?? 0) >= 2 && (fact?.grantStatus === "scoped" || fact?.grantStatus === "all");
    } else if (state === "partial") {
      classified = failures.length > 0 && failedSetVisible && status !== "unavailable" && Number(fact?.roleCount ?? 0) > 0;
    } else if (state === "unavailable") {
      classified = status === "unavailable" && failedSetVisible && viewTables(list.body).every((row) => row?.grantStatus !== "all");
    }
    const unionKind = detail.body?.data?.effectiveRowGrant?.kind;
    assertion(
      testInfo,
      "consistency",
      classified && failedSetVisible,
      `RTV25-05 state=${state} status=${status} failures=${failures.length} roleCount=${fact?.roleCount} grantStatus=${fact?.grantStatus}`
    );
    assertion(
      testInfo,
      "deny",
      !zeroAuthorization && status !== "no_match" && (state === "unavailable" || unionKind === "scoped" || unionKind === "all"),
      `RTV25-05 presented zero authorization state=${state} status=${status} union=${unionKind}`
    );
    assertNoLeak(testInfo, list.text, "RTV25-05 list carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-06"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-06");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const list = await viewList(page);
    const map = await requestJson(page, "get", "/api/admin/access-map");
    const viewKeys = rowPolicyViewTableKeys(viewTables(list.body));
    const mapNodes = Array.isArray(map.body?.data?.nodes) ? map.body.data.nodes : [];
    const mapKeys = accessMapTableKeys(
      mapNodes.filter((node: Json) => node?.kind === "table").map((node: Json) => String(node?.id ?? ""))
    );
    const orphans = [...viewKeys].filter((key) => !mapKeys.has(key));
    const counts = map.body?.data?.meta?.counts ?? {};
    const fact = factListRow(list.body);
    const viewIdentity = snapshotIdentity(list.body);
    const mapPolicy = String(map.body?.data?.meta?.grant?.policyVersion ?? "");
    assertion(
      testInfo,
      "consistency",
      list.status === 200 &&
        map.status === 200 &&
        viewKeys.has(FACT_KEY) &&
        mapKeys.has(FACT_KEY) &&
        orphans.length === 0 &&
        viewIdentity.policyVersion === mapPolicy &&
        mapPolicy.length > 0,
      `RTV25-06 fact=${viewKeys.has(FACT_KEY)}/${mapKeys.has(FACT_KEY)} orphans=${orphans.join(",")} policy=${viewIdentity.policyVersion} vs ${mapPolicy}`
    );
    assertion(
      testInfo,
      "allow_control",
      typeof counts.tables === "number" &&
        typeof counts.grantPaths === "number" &&
        counts.grantPaths > counts.tables &&
        Number(fact?.roleCount ?? 0) > viewKeys.size,
      `RTV25-06 tables=${counts.tables} grantPaths=${counts.grantPaths} roleCount=${fact?.roleCount} viewTables=${viewKeys.size}`
    );
    assertNoLeak(testInfo, `${list.text}\n${map.text}`, "RTV25-06 reconciliation carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-07"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-07");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const reads = await viewList(page);
    const writes = await Promise.all([
      requestJson(page, "post", "/api/admin/row-policy/views/tables", {}),
      requestJson(page, "patch", "/api/admin/row-policy/views/table", {}),
      requestJson(page, "delete", "/api/admin/row-policy/views/tables", {})
    ]);
    assertion(
      testInfo,
      "deny",
      reads.status === 200 && writes.every((res) => res.status === 404 || res.status === 405),
      `RTV25-07 GET=${reads.status} writes=${writes.map((res) => res.status).join(",")}`
    );
    await page.goto(
      `/admin/row-policies?connectionId=${encodeURIComponent(FACT.connection)}&schema=${encodeURIComponent(FACT.schema)}&sourceName=${encodeURIComponent(FACT.name)}`
    );
    await expect(page.getByTestId("row-policy-view-page")).toBeVisible();
    await expect(page.getByTestId("row-policy-view-table-list")).toBeVisible();
    const pageCount = await page.getByTestId("row-policy-view-page").count();
    const writeControls = await page.getByRole("button", { name: /保存|新建|删除|提交/ }).count();
    const tableCount = await page.getByTestId("row-policy-view-table-list").count();
    const translate = await page.locator("#row-policy-filter-connection[translate=no]").count();
    const filter = page.locator("#row-policy-filter-connection");
    const focusable = (await filter.count()) > 0 && (await filter.isEnabled());
    assertion(
      testInfo,
      "allow_control",
      pageCount === 1 && writeControls === 0 && tableCount === 1 && translate === 1 && focusable,
      `RTV25-07 page=${pageCount} writes=${writeControls} table=${tableCount} translate=${translate} focusable=${focusable}`
    );
    const body = await page.locator("body").innerText();
    assertNoLeak(testInfo, body, "RTV25-07 page carries no credential");
  });
});

test(RTP_RTV_OWNER_SYMBOLS["RTV25-08"], async ({ browser }, testInfo) => {
  coversV025(testInfo, "RTV25-08");
  requireLive(testInfo);
  await withOwner(browser, async (page) => {
    const beforeNames = templateNames((await templateCatalog(page)).body);
    const list = await viewList(page);
    const detail = await viewDetail(page);
    const listIdentity = snapshotIdentity(list.body);
    const detailIdentity = snapshotIdentity(detail.body);
    assertion(
      testInfo,
      "consistency",
      identityComplete(listIdentity) &&
        identityComplete(detailIdentity) &&
        listIdentity.configVersion === detailIdentity.configVersion &&
        listIdentity.policyVersion === detailIdentity.policyVersion &&
        listIdentity.sourceMapVersion === detailIdentity.sourceMapVersion,
      `RTV25-08 list=${JSON.stringify(listIdentity)} detail=${JSON.stringify(detailIdentity)}`
    );
    let created = false;
    try {
      const written = await writeTemplate(page, "post", "/api/admin/row-policy/templates", {
        name: PROBE_GENERATION,
        description: "RTV25-08 generation",
        predicates: [regionProbe()]
      });
      created = written.body?.data?.written === true;
      const refreshed = await viewList(page);
      const next = snapshotIdentity(refreshed.body);
      assertion(
        testInfo,
        "allow_control",
        created &&
          identityComplete(next) &&
          (next.configVersion !== listIdentity.configVersion || next.policyVersion !== listIdentity.policyVersion),
        `RTV25-08 config ${listIdentity.configVersion} -> ${next.configVersion} policy ${listIdentity.policyVersion} -> ${next.policyVersion}`
      );
      assertNoLeak(testInfo, `${list.text}\n${written.text}`, "RTV25-08 snapshot carries no credential");
    } finally {
      if (created) await deleteProbe(page, PROBE_GENERATION);
    }
    const afterNames = templateNames((await templateCatalog(page)).body);
    assertion(testInfo, "no_side_effect", sameSet(beforeNames, afterNames), `RTV25-08 templates ${beforeNames.join(",")} -> ${afterNames.join(",")}`);
  });
});
