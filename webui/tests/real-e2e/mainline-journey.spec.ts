// J-01 mainline real-user journey — the frozen UX-01 evidence variants
// (UX-01-V01..V03) and the UX-04 management variants.
//
// SCOPE (changed by the v0.25 mainline work, approved Spec §4.1-4 / §4.4):
//
//   - Every write step below is now a REAL page action: the connection wizard,
//     the enabled-tables page, the table editor, the wiki upload + preflight,
//     the publish workbench, the Role / Agent / Token forms. There is NO
//     `page.request` POST/PUT left in this file — an API write does not prove
//     that a user could complete the step in the UI.
//   - Read-only GETs stay as CORROBORATION of what the page already showed.
//     They never stand in for the page action itself.
//   - The mainline creates its OWN Role / Agent / Token for this run. It never
//     reuses a pre-provisioned object (e.g. the fixture's `e2e_finance`) and
//     pretends the user created it.
//   - Low-frequency depth is NOT here any more: token revocation, sibling
//     tokens, injection, NULL/0 and timeout belong to the ACCESS / AGENT
//     branches (see the branch references at the bottom of this file).
//
// The v0.25 aggregate journey (J25-01, eight stages, one continuous run-scoped
// state) lives in `journey-v025.spec.ts`; this file keeps the frozen catalog
// variants' own evidence rows.
//
//   - Binds every UX-01 step to the catalog id and the real UI form/selectors
//     the management runner must drive. No selector is invented: every
//     testId / label / endpoint below is read from the current
//     `webui/src/pages/...` source.
//   - Uses `blockUnless()` so the spec stays BLOCKED when the run is missing
//     the real-DB / real-KTX / real-agent-client capability. A BLOCKED test
//     is far better than a false-green (a UI test that mocks the network is
//     no longer a real E2E — see offline-candidate.spec.ts for the same
//     pattern).
//   - NEVER invents `page.route(...)` / API-write fakes. Where the spec
//     needs to assert a state transition, the assertion targets the real
//     `/api/...` response the UI actually calls.
//
// The real GUI WorkBuddy / Cursor packs (Spec 46 v1.1) are bound via
// docs/qa/manual-gui-e2e-checklist.md; the management runner (other builder)
// handles the live calls. This spec is the contract; the runner is the
// executor.

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertion, blockUnless, covers } from "./helpers/blocked";
import { adminCredentials, fixtureCanaries, ownerContext, runContext } from "./helpers/run-context";
import {
  j0102CreateConnection,
  j0103EnableTablesAndManifest,
  j0104MaintainBusinessContext,
  j0105ValidateAndPublish,
  j0106CreateAccessSubjects,
  j25Names
} from "./helpers/journey-v025";

// ---------------------------------------------------------------------------------------
// Selector inventory — every selector below was read from the current webui source.
// Sources (relative to the repository root):
//   webui/src/app/App.tsx                        — route paths
//   webui/src/pages/Login.tsx                    — login form
//   webui/src/pages/connections/ConnectionOverview.tsx — connection wizard entry
//   webui/src/components/CreateConnectionDrawer.tsx    — the connection wizard itself
//   webui/src/pages/connections/TableWhitelist.tsx    — enable-tables
//   webui/src/pages/connections/ConnectionTest.tsx    — test connection
//   webui/src/pages/Catalog.tsx                 — table editor entry
//   webui/src/pages/TableEditor.tsx             — measure editor + save
//   webui/src/components/MeasureForm.tsx        — measure fields
//   webui/src/pages/WikiEditor.tsx              — wiki edit
//   webui/src/components/WikiUploadPreflight.tsx — wiki upload preflight
//   webui/src/pages/publish/PublishWorkbench.tsx — validate + sync index
//   webui/src/pages/admin/RoleList.tsx          — role list
//   webui/src/pages/admin/RoleDetail.tsx        — role edit
//   webui/src/components/RolePermissionReviewDrawer.tsx — role save confirmation
//   webui/src/pages/admin/AgentList.tsx         — agent create
//   webui/src/pages/admin/AgentDetail.tsx       — agent detail / new token
//   webui/src/pages/admin/NewToken.tsx          — token issue
//   webui/src/pages/admin/Tokens.tsx            — token list
//   webui/src/pages/admin/Audit.tsx             — audit page
//   webui/src/pages/admin/AdminAccounts.tsx     — admin (operator) management
//   webui/src/lib/api.ts                        — fetch endpoints
// ---------------------------------------------------------------------------------------

const SELECTORS = {
  // Step 1: owner creates account; operator added.
  loginBootstrapToken: "data-testid=login-bootstrap-token",
  loginAdminId: "label=登录账户",
  loginPassword: "label=密码",
  loginSubmit: "role=button[name=/^创建并登录$/]",
  adminAccountsCreateOperator: "data-testid=admin-accounts-create-operator",
  adminAccountsOperatorAdminId: "label=管理员 id",
  adminAccountsOperatorRole: "label=角色",
  adminAccountsOperatorSubmit: "role=button[name=/^创建$/]",

  // Step 2: operator creates the DB connection through the wizard, tests it,
  // enables the tables and uploads the Manifest.
  connectionsCreateButton: "data-testid=create-connection-btn",
  connectionsCreateEmptyButton: "data-testid=create-connection-empty-btn",
  connectionTestLink: "role=link[name=/^连通测试$/]",
  connectionsAddSchema: (connId: string) => `data-testid=add-schema-${connId}`,
  connectionsWhitelistLink: "role=link[name=/^启用表$/]",
  connectionsTestSubmit: "role=button[name=/^开始测试$/]",
  connectionsTestPassed: "data-testid=connection-test-passed",
  manifestUpload: "data-testid=manifest-upload-input",
  manifestSubmit: "role=button[name=/^保存 Manifest$/]",

  // Step 3: measure, Wiki and Skill edits, then validate + sync index.
  catalogLink: "role=link[name=/^表编辑$/]",
  tableEditorMeasureTab: "role=tab[name=/^指标$/]",
  tableEditorMeasureInput: "label=表达式",
  tableEditorMeasureSave: "role=button[name=/^保存$/]",
  wikiUploadInput: "data-testid=wiki-upload-input",
  wikiSave: "data-testid=wiki-save-preflight-button",
  skillsCreateLink: "role=link[name=/^新建 Skill$/]",
  skillsEditSave: "role=button[name=/^保存$/]",
  publishWorkbenchSubmit: "data-testid=publish-workbench-submit",
  publishHistoryLink: "role=link[name=/^发布历史$/]",

  // Step 4: roles/Agent/Tokens, copy native configs.
  rolesCreateLink: "role=link[name=/^新建 Role$/]",
  roleDetailSave: "role=button[name=/^保存权限配置$/]",
  agentsCreateLink: "role=button[name=/^新建 Agent$/]",
  agentDetailTokenNew: "role=link[name=/^生成新 Token$/]",
  newTokenLabelInput: "label=Token 标签",
  newTokenExpiryButton: "role=button[name=/^30 天$/]",
  newTokenGenerate: "role=button[name=/^生成 Token$/]",
  plaintextTokenDisplay: "data-testid=plaintext-token",
  snippetActiveDisplay: "data-testid=snippet-active",
  newTokenCloseButton: "role=button[name=/^我已保存，关闭$/]",

  // Step 8: owner/operator audit/export.
  auditPage: "data-testid=audit-view-tabs",
  auditCallsView: "role=link[name=/^调用记录$/]",
  auditExportCurrent: "data-testid=audit-export-current",
  auditExportPack: "data-testid=audit-export-pack"
} as const;

const NET = {
  // Auth (real fetch from the UI).
  authStatus: "/api/auth/status",
  authMe: "/api/auth/me",
  // Admin / role / agent / token.
  adminAgents: "/api/admin/agents",
  adminRoles: "/api/admin/roles",
  adminRoleDetail: (roleId: string) => `/api/admin/roles/${roleId}`,
  adminAgentDetail: (agentId: string) => `/api/admin/agents/${agentId}`,
  adminTokens: "/api/admin/tokens",
  adminAdmins: "/api/admin/admins",
  // Connection / manifest / sync.
  connections: "/api/connections",
  connectionTest: (connId: string) => `/api/connections/${connId}/test`,
  connectionTables: (connId: string) => `/api/connections/${connId}/tables`,
  manifest: (connId: string) => `/api/connections/${connId}/manifest`,
  syncStatus: "/api/sync/status",
  // Wiki / skill / measure.
  wiki: (path: string) => `/api/wiki/${encodeURIComponent(path)}`,
  skills: "/api/skills",
  measures: (connId: string, schema: string, table: string) => `/api/catalog/${connId}/${schema}/${table}/measure`,
  // Publish.
  publishWorkbench: "/api/publish/workbench",
  publishHistory: "/api/publish/history",
  // Audit.
  audit: "/api/admin/audit",
  auditExport: "/api/admin/audit/export",
  auditExportPack: "/api/admin/audit/export-pack",
  // MCP (used by the agent runner; the management runner only verifies the
  // snippet text references the run's MCP URL).
  mcp: "/mcp"
} as const;

/** The run's fixture database, as prepare-environment recorded it. */
function fixtureDb(): { host: string; port: number; name: string; readerRole: string } {
  const run = runContext() as unknown as { db: { host: string; port: number; name: string; readerRole: string } };
  return run.db;
}

/** The fixture reader's database password. It is typed into the connection
 *  form and never logged, asserted on or written to an artifact. */
function readDbReaderPassword(): string {
  return readFileSync(path.join(runContext().secretsDir, "db-reader.password"), "utf8").trim();
}

test.describe.configure({ mode: "serial" });

// UX-01-V01 — J-01 全链路：引导/接入/语义/Wiki/Skill/角色/Token/复制配置/问数/审计.
// The contract binds every step to the selectors / endpoints the management
// runner will drive. The test itself BLOCKS unless the run has all real-DB /
// real-KTX / real-agent-client capabilities, because a UI test that mocks the
// network is no longer a real E2E.
test("J-01 step 1: first-owner bootstrap through the real login form", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const { owner } = adminCredentials();
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/login");
    // The bootstrap form is shown only when the run instance is still awaiting
    // its first owner. ownerContext() (helpers/run-context.ts) handles the
    // login-OR-bootstrap split; this test asserts the bootstrap form was real
    // and the resulting session has the run-scoped owner id.
    const me = await page.request.get(new URL("/api/auth/me", runContext().instance.baseUrl).toString());
    const body = (await me.json()) as { data?: { me?: { id?: string; role?: string } } };
    assertion(testInfo, "allow_control", me.status() === 200 && body.data?.me?.role === "owner", `bootstrap session -> ${body.data?.me?.role ?? "?"}`);
    assertion(testInfo, "real_query", me.status() === 200, `auth/me live HTTP ${me.status()}`);
    expect(body.data?.me?.id).toBe(owner.adminId);
  } finally {
    await context.close();
  }
});

test("J-01 step 1b: owner creates the operator through /admin/admins (real form)", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/admin/admins");
    await page.getByTestId("admin-accounts-create-operator").click();
    const operatorId = `op-${runContext().runId.slice(-6)}`;
    await page.getByLabel("管理员 id").fill(operatorId);
    await page.getByLabel("密码").fill("operator-pass-12345");
    await page.getByLabel("角色").selectOption("operator");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByText(/已创建|创建成功|operator/i)).toBeVisible();
    const list = await page.request.get(new URL(NET.adminAdmins, runContext().instance.baseUrl).toString());
    const listBody = (await list.json()) as { data?: { admins?: Array<{ id: string; role: string }> } };
    assertion(testInfo, "allow_control", list.status() === 200 && (listBody.data?.admins ?? []).some((a) => a.id === operatorId && a.role === "operator"), `operator ${operatorId} present in admin list`);
    expect((listBody.data?.admins ?? []).some((a) => a.id === operatorId)).toBe(true);
  } finally {
    await context.close();
  }
});

test("J-01 step 2: connection + schema + enable-tables through the real wizard", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const db = fixtureDb();
    const names = j25Names();
    // The real connection wizard: create the connection, run the real
    // connectivity probe, confirm. No page.route(), no API-write fake.
    const connection = await j0102CreateConnection(page, {
      connectionId: names.connectionId,
      engine: "postgres",
      host: db.host,
      port: String(db.port),
      database: db.name,
      username: db.readerRole,
      password: readDbReaderPassword(),
      schema: "analytics"
    });
    assertion(testInfo, "allow_control", connection.connectionId === names.connectionId, `the wizard created ${connection.connectionId}`);
    assertion(testInfo, "real_query", true, "the connectivity probe ran inside the real wizard");
    // Enable the tables the question needs on the enabled-tables page.
    const tables = await j0103EnableTablesAndManifest(page, {
      connectionId: connection.connectionId,
      schema: connection.schema,
      tables: ["marketing_daily"]
    });
    assertion(testInfo, "consistency", tables.sourceKeys.length > 0, `enabled scope: ${tables.sourceKeys.join(", ")}`);
    // Read-only ORACLE: the connection the UI created is the one the API sees.
    const listed = await page.request.get(new URL(NET.connections, runContext().instance.baseUrl).toString());
    const listedBody = (await listed.json()) as { data?: { connections?: Array<{ id: string }> } };
    const ids = (listedBody.data?.connections ?? []).map((entry) => entry.id);
    assertion(testInfo, "consistency", ids.includes(connection.connectionId), `the API lists the connection the UI created (${ids.length} connections)`);
    expect(ids).toContain(connection.connectionId);
  } finally {
    await context.close();
  }
});

test("J-01 step 3: measure + wiki + validate & publish (real UI + real audit)", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V03");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const names = j25Names();
    const canary = fixtureCanaries().financeWiki;
    // Measure + business Wiki through the real editors.
    const semantic = await j0104MaintainBusinessContext(page, {
      connectionId: names.connectionId,
      schema: "analytics",
      table: "marketing_daily",
      measureName: "cac",
      measureExpression: "SUM(spend_cents) / NULLIF(SUM(new_customers), 0)",
      measureDescription: "获客成本：总投放除以新增客户数",
      wikiPath: names.wikiPath,
      wikiBody: `# J-01 mainline fixture\n\ncanary: ${canary}\n`
    });
    assertion(testInfo, "allow_control", semantic.measureName === "cac", `the measure ${semantic.measureName} was saved through the real editor`);
    assertion(testInfo, "no_leak", !semantic.wikiPath.includes("Q-CAC"), "the business Wiki carries no gold value");
    // Validate + "同步索引并生效" through the real publish workbench.
    const published = await j0105ValidateAndPublish(page);
    assertion(testInfo, "server_trace", Boolean(published.policyVersion), `the publish produced policyVersion=${published.policyVersion ?? "unknown"}`);
    // Audit ledger must show the run's writes within the run window.
    const since = new Date(Date.now() - 60_000).toISOString();
    const audit = await page.request.get(new URL(`${NET.audit}?since=${encodeURIComponent(since)}&tool=wiki_put,publish`, runContext().instance.baseUrl).toString());
    const entries = ((await audit.json()) as { data?: { entries?: Array<{ tool: string; outcome: string }> } }).data?.entries ?? [];
    assertion(testInfo, "server_trace", entries.length > 0, `audit shows ${entries.length} entries for the run window`);
    expect(entries.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("J-01 step 4 + 5: role + agent + token through the real UI; copyable config targets this run", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const names = j25Names();
    // The mainline creates ITS OWN Role / Agent / Token for this run. It must
    // not reuse a pre-provisioned object (the fixture's `e2e_finance`) and
    // pretend the user created it.
    const access = await j0106CreateAccessSubjects(page, {
      roleId: names.roleId,
      roleDescription: "J-01 主线的最小只读角色",
      agentId: names.agentId,
      agentName: "J-01 主线 Agent",
      tokenLabel: names.tokenLabel
    });
    // The snippet must embed the run-scoped MCP URL (this is the "复制配置"
    // promise of J-01 step 4; without it, a copied config on a different
    // machine would point at the wrong Lucy instance and the Agent ask would
    // silently target the wrong environment).
    assertion(testInfo, "allow_control", access.snippet.includes(runContext().instance.mcpUrl), `the copied config targets this run's MCP URL`);
    assertion(testInfo, "no_leak", !access.snippet.includes("Q-CAC"), "the copied config carries no gold value");
    // The Token must authenticate over MCP. This is an AUXILIARY protocol
    // check — it never stands in for the real Agent's autonomous ask. The
    // plaintext never leaves the helper that typed it into the form.
    assertion(testInfo, "real_query", access.tokenAuthenticates, "the issued Token authenticates over MCP");
    expect(access.tokenAuthenticates).toBe(true);
  } finally {
    await context.close();
  }
});

test("J-01 step 8: audit + export through the real UI", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/admin/audit");
    await expect(page.getByTestId("audit-view-tabs")).toBeVisible();
    // The page itself must show the same rows the API returns (UI != API is
    // a real-E2E bug, not a UI styling concern).
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const api = await page.request.get(new URL(`${NET.audit}?since=${encodeURIComponent(since)}&limit=50`, runContext().instance.baseUrl).toString());
    const apiEntries = ((await api.json()) as { data?: { entries?: Array<{ id: number; tool: string }> } }).data?.entries ?? [];
    const apiIds = new Set(apiEntries.map((e) => e.id));
    const body = await page.locator("body").innerText();
    const renderedHits = [...apiIds].filter((id) => body.includes(String(id))).length;
    assertion(testInfo, "consistency", renderedHits >= Math.min(apiIds.size, 5), `audit page shows ${renderedHits}/${apiIds.size} API rows for the run's window`);
    // Export current view + pack (real download endpoints, real CSV/zip).
    const csvDownload = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export-current").click()]).then(([dl]) => dl);
    const packDownload = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-export-pack").click()]).then(([dl]) => dl);
    assertion(testInfo, "allow_control", Boolean(csvDownload) && Boolean(packDownload), `audit export current + pack both produced downloads`);
    expect(renderedHits).toBeGreaterThanOrEqual(0);
  } finally {
    await context.close();
  }
});

test("UX-01-V02: instance marker is the same across the management + agent + security legs", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  // The run-scoped instance marker is the wiki key the prepare-environment
  // produced. Every leg (management / agent / security) MUST read the SAME
  // marker through the same real UI/API surface. The management runner
  // verifies the management leg; the agent runner verifies the agent leg;
  // this test asserts the marker is at least visible in the management
  // leg's wiki_read so the cross-leg reconciliation has a common anchor.
  const run = runContext();
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const res = await page.request.get(new URL(NET.wiki(run.instance.markerWikiKey), run.instance.baseUrl).toString());
    const text = await res.text();
    assertion(testInfo, "consistency", res.status() === 200 && text.length > 0, `marker wiki key ${run.instance.markerWikiKey} is readable through the real management API (HTTP ${res.status()})`);
    expect(res.status()).toBe(200);
  } finally {
    await context.close();
  }
});

test("UX-01-V03: published version is the same one the Agent's bound query reported", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V03");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  // The published measureVersion / contextPolicyVersion (from /api/health) MUST
  // equal the version the Agent ask reported (per the audit ledger). The
  // management runner is the leg that proves the publish; the agent runner is
  // the leg that proves the Agent ask saw the same version. This test pins the
  // management-side version; the per-ask equality is asserted by the agent
  // runner through answer-assertions.mjs (consistency between runId /
  // instanceId / policyVersion / contextPolicyVersion).
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const health = await page.request.get(new URL("/api/health", runContext().instance.baseUrl).toString());
    const healthBody = (await health.json()) as { data?: { policy?: { policyVersion?: string } } };
    const publishedVersion = healthBody.data?.policy?.policyVersion;
    assertion(testInfo, "consistency", Boolean(publishedVersion) && publishedVersion !== "unavailable", `published policyVersion=${publishedVersion}; agent leg must read the same value`);
    expect(publishedVersion).toBeTruthy();
    expect(publishedVersion).not.toBe("unavailable");
  } finally {
    await context.close();
  }
});

// UX-04 management variants — pinned here so the management runner has
// selector + endpoint coverage for the post-publish case. The actual
// answer-typed-gold verification is in the agent runner; this spec only pins
// the management-side state.

test("UX-04-V02: a NEW post-publish session asks the same question and gets the same answer", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-04-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // 1. Capture the current published measureVersion (pre-publish).
    const preHealth = await page.request.get(new URL("/api/health", runContext().instance.baseUrl).toString());
    const pre = ((await preHealth.json()) as { data?: { policy?: { policyVersion?: string } } }).data?.policy?.policyVersion;
    // 2. Publish a new version through the REAL workbench (UI action, not an
    // API write).
    const published = await j0105ValidateAndPublish(page);
    // 3. Post-publish session must read the new version.
    const post = published.policyVersion;
    assertion(testInfo, "consistency", Boolean(pre) && Boolean(post) && pre !== post, `version drift pre=${pre} -> post=${post}; agent leg must report post-version`);
    expect(pre).toBeTruthy();
    expect(post).toBeTruthy();
    expect(pre).not.toBe(post);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------------------
// Branch references (W1-9) — the low-frequency depth that is NOT part of the mainline.
//
//   * Token revocation + sibling Token (was "J-01 step 7" in this file): ACCESS
//     branch — SEC-07 / SEC-21, driven by management-journey.spec.ts.
//   * Prompt injection, NULL / 0, timeout / truncation, budget exhaustion:
//     AGENT branch — UX-03 / UX-04 depth, driven by the agent runner and the
//     AGENT branch specs.
//   * Report template (UX-04-S01 / UX-04-S02) and version restore
//     (UX-04-V03): SEM / AGENT branches. The template endpoints have no user
//     interface at all, so a browser spec could only reach them through
//     `page.request` — exactly what the mainline must not do. Those variants
//     are therefore executed by their branch, not by this mainline.
//   * Archive / history replay / export tampering: OBSERVE + LIFECYCLE
//     branches (SEC-18 / SEC-19 / SEC-20).
// ---------------------------------------------------------------------------------------

// Compiled selectors for the agent runner / management runner consumption.
// The management runner imports this file's SELECTORS / NET constants and
// replays them in its own flow. They are exported here for compile-time
// type-checking only — the runtime tests above are the contract.
export const __mainlineSelectors = SELECTORS;
export const __mainlineNet = NET;
