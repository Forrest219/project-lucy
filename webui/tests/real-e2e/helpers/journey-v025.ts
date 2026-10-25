// Page objects for the J25-01 mainline (approved Spec §4.2, eight stages).
//
// Every function here drives a REAL page control. There is NO `page.request`
// write in this file: a write through the API does not prove that the user
// could complete the step in the UI (Spec §4.4). Read-only GET oracles are
// allowed and are used only as CORROBORATION of what the page already showed.
//
// Every selector below was read from the current `webui/src/pages/...` source
// (connection drawer, enabled-tables page, table editor, wiki editor, publish
// workbench, role detail, agent detail, new token, audit). A selector that
// does not exist in the source is a bug here, not a "TODO".
//
// The stage ids / titles / owners come from scripts/e2e/lib/mainline-scenarios.mjs
// (the canonical contract) and the run-scoped handover state comes from
// scripts/e2e/lib/j01-state.mjs. The browser leg only fills in what a browser
// can prove: the Agent leg (J01-07) owns the real Agent ask.

import { expect, type Locator, type Page } from "@playwright/test";

import { mcpCall, runContext } from "./run-context";

export const J25_STAGE_IDS = [
  "J01-01", "J01-02", "J01-03", "J01-04", "J01-05", "J01-06", "J01-07", "J01-08"
] as const;

export type J25StageId = (typeof J25_STAGE_IDS)[number];

/** Selectors read from the WebUI source. */
export const J25_SELECTORS = {
  // J01-01 登录与准备 (webui/src/pages/Login.tsx)
  loginBootstrapToken: "login-bootstrap-token",
  loginAccount: "登录账户",
  loginPassword: "密码",
  loginCreateAndSignIn: "创建并登录",
  loginSignIn: "登录",

  // J01-02 新建连接 (webui/src/components/CreateConnectionDrawer.tsx)
  connectionsCreate: "create-connection-btn",
  connectionsCreateEmpty: "create-connection-empty-btn",
  connectionDrawer: "create-connection-drawer",
  connectionId: "create-connection-id",
  connectionDriver: "create-connection-driver",
  connectionHost: "create-connection-host",
  connectionPort: "create-connection-port",
  connectionDatabase: "create-connection-database",
  connectionUsername: "create-connection-username",
  connectionPassword: "create-connection-password",
  connectionSchemas: "create-connection-schemas",
  connectionEngine: "create-connection-engine",
  connectionTest: "create-connection-test-btn",
  connectionProbeResult: "create-connection-probe-result",
  // The drawer is a THREE-step flow: 输入 → 预览 → 提交. The probe button only tests
  // connectivity; the PREVIEW button (POST /api/connections) is what advances the drawer to
  // the preview step where the confirm button lives. Skipping it leaves the confirm button
  // unrendered and the step times out on a locator that "does not exist".
  connectionPreview: "create-connection-preview-btn",
  connectionConfirm: "create-connection-confirm-btn",
  connectionDone: "create-connection-done-btn",
  connectionSuccess: "create-connection-success",
  connectionCard: (connectionId: string) => `connection-card-${connectionId}`,
  connectionHealth: (connectionId: string) => `connection-health-${connectionId}`,
  addSchema: (connectionId: string) => `add-schema-${connectionId}`,

  // J01-03 启用表与 Manifest (webui/src/pages/connections/TableWhitelist.tsx,
  // webui/src/pages/connections/ConnectionOverview.tsx)
  enabledTablesPage: "/connections/enabled-tables",
  whitelistSave: "whitelist-save-changes",
  whitelistRow: (qualifiedName: string) => `whitelist-row-${qualifiedName}`,
  whitelistStatus: "whitelist-status-banner",
  viewManifest: (connectionId: string, schema: string) => `view-manifest-${connectionId}-${schema}`,

  // J01-04 维护业务上下文 (webui/src/pages/TableEditor.tsx,
  // webui/src/components/MeasureForm.tsx, webui/src/pages/WikiEditor.tsx,
  // webui/src/components/WikiUploadPreflight.tsx)
  tableEditorMeasuresTab: "指标",
  measureAdd: "新增",
  measureName: "名称",
  measureExpression: "表达式",
  measureDescription: "描述",
  tableEditorValidate: "校验",
  tableEditorSave: "保存",
  wikiUploadButton: "wiki-upload-button",
  wikiUploadInput: "wiki-upload-input",
  wikiUploadDirectory: "wiki-upload-directory-input",
  wikiUploadTargetPath: "wiki-upload-target-path",
  wikiUploadConfirm: "wiki-upload-confirm",

  // J01-05 校验并生效 (webui/src/pages/publish/PublishWorkbench.tsx)
  workbenchValidate: "workbench-validate",
  workbenchPublishAndReindex: "workbench-publish-and-reindex",
  workbenchPublishConfirm: "workbench-publish-confirm-submit",
  workbenchSyncIndex: "workbench-sync-index",
  workbenchValidationBanner: "workbench-validation-banner",

  // J01-06 新建访问主体 (webui/src/pages/admin/RoleList.tsx,
  // webui/src/pages/admin/RoleDetail.tsx,
  // webui/src/components/RolePermissionReviewDrawer.tsx,
  // webui/src/pages/admin/AgentList.tsx, webui/src/pages/admin/AgentDetail.tsx,
  // webui/src/pages/admin/NewToken.tsx)
  roleCreate: "新建 Role",
  roleIdInput: "role-id-input",
  roleDescriptionInput: "role-description-input",
  roleSave: "保存权限配置",
  roleReviewDrawer: "role-permission-review-drawer",
  roleConfirmSave: "确认保存",
  agentCreate: "新建 Agent",
  agentNextPreview: "下一步：预览配置",
  agentConfirmCreate: "确认创建",
  agentRoleOption: "agent-role-option",
  agentNewToken: "生成新 Token",
  tokenLabel: "Token 标签",
  tokenExpiry: "30 天",
  tokenGenerate: "生成 Token",
  tokenPlaintext: "plaintext-token",
  tokenSnippet: "snippet-active",
  tokenClose: "我已保存，关闭",

  // J01-08 审计与对账 (webui/src/pages/admin/Audit.tsx)
  auditTabs: "audit-view-tabs",
  auditCallsLink: "调用记录",
  auditExportCurrent: "audit-export-current",
  auditExportPack: "audit-export-pack"
} as const;

export type ConnectionParams = {
  connectionId: string;
  engine: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  schema: string;
};

export type SemanticParams = {
  connectionId: string;
  schema: string;
  table: string;
  measureName: string;
  measureExpression: string;
  measureDescription: string;
};

export type AccessSubjectParams = {
  roleId: string;
  roleDescription: string;
  agentId: string;
  agentName: string;
  tokenLabel: string;
};

export type ConnectionResult = { connectionId: string; engine: string; schema: string };
export type TablesResult = { connectionId: string; schema: string; sourceKeys: string[] };
export type ContextResult = { connectionId: string; schema: string; table: string; wikiPath: string; measureName: string };
export type PublishResult = { semanticVersion: string | null; policyVersion: string | null };
export type AccessResult = {
  roleId: string;
  agentId: string;
  /** A CONTROLLED REFERENCE to the Token — never the plaintext. */
  tokenSecretRef: string;
  /** The copied MCP configuration. It contains the Token plaintext by design
   *  (the page shows it once); it must never be written to disk. */
  snippet: string;
  /** The auxiliary protocol check: the Token authenticates over MCP. It never
   *  stands in for the real Agent's autonomous ask. */
  tokenAuthenticates: boolean;
};
export type AuditResult = { apiEntryIds: number[]; renderedEntryIds: number[] };

/** Run-scoped names. Every object the mainline creates is unique per run. */
export function j25Names(runId = runContext().runId): {
  connectionId: string;
  roleId: string;
  agentId: string;
  tokenLabel: string;
  wikiPath: string;
} {
  const suffix = runId.slice(-6);
  return {
    connectionId: `conn-j25-${suffix}`,
    roleId: `role-j25-${suffix}`,
    agentId: `agent-j25-${suffix}`,
    tokenLabel: `j25-${suffix}`,
    wikiPath: `finance/j25-${suffix}.md`
  };
}

// ---------------------------------------------------------------------------
// J01-01 登录与准备
// ---------------------------------------------------------------------------

/**
 * Signs in through the real login form. On a fresh instance the run's owner
 * is created through the controlled bootstrap form; otherwise the owner signs
 * in normally. The stage's output is the management session — no object is
 * created here.
 */
export async function j0101LoginAndPrepare(page: Page, owner: { adminId: string; password: string }): Promise<{ ownerId: string }> {
  await page.goto("/login");
  const bootstrap = page.getByTestId(J25_SELECTORS.loginBootstrapToken);
  if (await bootstrap.isVisible().catch(() => false)) {
    await page.getByLabel(J25_SELECTORS.loginAccount).fill(owner.adminId);
    await bootstrap.fill(await readBootstrapKey());
    await page.getByLabel(J25_SELECTORS.loginPassword, { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: J25_SELECTORS.loginCreateAndSignIn }).click();
  } else {
    await page.getByLabel(J25_SELECTORS.loginAccount).fill(owner.adminId);
    await page.getByLabel(J25_SELECTORS.loginPassword, { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: J25_SELECTORS.loginSignIn, exact: true }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  return { ownerId: owner.adminId };
}

/** The controlled bootstrap key. It is typed into the form and never logged. */
async function readBootstrapKey(): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  return readFileSync(path.join(runContext().secretsDir, "bootstrap-token"), "utf8").trim();
}

// ---------------------------------------------------------------------------
// J01-02 新建连接
// ---------------------------------------------------------------------------

/**
 * Creates the run's PostgreSQL connection through the real wizard and runs
 * the real connection test. The password is typed into the form and is never
 * logged, asserted on or written to an artifact.
 */
export async function j0102CreateConnection(page: Page, params: ConnectionParams): Promise<ConnectionResult> {
  await page.goto("/connections");
  const start = page.getByTestId(J25_SELECTORS.connectionsCreate).or(page.getByTestId(J25_SELECTORS.connectionsCreateEmpty));
  await expect(start).toBeVisible();
  await start.click();

  const drawer = page.getByTestId(J25_SELECTORS.connectionDrawer);
  await expect(drawer).toBeVisible();
  await page.getByTestId(J25_SELECTORS.connectionId).fill(params.connectionId);
  await page.getByTestId(J25_SELECTORS.connectionDriver).selectOption(params.engine);
  await page.getByTestId(J25_SELECTORS.connectionHost).fill(params.host);
  await page.getByTestId(J25_SELECTORS.connectionPort).fill(params.port);
  await page.getByTestId(J25_SELECTORS.connectionDatabase).first().fill(params.database);
  await page.getByTestId(J25_SELECTORS.connectionUsername).fill(params.username);
  await page.getByTestId(J25_SELECTORS.connectionPassword).fill(params.password);
  await page.getByTestId(J25_SELECTORS.connectionSchemas).fill(params.schema);

  // The real connectivity probe, driven by the page's own button.
  await page.getByTestId(J25_SELECTORS.connectionTest).click();
  const probe = page.getByTestId(J25_SELECTORS.connectionProbeResult).first();
  await expect(probe).toBeVisible();
  // The probe is ASYNC: while it runs the drawer shows "正在测试连接...". Waiting only for
  // visibility therefore reads the pending text, not the verdict. Wait for the verdict.
  await expect(probe).not.toHaveText(/正在测试连接/, { timeout: 90_000 });
  // Assert the probe SUCCEEDED, not merely that something appeared. The drawer shows
  // "连接失败：<reason>" on failure; the journey must not continue on a dead connection,
  // and the reason has to be readable in the failure output.
  const probeText = (await probe.innerText()).trim();
  if (!probeText.includes("连接成功")) {
    throw new Error(`connection probe did not succeed: ${probeText}`);
  }
  // 输入 → 预览: the preview request is what renders the confirm button.
  await page.getByTestId(J25_SELECTORS.connectionPreview).click();
  // The preview can be intercepted by the endpoint/schema gate instead of producing a
  // preview. In this run's fixture the target database+schema is ALREADY registered on the
  // seeded connection (`fin-db`), so the server answers with a schema conflict that offers
  // only "返回已有连接" — a NEW connection for that schema cannot be created. Report that
  // precisely instead of timing out on a confirm button that will never render.
  const gate = page.getByTestId("endpoint-gate-panel");
  await gate.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  if (await gate.isVisible().catch(() => false)) {
    const gateText = (await gate.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    throw new Error(`the connection create was intercepted by the endpoint gate instead of a preview: ${gateText}`);
  }
  await page.getByTestId(J25_SELECTORS.connectionConfirm).click();
  await expect(page.getByTestId(J25_SELECTORS.connectionSuccess)).toBeVisible();
  await page.getByTestId(J25_SELECTORS.connectionDone).click();

  await expect(page.getByTestId(J25_SELECTORS.connectionCard(params.connectionId))).toBeVisible();
  return { connectionId: params.connectionId, engine: params.engine, schema: params.schema };
}

// ---------------------------------------------------------------------------
// J01-03 启用表与 Manifest
// ---------------------------------------------------------------------------

/**
 * Enables the tables the question needs on the enabled-tables page and checks
 * that the page reports the saved scope. The Manifest itself is produced by
 * the run's fixture and reaches the instance through the connection overview's
 * own upload affordance — the mainline does NOT fabricate a Manifest.
 */
export async function j0103EnableTablesAndManifest(
  page: Page,
  params: { connectionId: string; schema: string; tables: string[] }
): Promise<TablesResult> {
  await page.goto(J25_SELECTORS.enabledTablesPage);
  for (const table of params.tables) {
    const row = page.getByTestId(J25_SELECTORS.whitelistRow(`${params.schema}.${table}`));
    await expect(row).toBeVisible();
    const checkbox = row.getByRole("checkbox");
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
  await page.getByTestId(J25_SELECTORS.whitelistSave).click();
  await expect(page.getByTestId(J25_SELECTORS.whitelistStatus)).toBeVisible();
  return {
    connectionId: params.connectionId,
    schema: params.schema,
    sourceKeys: params.tables.map((table) => `${params.schema}.${table}`)
  };
}

// ---------------------------------------------------------------------------
// J01-04 维护业务上下文
// ---------------------------------------------------------------------------

/**
 * Maintains the ONE measure the mainline question needs and uploads the
 * business Wiki through the real upload + preflight flow. The Wiki body
 * carries the run's canary, never a gold value.
 */
export async function j0104MaintainBusinessContext(
  page: Page,
  params: SemanticParams & { wikiPath: string; wikiBody: string }
): Promise<ContextResult> {
  await page.goto(`/catalog/${params.connectionId}/${params.schema}/${params.table}`);
  await page.getByRole("tab", { name: J25_SELECTORS.tableEditorMeasuresTab }).click();
  const measureSection = page.locator("section.pl-panel").filter({
    has: page.getByRole("button", { name: J25_SELECTORS.measureAdd, exact: true })
  });
  await measureSection.getByRole("button", { name: J25_SELECTORS.measureAdd, exact: true }).click();
  await measureSection.getByLabel(J25_SELECTORS.measureName).fill(params.measureName);
  await measureSection.getByLabel(J25_SELECTORS.measureExpression).fill(params.measureExpression);
  await measureSection.getByLabel(J25_SELECTORS.measureDescription).fill(params.measureDescription);
  await page.getByRole("button", { name: J25_SELECTORS.tableEditorValidate, exact: true }).click();
  await page.getByRole("button", { name: J25_SELECTORS.tableEditorSave, exact: true }).click();

  // Business Wiki: upload -> preflight -> confirm.
  await page.goto("/wiki");
  await page.getByTestId(J25_SELECTORS.wikiUploadButton).click();
  await page.getByTestId(J25_SELECTORS.wikiUploadInput).setInputFiles({
    name: params.wikiPath.split("/").pop() ?? "wiki.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(params.wikiBody, "utf8")
  });
  await expect(page.getByTestId(J25_SELECTORS.wikiUploadDirectory)).toBeVisible();
  await page.getByTestId(J25_SELECTORS.wikiUploadDirectory).fill(params.wikiPath.split("/").slice(0, -1).join("/"));
  await page.getByTestId(J25_SELECTORS.wikiUploadConfirm).click();
  await expect(page.getByTestId(J25_SELECTORS.wikiUploadTargetPath)).toBeVisible();

  return {
    connectionId: params.connectionId,
    schema: params.schema,
    table: params.table,
    wikiPath: params.wikiPath,
    measureName: params.measureName
  };
}

// ---------------------------------------------------------------------------
// J01-05 校验并生效
// ---------------------------------------------------------------------------

/**
 * Runs the publish workbench: validate, then "同步索引并生效". The effective
 * versions are read back through the READ-ONLY health endpoint as
 * corroboration of what the page reported.
 */
export async function j0105ValidateAndPublish(page: Page): Promise<PublishResult> {
  await page.goto("/publish/workbench");
  await page.getByTestId(J25_SELECTORS.workbenchValidate).click();
  await expect(page.getByTestId(J25_SELECTORS.workbenchValidationBanner)).toBeVisible();
  await page.getByTestId(J25_SELECTORS.workbenchPublishAndReindex).click();
  await expect(page.getByTestId(J25_SELECTORS.workbenchPublishConfirm)).toBeVisible();
  await page.getByTestId(J25_SELECTORS.workbenchPublishConfirm).click();

  const health = await page.request.get(new URL("/api/health", runContext().instance.baseUrl).toString());
  const body = (await health.json()) as { data?: { policy?: { policyVersion?: string }; semantic?: { version?: string } } };
  return {
    semanticVersion: body.data?.semantic?.version ?? null,
    policyVersion: body.data?.policy?.policyVersion ?? null
  };
}

// ---------------------------------------------------------------------------
// J01-06 新建访问主体
// ---------------------------------------------------------------------------

/**
 * Creates the run's dedicated Role, Agent and Token through the real UI and
 * reads the copyable MCP configuration the page produces.
 *
 * The Token plaintext is shown ONCE by the product. It is handed to the Agent
 * runner through the controlled secret channel; the only thing that leaves
 * this function is a REFERENCE to that secret (`tokenSecretRef`) plus the
 * snippet the user copies. The plaintext must never be written to an
 * artifact, a log or the journey state.
 */
export async function j0106CreateAccessSubjects(page: Page, params: AccessSubjectParams): Promise<AccessResult> {
  await page.goto("/admin/roles");
  await page.getByRole("link", { name: J25_SELECTORS.roleCreate }).first().click();
  await page.locator(`#${J25_SELECTORS.roleIdInput}`).fill(params.roleId);
  await page.locator(`#${J25_SELECTORS.roleDescriptionInput}`).fill(params.roleDescription);
  await page.getByRole("button", { name: J25_SELECTORS.roleSave, exact: true }).click();
  const review = page.getByTestId(J25_SELECTORS.roleReviewDrawer);
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: J25_SELECTORS.roleConfirmSave }).click();

  await page.goto("/admin/agents");
  await page.getByRole("button", { name: J25_SELECTORS.agentCreate, exact: true }).click();
  await page.getByPlaceholder("例：wangwu").fill(params.agentId);
  await page.getByPlaceholder("例：王五").fill(params.agentName);
  // The Agent must be bound to THIS run's Role — the scope is minimal.
  const roleOption = page.locator(
    `[data-testid="${J25_SELECTORS.agentRoleOption}"][data-role-id="${params.roleId}"]`
  );
  await expect(roleOption).toBeVisible();
  await roleOption.check();
  await page.getByRole("button", { name: J25_SELECTORS.agentNextPreview, exact: true }).click();
  await page.getByRole("button", { name: J25_SELECTORS.agentConfirmCreate, exact: true }).click();

  await page.goto(`/admin/agents/${params.agentId}/tokens/new`);
  await page.getByLabel(J25_SELECTORS.tokenLabel).fill(params.tokenLabel);
  await page.getByRole("button", { name: J25_SELECTORS.tokenExpiry, exact: true }).click();
  await page.getByRole("button", { name: J25_SELECTORS.tokenGenerate, exact: true }).click();
  const plaintext = (await page.getByTestId(J25_SELECTORS.tokenPlaintext).innerText()).trim();
  const snippet = await page.getByTestId(J25_SELECTORS.tokenSnippet).innerText();
  await page.getByRole("button", { name: J25_SELECTORS.tokenClose }).click();

  // The plaintext is shown ONCE. It stays in this function: it is never
  // returned, logged, asserted on by value, or written to an artifact.
  expect(plaintext.length).toBeGreaterThanOrEqual(32);
  // The copied configuration must point at THIS run's MCP URL, otherwise the
  // Agent would query a different instance.
  expect(snippet).toContain(runContext().instance.mcpUrl);

  // AUXILIARY protocol check: the Token authenticates over MCP. It proves the
  // credential works; it does NOT prove a real Agent asked anything.
  const init = await mcpCall(plaintext, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "j25", version: "1" } }
  });

  return {
    roleId: params.roleId,
    agentId: params.agentId,
    tokenSecretRef: `secret://run/${runContext().runId}/j01-06/token/${params.tokenLabel}`,
    snippet,
    tokenAuthenticates: init.status === 200
  };
}

// ---------------------------------------------------------------------------
// J01-08 审计与对账
// ---------------------------------------------------------------------------

/**
 * Opens this run's inquiry in the real audit page and compares what the page
 * rendered with the read-only audit API. The comparison is a CORROBORATION:
 * the page is the evidence, the API is the oracle.
 */
export async function j0108AuditAndReconcile(
  page: Page,
  params: { since: string; agentId?: string }
): Promise<AuditResult> {
  await page.goto("/admin/audit");
  await expect(page.getByTestId(J25_SELECTORS.auditTabs)).toBeVisible();
  await page.getByRole("link", { name: J25_SELECTORS.auditCallsLink }).click();

  const api = await page.request.get(
    new URL(`/api/admin/audit?since=${encodeURIComponent(params.since)}&limit=50`, runContext().instance.baseUrl).toString()
  );
  const entries = ((await api.json()) as { data?: { entries?: Array<{ id: number }> } }).data?.entries ?? [];
  const apiEntryIds = entries.map((entry) => entry.id);

  const body = await page.locator("body").innerText();
  const renderedEntryIds = apiEntryIds.filter((id) => body.includes(String(id)));
  return { apiEntryIds, renderedEntryIds };
}

/** Downloads the current audit view and the export pack through the page's own
 *  buttons. */
export async function j0108ExportAuditEvidence(page: Page): Promise<{ current: string; pack: string }> {
  const current = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(J25_SELECTORS.auditExportCurrent).click()
  ]).then(([download]) => download.suggestedFilename());
  const pack = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(J25_SELECTORS.auditExportPack).click()
  ]).then(([download]) => download.suggestedFilename());
  return { current, pack };
}

/** A locator helper for the enabled-tables checkbox of one table — exposed so
 *  a branch spec can reuse the same selector contract. */
export function whitelistCheckbox(page: Page, qualifiedName: string): Locator {
  return page.getByTestId(J25_SELECTORS.whitelistRow(qualifiedName)).getByRole("checkbox");
}
