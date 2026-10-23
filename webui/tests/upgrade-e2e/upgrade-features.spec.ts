import { expect, test, type TestInfo } from "@playwright/test";
import { fixtureAgentTokens, ownerContext, runContext } from "../real-e2e/helpers/run-context";
import { parseEvalSuite } from "../../server/eval/suite-schema";
import { runOfflineBatch } from "../../server/eval/offline-batch";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

test.describe.configure({ mode: "default" });
const fixture = runContext();
const tokens = fixtureAgentTokens();
let sequence = 1000;
function feature(info: TestInfo, id: string, layer = "browser+http") {
  info.annotations.push({ type: "upgrade-feature", description: id }, { type: "execution-layer", description: layer });
}
function blocked(info: TestInfo, reason: string): never {
  info.annotations.push({ type: "blocked", description: reason });
  info.skip(true, reason);
  throw new Error("unreachable");
}
function decode(text: string): any {
  const line = text.split("\n").find((s) => s.startsWith("data: "));
  const rpc = JSON.parse(line ? line.slice(6) : text);
  const body = rpc.result?.content?.find((c: any) => typeof c.text === "string")?.text;
  if (!body) return rpc;
  try { return { rpc, value: JSON.parse(body) }; } catch { return { rpc, value: body }; }
}
async function call(token: string, name: string, args: Record<string, unknown> = {}, extra: Record<string, string> = {}) {
  const response = await fetch(fixture.instance.mcpUrl, {
    method: "POST", signal: AbortSignal.timeout(35_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method: "tools/call", params: { name, arguments: args } })
  });
  const text = await response.text();
  return { status: response.status, text, ...decode(text) };
}
const query = (token: string, sourceName = "orders") => call(token, "lucy_query", { connectionId: "upgrade-db", sourceName, measures: [sourceName === "orders" ? "total_amount" : "count(*)"] });

test("UPG-01 bootstrap/login is required and logout revokes the same cookie", async ({ browser, request }, info) => {
  feature(info, "UPG-01");
  expect((await request.get("/api/admin/agents")).status()).toBe(401);
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    expect((await page.request.get("/api/admin/agents")).status()).toBe(200);
    const cookies = await context.cookies();
    const logout = await page.request.post("/api/auth/logout");
    expect(logout.status()).toBe(200);
    const replay = await request.get("/api/admin/agents", { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
    expect(replay.status()).toBe(401);
  } finally { await context.close(); }
});

test("UPG-02 save two roles, reload them, query allowed data and deny hidden data", async ({ browser }, info) => {
  feature(info, "UPG-02");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/admin/agents/e2e_finance");
    const role = page.locator('[data-testid="agent-role-option"][data-role-id="sales_reader"]');
    await role.check();
    await page.getByTestId("sticky-save-bar").getByRole("button", { name: "保存", exact: true }).click();
    const confirm = page.getByTestId("agent-save-confirm-submit");
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(confirm).toBeHidden();
    await expect(page.getByTestId("sticky-save-bar")).toBeHidden();
    await page.reload();
    await expect(role).toBeChecked();
    const saved = await (await page.request.get("/api/admin/agents/e2e_finance")).json();
    expect(saved.data.agent.roles.sort()).toEqual(["finance_reader", "sales_reader"]);
    const allowed = await query(tokens.e2e_finance);
    expect(allowed.status).toBe(200);
    expect(allowed.text).toContain("600");
    expect(allowed.rpc?.isError ?? allowed.rpc?.result?.isError).not.toBe(true);
    const hidden = await query(tokens.e2e_finance, "hidden_orders");
    expect(hidden.text).toContain("Access denied");
  } finally { await context.close(); }
});

test("UPG-03 enabled-table intersection excludes named hidden data and lucy_admin follows configured connections", async ({ browser }, info) => {
  feature(info, "UPG-03", "http+mcp");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const effective = await (await page.request.get("/api/admin/agents/e2e_finance/effective-permissions")).json();
    expect(JSON.stringify(effective)).toContain("orders");
    expect(JSON.stringify(effective.data?.sources ?? effective.data?.effectivePermissions?.sources ?? effective.data)).not.toContain("hidden_orders");
    const hidden = await query(tokens.e2e_finance, "hidden_orders");
    expect(hidden.text).toContain("Access denied");
    expect((await query(tokens.e2e_sales)).text).toContain("Access denied");
    const admin = await (await page.request.get("/api/admin/roles/lucy_admin")).json();
    expect(JSON.stringify(admin)).toContain("catalog_bound");
    expect(JSON.stringify(admin)).toContain("upgrade-db");
  } finally { await context.close(); }
});

test("UPG-03 changing enabled tables through the browser changes MCP access immediately", async ({ browser }, info) => {
  feature(info, "UPG-03");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/connections/enabled-tables?connection=upgrade-db");
    await page.getByRole("textbox", { name: "搜索", exact: true }).fill("orders");
    await expect(page.getByRole("checkbox", { name: "选择 orders", exact: true })).toBeChecked();
    await page.getByRole("checkbox", { name: "选择 orders", exact: true }).uncheck();
    await page.getByRole("button", { name: /保存/ }).last().click();
    await expect.poll(async () => (await query(tokens.e2e_finance)).text).toContain("Access denied");
    // Restore by the real write endpoint; never edit customer files or forge a response.
    const restored = await page.request.put("/api/connections/upgrade-db/enabled-tables", { data: { dryRun: false, enabledTables: ["main.orders", "main.extra_orders"] } });
    expect(restored.status()).toBe(200);
    await expect.poll(async () => (await query(tokens.e2e_finance)).text, { timeout: 30_000 }).toContain("600");
  } finally { await context.close(); }
});

test("UPG-04 Wiki defaults to deny and separates authorized and unauthorized readers", async ({ browser }, info) => {
  feature(info, "UPG-04", "mcp");
  const allowed = await call(tokens.e2e_finance, "wiki_read", { key: "finance/upgrade.md" });
  expect(allowed.text).toContain("UPGRADE_FINANCE_ONLY");
  const denied = await call(tokens.e2e_sales, "wiki_read", { key: "finance/upgrade.md" });
  expect(denied.rpc.result.isError).toBe(true);
  expect(denied.text).toContain("context_not_available");
  expect(denied.text).not.toContain("UPGRADE_FINANCE_ONLY");
  const missingAcl = await call(tokens.e2e_finance, "wiki_read", { key: "finance/missing-acl.md" });
  expect(missingAcl.rpc.result.isError).toBe(true);
  expect(missingAcl.text).toContain("context_not_available");
  expect(missingAcl.text).not.toContain("UPGRADE_DEFAULT_DENY");
});

test("UPG-04 Skill search/read enforces object ACL and excludes draft, disabled and missing ACL", async ({}, info) => {
  feature(info, "UPG-04", "mcp");
  const read = (token: string, name: string) => call(token, "lucy_skill_read", { skill_name: name });
  expect((await read(tokens.e2e_finance, "upgrade-finance")).text).toContain("UPGRADE_SKILL_upgrade-finance");
  const found = await call(tokens.e2e_finance, "lucy_skill_search", { query: "升级技能" });
  expect(found.text).toContain("upgrade-finance");
  for (const name of ["upgrade-draft", "upgrade-disabled", "upgrade-no-acl"]) {
    expect(found.text).not.toContain(name);
    const denied = await read(tokens.e2e_finance, name);
    expect(denied.rpc.result.isError).toBe(true);
    expect(denied.text).not.toContain(`UPGRADE_SKILL_${name}`);
  }
  const outsider = await read(tokens.e2e_sales, "upgrade-finance");
  expect(outsider.rpc.result.isError).toBe(true);
  expect(outsider.text).not.toContain("UPGRADE_SKILL_upgrade-finance");
  expect((await call(tokens.e2e_sales, "lucy_skill_search", { query: "升级技能" })).text).not.toContain("upgrade-finance");
});

test("UPG-05 delete preview names blocking references and confirmed API deletion still refuses", async ({ browser }, info) => {
  feature(info, "UPG-05");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/connections");
    await page.getByTestId("connection-more-upgrade-db").click();
    await page.getByTestId("delete-connection-upgrade-db").click();
    await expect(page.getByTestId("delete-connection-block-reason")).toContainText("角色");
    await expect(page.getByTestId("delete-connection-drawer")).toContainText("finance_reader");
    await page.getByTestId("delete-connection-confirm-id").fill("upgrade-db");
    await expect(page.getByTestId("delete-connection-confirm-btn")).toBeDisabled();
    const forced = await page.request.post("/api/connections/upgrade-db/remove", { data: { dryRun: false, deleteAssets: true } });
    expect(forced.status()).toBe(409);
    expect((await forced.json()).error.code).toBe("connection_references_remain");
    expect(JSON.stringify(await (await page.request.get("/api/connections")).json())).toContain("upgrade-db");
  } finally { await context.close(); }
});

test("UPG-06 large table lists fold, disabled filtering hides enabled orders, monitoring pages load", async ({ browser }, info) => {
  feature(info, "UPG-06");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/connections/enabled-tables?connection=upgrade-db");
    await expect(page.getByTestId("whitelist-large-list-notice")).toContainText("已分页显示");
    const group = page.getByTestId("whitelist-group-toggle-upgrade-db-main");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("checkbox", { name: "选择 empty_000", exact: true })).toHaveCount(0);
    await group.click();
    await expect(page.getByRole("checkbox", { name: "选择 empty_000", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "状态筛选", exact: true }).selectOption("disabled");
    await expect(page.getByRole("checkbox", { name: "选择 orders", exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "选择 empty_000", exact: true })).toBeVisible();
    await page.goto("/ops/calls");
    await expect(page.getByTestId("page-header")).toContainText("调用监控");
    await page.goto("/admin/usage");
    await expect(page.getByTestId("page-header")).toBeVisible();
  } finally { await context.close(); }
});

test("UPG-07 version identity and mirror drift are visible on the real publish page", async ({ browser }, info) => {
  feature(info, "UPG-07");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const health = await (await page.request.get("/api/health")).json();
    expect(health.data.lucyVersion).toMatch(/^\d+\.\d+\.\d+$/);
    await page.goto("/admin/version");
    await expect(page.getByTestId("version-info-product")).toContainText(health.data.lucyVersion);
    await page.goto("/publish/workbench");
    await expect(page.getByTestId("workbench-mirror-only-semantic")).toContainText("retired.yaml");
  } finally { await context.close(); }
});

test("UPG-08 v2 result upload preserves unanswered detail and reports a 1/2 pass rate", async ({ browser }, info) => {
  feature(info, "UPG-08", "http+browser");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const download = await page.request.get("/api/eval/suites/upgrade/download");
    expect(download.status()).toBe(200);
    const parsed = parseEvalSuite(await download.text());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("downloaded suite invalid");
    const now = new Date().toISOString();
    const result = { lucy_eval_result_version: 2, suite_id: parsed.suite.suite_id, suite_hash: download.headers()["x-lucy-suite-hash"], domain: "upgrade", complete: true, role_id: "finance_reader", as_of: now.slice(0, 10), runner: { kind: "lucy_offline_batch", version: "2", model: "" }, started_at: now, finished_at: now, results: [
      { case_id: "correct", status: "PASS", outcome: "answered_ok" }, { case_id: "wrong", status: "FAIL", outcome: "answered_wrong", failures: ["required_column_missing"] }, { case_id: "unanswered", status: "ERROR", outcome: "not_answered", reason: "measure_unbound", error_message: "measure_unbound" }
    ] };
    const imported = await page.request.post("/api/eval/results/import", { data: { content: JSON.stringify(result), dryRun: false } });
    expect(imported.status(), await imported.text()).toBe(201);
    const runs = await (await page.request.get("/api/eval/runs?domain=upgrade")).json();
    expect(runs.data.runs[0]).toMatchObject({ passCount: 1, failCount: 1, totalCases: 2, notAnsweredCount: 1, passRate: 0.5 });
    const trend = await (await page.request.get("/api/eval/monitor/trend?domain=upgrade")).json();
    expect(JSON.stringify(trend)).toContain('"passRate":0.5');
    const invalid = await page.request.post("/api/eval/results/import", { data: { content: JSON.stringify({ ...result, complete: false }), dryRun: false } });
    expect(invalid.status()).toBeGreaterThanOrEqual(400);
    await page.goto("/eval/runs?domain=upgrade");
    await expect(page.getByTestId("page-header")).toBeVisible();
  } finally { await context.close(); }
});

test("UPG-09 changed source validation rejects SQL type float and accepts number", async ({ browser }, info) => {
  feature(info, "UPG-09", "http");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const bad = await page.request.put("/api/sources/upgrade-db/main/orders", { data: { dryRun: false, patch: { tableDescription: "升级类型校验" } } });
    expect(bad.status()).toBe(200);
    const validation = await page.request.post("/api/validate-changed");
    expect(validation.status()).toBe(200);
    const valid = await validation.json();
    expect(valid.data.results.some((r: any) => r.table === "orders" && r.validation.ok === true)).toBe(true);
    // The invalid-column path is injected by the run-owned fixture control plane, not an API mock.
    const { readFile, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(fixture.paths.project, "config/semantic-layer/upgrade-db/orders.yaml");
    const original = await readFile(file, "utf8");
    try {
      await writeFile(file, original + "\ncolumns:\n  - name: qa_derived\n    type: float\n    expr: amount\n");
      const rejected = await (await page.request.post("/api/validate-changed")).json();
      const item = rejected.data.results.find((r: any) => r.table === "orders");
      expect(item.validation.ok).toBe(false);
      expect(JSON.stringify(item.validation)).toContain("float");
    } finally {
      await writeFile(file, original);
      const restored = await (await page.request.post("/api/validate-changed")).json();
      expect(restored.data.results.find((r: any) => r.table === "orders").validation.ok).toBe(true);
    }
  } finally { await context.close(); }
});

test("UPG-08 downloaded suite runs against real SQLite through Lucy MCP, imports and appears in trends", async ({ browser }, info) => {
  feature(info, "UPG-08", "browser+http+mcp+database");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const download = await page.request.get("/api/eval/suites/upgrade/download");
    expect(download.status()).toBe(200);
    const parsed = parseEvalSuite(await download.text());
    if (!parsed.ok) throw new Error("downloaded suite invalid");
    let queryDiagnostic = "";
    const batch = await runOfflineBatch({
      suite: parsed.suite, asOf: "2026-10-20", roleId: "finance_reader", boundRoleIds: ["finance_reader"],
      executor: async (request) => {
        const response = await call(tokens.e2e_finance, "lucy_query", { connectionId: "upgrade-db", sourceName: "orders", measures: request.measures, dimensions: request.grain });
        if (response.status !== 200 || response.rpc?.result?.isError || response.rpc?.error || response.error) return { ok: false, reason: "measure_unbound", error_message: "measure_unbound" };
        const payload = response.value;
        queryDiagnostic = JSON.stringify(payload);
        if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.headers)) throw new Error("Unexpected fixture query shape: " + JSON.stringify(payload));
        const columns = payload.headers.map((c: any) => typeof c === "string" ? c : c.name);
        if (request.measures.includes("total_amount")) expect(JSON.stringify(payload.rows)).toContain("600");
        return { ok: true, rows: payload.rows, columns, measures: request.measures.filter((m) => columns.includes(m)), grain: request.grain.filter((d) => columns.includes(d)), filters: [], sql: payload.sql };
      }
    });
    expect(batch.complete).toBe(true);
    expect(batch.results.map((r) => r.outcome), JSON.stringify(batch.results) + queryDiagnostic).toEqual(["answered_ok", "answered_wrong", "not_answered"]);
    const upload = await page.request.post("/api/eval/results/import", { data: { content: JSON.stringify(batch), dryRun: false } });
    expect(upload.status(), await upload.text()).toBe(201);
    const trend = await (await page.request.get("/api/eval/monitor/trend?domain=upgrade")).json();
    expect(JSON.stringify(trend)).toContain('"passRate":0.5');
    await page.goto("/eval/monitor?domain=upgrade");
    await expect(page.getByTestId("page-header")).toBeVisible();
  } finally { await context.close(); }
});

test("UPG-10 21st registered call stops, one continuation works, a second continuation stops", async ({}, info) => {
  feature(info, "UPG-10", "mcp");
  const begin = await call(tokens.e2e_finance, "lucy_begin_question", { question: "收入是什么", intentSummary: "升级预算验证" });
  const turnId = begin.value?.turnId ?? begin.value?.lucyTurnId ?? begin.value?.lucy_turn_id;
  expect(typeof turnId).toBe("string");
  const headers = { "x-lucy-turn-id": turnId };
  for (let i = 0; i < 20; i++) {
    const allowed = await call(tokens.e2e_finance, "wiki_read", { key: "finance/upgrade.md" }, headers);
    expect(allowed.text).toContain("UPGRADE_FINANCE_ONLY");
  }
  const stop = await call(tokens.e2e_finance, "wiki_read", { key: "finance/upgrade.md" }, headers);
  expect(stop.value).toMatchObject({ reason: "question_budget_exhausted", partial: true });
  const continued = { ...headers, "x-lucy-question-continue": turnId };
  for (let i = 0; i < 20; i++) expect((await call(tokens.e2e_finance, "wiki_read", { key: "finance/upgrade.md" }, continued)).text).toContain("UPGRADE_FINANCE_ONLY");
  expect((await call(tokens.e2e_finance, "wiki_read", { key: "finance/upgrade.md" }, continued)).value.reason).toBe("question_budget_exhausted");
  await call(tokens.e2e_finance, "lucy_begin_question", { intentSummary: "预算验证结束后的独立问询" });
});

test("UPG-11 Chinese Wiki hits, empty results and denied results are distinguished", async ({}, info) => {
  feature(info, "UPG-11", "mcp");
  const hit = await call(tokens.e2e_finance, "wiki_search", { query: "收入" });
  expect(hit.text).toContain("finance/upgrade.md");
  const empty = await call(tokens.e2e_finance, "wiki_search", { query: "不存在主题-upgrade" });
  expect(empty.text).not.toContain("finance/upgrade.md");
  expect(empty.text).not.toContain("unparseable_text");
  const denied = await call(tokens.e2e_sales, "wiki_search", { query: "收入" });
  expect(denied.text).not.toContain("finance/upgrade.md");
});

test("UPG-12 explicit and candidate associations remain separate, record ids survive time filters", async ({ browser }, info) => {
  feature(info, "UPG-12", "mcp+http");
  const a = await call(tokens.e2e_sales, "lucy_begin_question", { question: "第一问", intentSummary: "关联复核" });
  const id = a.value?.turnId ?? a.value?.lucyTurnId ?? a.value?.lucy_turn_id;
  expect(typeof id).toBe("string");
  await call(tokens.e2e_sales, "wiki_search", { query: "不存在" }, { "x-lucy-turn-id": id });
  await call(tokens.e2e_sales, "wiki_search", { query: "不存在" });
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const entries = await (await page.request.get("/api/admin/audit?user=e2e_sales&includeProtocol=true&limit=100")).json();
    expect(entries.data.entries.some((e: any) => e.tool === "wiki_search")).toBe(true);
    const db = new DatabaseSync(path.join(fixture.paths.project, ".ktx-ui/audit.sqlite"), { readOnly: true });
    try {
      const calls = db.prepare("SELECT association_status, original_association_status, effective_association_status, original_turn_id, effective_turn_id FROM access_log WHERE user_id = ? AND tool = 'wiki_search'").all("e2e_sales");
      expect(calls.some((r: any) => r.association_status === "confirmed")).toBe(true);
      expect(calls.some((r: any) => r.association_status === "candidate")).toBe(true);
      for (const row of calls as any[]) {
        expect(row.original_association_status).toBe(row.association_status);
        expect(row.effective_association_status).toBe(row.association_status);
        expect(row.effective_turn_id).toBe(row.original_turn_id);
      }
    } finally { db.close(); }
    const wide = await (await page.request.get("/api/admin/audit/turns?user=e2e_sales&hours=168")).json();
    const narrow = await (await page.request.get("/api/admin/audit/turns?user=e2e_sales&hours=1")).json();
    expect(narrow.data.entries.length).toBeGreaterThan(0);
    for (const entry of narrow.data.entries) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(wide.data.entries.some((w: any) => w.id === entry.id)).toBe(true);
    }
  } finally { await context.close(); }
});

test("UPG-13 successful MCP response has durable admitted/prepared/terminal evidence", async ({ browser }, info) => {
  feature(info, "UPG-13", "mcp+http");
  const reply = await call(tokens.e2e_finance, "connection_list");
  expect(reply.status).toBe(200);
  expect(reply.text).toContain("upgrade-db");
  const ledger = new DatabaseSync(path.join(fixture.paths.project, ".ktx-ui/security.sqlite"), { readOnly: true });
  try {
    const latest = ledger.prepare("SELECT operation_id FROM security_events WHERE phase = 'response_prepared' ORDER BY seq DESC LIMIT 1").get() as { operation_id: string };
    const phases = ledger.prepare("SELECT phase FROM security_events WHERE operation_id = ? ORDER BY seq").all(latest.operation_id).map((r: any) => r.phase);
    expect(phases).toEqual(["request_admitted", "response_prepared", "response_delivered"]);
  } finally { ledger.close(); }
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const audit = await (await page.request.get("/api/admin/audit?user=e2e_finance&includeProtocol=true&limit=100")).json();
    expect(audit.data.entries.some((e: any) => e.tool === "connection_list" && e.outcome === "ok")).toBe(true);
  } finally { await context.close(); }
});

test("UPG-14 Athena form uses AWS environment credentials and never asks for a DB password", async ({ browser }, info) => {
  feature(info, "UPG-14");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/connections");
    await page.getByTestId("create-connection-btn").click();
    await page.getByTestId("create-connection-driver").selectOption("athena");
    await expect(page.getByTestId("create-connection-region")).toBeVisible();
    await expect(page.getByTestId("create-connection-s3-staging-dir")).toBeVisible();
    await expect(page.getByTestId("create-connection-password")).toHaveCount(0);
    await expect(page.getByTestId("create-connection-athena-hint")).toContainText("AWS");
  } finally { await context.close(); }
});

test("UPG-14-live Athena connection uses the real target and credentials", async ({ browser }, info) => {
  feature(info, "UPG-14-live", "aws");
  const connection = process.env.LUCY_UPGRADE_ATHENA_CONNECTION;
  if (!connection) blocked(info, "requires a run-scoped Athena connection and real AWS credentials; form tests do not prove connectivity");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const response = await page.request.post(`/api/connections/${encodeURIComponent(connection)}/test`);
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.data.status).toBe("ok");
  } finally { await context.close(); }
});

test("UPG-03 new connection expands lucy_admin while business roles stay scoped, UPG-05 clean connection deletes", async ({ browser }, info) => {
  feature(info, "UPG-03", "http+ktx");
  feature(info, "UPG-05", "http+ktx");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const created = await page.request.post("/api/connections", { data: { dryRun: false, id: "upgrade-added", driver: "sqlite", database: fixture.upgrade.sqlitePath, schemas: ["main"] } });
    expect(created.status(), await created.text()).toBe(200);
    // Supply a real local Manifest, then enable a table through the supported endpoint.
    const { mkdir, writeFile } = await import("node:fs/promises");
    const schemaDir = path.join(fixture.paths.project, "config/semantic-layer/upgrade-added/_schema");
    await mkdir(schemaDir, { recursive: true });
    await writeFile(path.join(schemaDir, "main.yaml"), "tables:\n  orders:\n    table: main.orders\n    columns:\n      - name: id\n        type: number\n");
    expect((await page.request.post("/api/catalog/reload", { data: { connectionId: "upgrade-added" } })).status()).toBe(200);
    const enabled = await page.request.put("/api/connections/upgrade-added/enabled-tables", { data: { dryRun: false, enabledTables: ["main.orders"] } });
    expect(enabled.status(), await enabled.text()).toBe(200);
    const admin = await (await page.request.get("/api/admin/roles/lucy_admin")).json();
    expect(JSON.stringify(admin.data)).toContain("upgrade-added");
    const business = await (await page.request.get("/api/admin/roles/finance_reader")).json();
    expect(JSON.stringify(business.data)).not.toContain("upgrade-added");
    const removed = await page.request.post("/api/connections/upgrade-added/remove", { data: { dryRun: false, deleteAssets: true } });
    expect(removed.status(), await removed.text()).toBe(200);
    expect(JSON.stringify(await (await page.request.get("/api/connections")).json())).not.toContain("upgrade-added");
  } finally { await context.close(); }
});
