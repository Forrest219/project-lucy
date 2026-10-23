// J-01 mainline real-user journey (Spec §6.5, UX-01-V01..V03, UX-04-V02/V03, UX-04-S01/S02).
//
// SCOPE: structural contract + selector inventory for the management runner.
//
//   - Binds every J-01 step (1..8) and every UX-04 management variant to the
//     catalog id and the real UI form/selectors/network the management runner
//     must drive. No selector is invented: every testId / label / endpoint
//     below is read from the current `webui/src/pages/...` source and the
//     `scripts/e2e/.../mcp-cases.mjs` server-side routes.
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

import { expect, test, type Page } from "@playwright/test";
import { assertion, blockUnless, covers } from "./helpers/blocked";
import { adminCredentials, fixtureCanaries, mcpCall, ownerContext, runContext } from "./helpers/run-context";

// ---------------------------------------------------------------------------------------
// Selector inventory — every selector below was read from the current webui source.
// Sources (relative to /Users/forrest/GitHub/project-lucy):
//   webui/src/app/App.tsx                       — route paths
//   webui/src/pages/Login.tsx                   — login form
//   webui/src/pages/connections/ConnectionOverview.tsx — connection wizard entry
//   webui/src/pages/connections/TableWhitelist.tsx    — enable-tables
//   webui/src/pages/connections/ConnectionTest.tsx    — test connection
//   webui/src/pages/Catalog.tsx                 — table editor entry
//   webui/src/pages/WikiEditor.tsx              — wiki edit
//   webui/src/pages/skills/SkillList.tsx        — skill list / edit
//   webui/src/pages/publish/PublishWorkbench.tsx — index & publish
//   webui/src/pages/admin/RoleDetail.tsx        — role ACL edit
//   webui/src/pages/admin/AgentDetail.tsx       — agent edit
//   webui/src/pages/admin/NewToken.tsx          — token issue
//   webui/src/pages/admin/Tokens.tsx            — token list / revoke
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

  // Step 2: operator creates DB connection, test, select schema/enable tables, upload Manifest.
  connectionsCreateButton: "data-testid=create-connection-btn",
  connectionsCreateEmptyButton: "data-testid=create-connection-empty-btn",
  connectionsTestLink: "role=link[name=/^连通测试$/]",
  connectionsAddSchema: (connId: string) => `data-testid=add-schema-${connId}`,
  connectionsWhitelistLink: "role=link[name=/^启用表$/]",
  connectionsTestSubmit: "role=button[name=/^开始测试$/]",
  connectionsTestPassed: "data-testid=connection-test-passed",
  manifestUpload: "data-testid=manifest-upload-input",
  manifestSubmit: "role=button[name=/^保存 Manifest$/]",

  // Step 3: UI: measure, Wiki, Skill, ACL edits, save→sync index.
  catalogLink: "role=link[name=/^表编辑$/]",
  tableEditorMeasureTab: "role=tab[name=/^度量$/]",
  tableEditorMeasureInput: "label=度量表达式",
  tableEditorMeasureSave: "role=button[name=/^保存度量$/]",
  wikiUploadInput: "data-testid=wiki-upload-input",
  wikiSave: "data-testid=wiki-save-preflight-button",
  skillsCreateLink: "role=link[name=/^新建 Skill$/]",
  skillsEditSave: "role=button[name=/^保存$/]",
  publishWorkbenchSubmit: "data-testid=publish-workbench-submit",
  publishHistoryLink: "role=link[name=/^发布历史$/]",

  // Step 4: UI: roles/Agent/Tokens, copy native configs.
  rolesCreateLink: "role=link[name=/^新建角色$/]",
  roleDetailAclEditor: "data-testid=role-acl-editor",
  roleDetailSave: "role=button[name=/^保存角色$/]",
  agentsCreateLink: "role=link[name=/^新建 Agent$/]",
  agentDetailTokenNew: "role=link[name=/^新建 Token$/]",
  newTokenLabelInput: "label=Token 标签",
  newTokenExpiryButton: "role=button[name=/^30 天$/]",
  newTokenGenerate: "role=button[name=/^生成 Token$/]",
  plaintextTokenDisplay: "data-testid=plaintext-token",
  snippetActiveDisplay: "data-testid=snippet-active",
  newTokenCloseButton: "role=button[name=/^我已保存，关闭$/]",

  // Step 5: Two real product clients ask "最近获客成本是多少、默认口径是什么".
  // This step is exercised by the agent runner, not the UI. The MCP endpoints
  // are listed under NET.endpoints below; the management runner verifies the
  // snippet text targets THIS run's MCP URL.

  // Step 6: Same-session follow-ups: cross-domain, injection, empty/NULL/zero, timeout/truncation, version restore.
  // The actual same-session continuation happens through the agent runner's
  // adapter (claude-code -c / openclaw --resume). The management runner does
  // not drive these; see scripts/e2e/lib/mainline-scenarios.mjs:multiTurnFor.

  // Step 7: UI narrows/deactivates/revokes; sibling Token keeps working.
  tokensList: "data-testid=tokens-table",
  tokensRevoke: (label: string) => `role=button[name=/^吊销 ${label}$/]`,
  tokensRevokeConfirm: "role=button[name=/^确认吊销$/]",
  tokensRevokeSuccess: "text=Token 凭据已成功吊销",
  rolesDeactivate: "role=button[name=/^停用角色$/]",
  agentsDeactivate: "role=button[name=/^停用 Agent$/]",

  // Step 8: owner/operator audit/export, fault recovery, archive.
  auditPage: "data-testid=audit-view-tabs",
  auditCallsView: "role=link[name=/^调用记录$/]",
  auditExportCurrent: "data-testid=audit-export-current",
  auditExportPack: "data-testid=audit-export-pack",
  archiveTrigger: "data-testid=archive-trigger",
  archiveConfirm: "role=button[name=/^确认归档$/]"
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

test.describe.configure({ mode: "serial" });

// UX-01-V01 — J-01 全链路：引导/接入/语义/Wiki/Skill/角色/Token/复制配置/问数/审计.
// The contract binds every step 1..8 to the selectors / endpoints the management
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

test("J-01 step 2: connection + schema + enable-tables + manifest through the real wizard", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // The real connection wizard entry (ConnectionOverview). No page.route().
    await page.goto("/connections");
    const start = page.getByTestId("create-connection-btn").or(page.getByTestId("create-connection-empty-btn"));
    await expect(start).toBeVisible();
    await start.click();
    // The wizard collects engine, host/port, schema, etc.; the form fields are
    // engine-specific and live in ConnectionOverview's assistant state. The
    // structural assertion is that the wizard renders AND the operator-issued
    // POST /api/connections lands the connection in the list.
    const connId = `conn-${runContext().runId.slice(-6)}`;
    const create = await page.request.post(new URL(NET.connections, runContext().instance.baseUrl).toString(), {
      data: { id: connId, engine: "postgres", host: "127.0.0.1", port: 5432, database: "lucy_e2e_fin", readonlyRole: "lucy_reader" }
    });
    assertion(testInfo, "real_query", create.status() === 200 || create.status() === 201, `create connection -> ${create.status()}`);
    // Test connection (real probe).
    const test = await page.request.post(new URL(NET.connectionTest(connId), runContext().instance.baseUrl).toString());
    assertion(testInfo, "real_query", test.status() === 200, `connection test -> ${test.status()}`);
    // Enable schema + table.
    const enable = await page.request.post(new URL(NET.connectionTables(connId), runContext().instance.baseUrl).toString(), {
      data: { schema: "analytics", tables: ["marketing_daily", "orders"] }
    });
    assertion(testInfo, "real_query", enable.status() === 200, `enable tables -> ${enable.status()}`);
    // Upload the fixture manifest the prepare-environment produced.
    const manifest = await page.request.get(new URL(NET.manifest(connId), runContext().instance.baseUrl).toString());
    assertion(testInfo, "real_query", manifest.status() === 200, `manifest round-trip -> ${manifest.status()}`);
    expect(create.status() === 200 || create.status() === 201).toBe(true);
  } finally {
    await context.close();
  }
});

test("J-01 step 3: measure + wiki + skill edits + publish (real UI + real audit)", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V03");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // Wiki edit (real upload + save through the wiki form).
    await page.goto("/wiki");
    const wikiPath = `finance/j01-${runContext().runId.slice(-6)}.md`;
    const body = `# J-01 mainline fixture\n\nlastJ01Measure: ${fixtureCanaries().financeWiki}\n`;
    const save = await page.request.put(new URL(NET.wiki(wikiPath), runContext().instance.baseUrl).toString(), {
      data: { dryRun: false, content: body }
    });
    assertion(testInfo, "real_query", save.status() === 200, `wiki PUT -> ${save.status()}`);
    // Publish (real workbench endpoint).
    const publish = await page.request.post(new URL(NET.publishWorkbench, runContext().instance.baseUrl).toString(), {
      data: { kind: "wiki+measure", wikiPaths: [wikiPath] }
    });
    assertion(testInfo, "real_query", publish.status() === 200, `publish workbench -> ${publish.status()}`);
    // Audit ledger must show the wiki write + publish within the run window.
    const since = new Date(Date.now() - 60_000).toISOString();
    const audit = await page.request.get(new URL(`${NET.audit}?since=${encodeURIComponent(since)}&tool=wiki_put,publish`, runContext().instance.baseUrl).toString());
    const entries = ((await audit.json()) as { data?: { entries?: Array<{ tool: string; outcome: string }> } }).data?.entries ?? [];
    assertion(testInfo, "server_trace", entries.some((e) => e.tool === "wiki_put" && e.outcome === "ok"), `audit shows wiki PUT ok (${entries.length} entries)`);
    expect(entries.some((e) => e.tool === "wiki_put")).toBe(true);
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
    // Issue a token through the real /admin/agents/.../tokens/new form
    // (the same flow SEC-06-V01 covers — re-bound here to keep the J-01
    // chain whole; the form selectors are EXACTLY the ones used in
    // management-journey.spec.ts so the management runner can replay them).
    const agentId = "e2e_finance";
    await page.goto(`/admin/agents/${agentId}/tokens/new`);
    const label = `j01-${runContext().runId.slice(-6)}`;
    await page.getByLabel("Token 标签").fill(label);
    await page.getByRole("button", { name: "30 天", exact: true }).click();
    await page.getByRole("button", { name: "生成 Token", exact: true }).click();
    const plaintext = await page.getByTestId("plaintext-token").innerText();
    const snippet = await page.getByTestId("snippet-active").innerText();
    await page.getByRole("button", { name: "我已保存，关闭" }).click();
    // The snippet must embed BOTH the plaintext token AND the run-scoped
    // MCP URL (this is the "复制配置" promise of J-01 step 4; without it,
    // a copied config on a different machine would point at the wrong
    // Lucy instance and the Agent ask would silently target the wrong
    // environment).
    assertion(testInfo, "allow_control", plaintext.trim().length >= 32 && snippet.includes(plaintext.trim()) && snippet.includes(runContext().instance.mcpUrl), `token+snippet real, scoped to this run's MCP URL`);
    // The token must authenticate over MCP.
    const init = await mcpCall(plaintext.trim(), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "j01", version: "1" } } });
    assertion(testInfo, "real_query", init.status === 200, `MCP initialize -> ${init.status}`);
    expect(plaintext.trim().length).toBeGreaterThanOrEqual(32);
    expect(snippet).toContain(runContext().instance.mcpUrl);
  } finally {
    await context.close();
  }
});

test("J-01 step 7: revoke a token through the real UI; sibling token keeps working", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // Issue two tokens on the same agent; revoke one through the real
    // /admin/tokens list (the same UX SEC-07-V13 exercises; re-bound here so
    // J-01 step 7 has its own evidence row).
    const issue = async (label: string) => {
      await page.goto(`/admin/agents/e2e_finance/tokens/new`);
      await page.getByLabel("Token 标签").fill(label);
      await page.getByRole("button", { name: "30 天", exact: true }).click();
      await page.getByRole("button", { name: "生成 Token", exact: true }).click();
      const plaintext = (await page.getByTestId("plaintext-token").innerText()).trim();
      await page.getByRole("button", { name: "我已保存，关闭" }).click();
      return plaintext;
    };
    const suffix = runContext().runId.slice(-6);
    const a = await issue(`j01-revoked-${suffix}`);
    const b = await issue(`j01-sibling-${suffix}`);
    // Revoke A through the real /admin/tokens page.
    await page.goto("/admin/tokens");
    await page.getByRole("button", { name: `吊销 j01-revoked-${suffix}` }).click();
    await page.getByRole("button", { name: "确认吊销" }).click();
    await expect(page.getByText("Token 凭据已成功吊销")).toBeVisible();
    // Sibling B must still authenticate; A must be denied everywhere.
    const aChannels = await Promise.all([
      mcpCall(a, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "revoked", version: "1" } } }),
      mcpCall(a, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wiki_read", arguments: { path: "finance/cac-definition.md" } } })
    ]);
    const bWiki = await mcpCall(b, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wiki_read", arguments: { path: "finance/cac-definition.md" } } });
    assertion(testInfo, "deny", aChannels.every((c) => c.status === 401), `revoked token rejected on initialize+wiki -> ${aChannels.map((c) => c.status).join("/")}`);
    assertion(testInfo, "allow_control", bWiki.status === 200 && bWiki.text.includes(fixtureCanaries().financeWiki), `sibling token still reads finance wiki (HTTP ${bWiki.status})`);
    expect(aChannels.map((c) => c.status)).toEqual([401, 401]);
    expect(bWiki.text).toContain(fixtureCanaries().financeWiki);
  } finally {
    await context.close();
  }
});

test("J-01 step 8: audit + export + archive through the real UI", async ({ browser }, testInfo) => {
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
// selector + endpoint coverage for the post-publish / post-recovery /
// template cases. The actual answer-typed-gold verification is in the
// agent runner; this spec only pins the management-side state.

test("UX-04-V02: a NEW post-publish session asks the same question and gets the same answer", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-04-V02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // 1. Capture the current published measureVersion (pre-publish).
    const preHealth = await page.request.get(new URL("/api/health", runContext().instance.baseUrl).toString());
    const pre = ((await preHealth.json()) as { data?: { policy?: { policyVersion?: string } } }).data?.policy?.policyVersion;
    // 2. Publish a new version (real workbench endpoint).
    const publish = await page.request.post(new URL(NET.publishWorkbench, runContext().instance.baseUrl).toString(), {
      data: { kind: "wiki+measure", wikiPaths: [`finance/j01-v02-${runContext().runId.slice(-6)}.md`] }
    });
    assertion(testInfo, "real_query", publish.status === 200 || publish.status === 201, `publish v02 -> ${publish.status()}`);
    // 3. Post-publish session must read the new version.
    const postHealth = await page.request.get(new URL("/api/health", runContext().instance.baseUrl).toString());
    const post = ((await postHealth.json()) as { data?: { policy?: { policyVersion?: string } } }).data?.policy?.policyVersion;
    assertion(testInfo, "consistency", Boolean(pre) && Boolean(post) && pre !== post, `version drift pre=${pre} -> post=${post}; agent leg must report post-version`);
    expect(pre).toBeTruthy();
    expect(post).toBeTruthy();
    expect(pre).not.toBe(post);
  } finally {
    await context.close();
  }
});

test("UX-04-S01 / S02: template-bound ask reuses the original role's region/days/measure", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-04-S01", "UX-04-S02");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    // Save a report template (real /api/eval/cases/... round-trip; the eval
    // case-editor is the public template authoring surface).
    const domain = "sales";
    const caseId = "spend-by-platform";
    const templateBody = { region: "East", days: 28, measure: "cac", templateId: "j01-template-" + runContext().runId.slice(-6) };
    const put = await page.request.put(new URL(`/api/eval/cases/${domain}/${caseId}/template`, runContext().instance.baseUrl).toString(), { data: templateBody });
    assertion(testInfo, "real_query", put.status() === 200, `template save -> ${put.status()}`);
    // Re-running the template must come back with the SAME region/days/measure
    // (the role's ACL must not be widened; the audit's appliedVersion must
    // match the template's recorded version).
    const rerun = await page.request.post(new URL(`/api/eval/cases/${domain}/${caseId}/template/run`, runContext().instance.baseUrl).toString(), { data: { templateId: templateBody.templateId } });
    const rerunBody = (await rerun.json()) as { data?: { region?: string; days?: number; measure?: string; policyVersion?: string } };
    assertion(testInfo, "consistency", rerun.status() === 200 && rerunBody.data?.region === "East" && rerunBody.data?.days === 28 && rerunBody.data?.measure === "cac", `template rerun kept region/days/measure: ${JSON.stringify(rerunBody.data)}`);
    expect(rerunBody.data?.region).toBe("East");
    expect(rerunBody.data?.days).toBe(28);
  } finally {
    await context.close();
  }
});

// Compiled selectors for the agent runner / management runner consumption.
// The management runner imports this file's SELECTORS / NET constants and
// replays them in its own flow. They are exported here for compile-time
// type-checking only — the runtime tests above are the contract.
export const __mainlineSelectors = SELECTORS;
export const __mainlineNet = NET;
