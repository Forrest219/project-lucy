/**
 * access-write-window-browser.mjs — REQ-0117 UAT-AWW-08 前台浏览器验证（两阶段）。
 *
 * 阶段 1（正常容器）：E1/E5 列表加载与入口、E3 读己之写、E9–E12 编辑保存提交态与成交、
 * E4 重叠成交、E13/E17 Agent 名册与入口、E18 写窗内名册无错误终态、E8b 同对象冲突提示。
 * 阶段 2（override 容器，等待上限 200ms，由 --refuse 阶段参数触发前须先行重建容器）：
 * E2/E8a 超限诚实拒绝的可重试提示；跑完由调用方还原容器。
 *
 * 用法：node scripts/uat/access-write-window-browser.mjs <runDir> [normal|refuse]
 * 证据（截图＋计时 JSON）落 docs/qa/uat/suites/access-write-window/runs/<run>/。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WEB, SECRET_DIR } from "./access-write-window-stack.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../webui/package.json"));
const { chromium, expect } = require("@playwright/test");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.argv[3] ?? "normal";
const runDir = process.argv[2] ?? path.join(ROOT, `docs/qa/uat/suites/access-write-window/runs/browser-${phase}`);
mkdirSync(runDir, { recursive: true });

const report = { phase, startedAt: new Date().toISOString(), webui: WEB, viewport: { width: 1920, height: 1080 }, cases: [], browserTimings: [], failures: [] };
const persist = () => writeFileSync(path.join(runDir, "browser.json"), JSON.stringify(report, null, 2));

const cred = JSON.parse(readFileSync(path.join(SECRET_DIR, "admin.json"), "utf8"));
const login = await fetch(`${WEB}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
});
const cookie = (login.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
if (!cookie) { console.error("登录失败"); process.exit(2); }

const api = async (p, m = "GET", body) => {
  const started = Date.now();
  const res = await fetch(`${WEB}${p}`, {
    method: m,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180_000)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { s: res.status, j: json, ms: Date.now() - started, h: res.headers };
};

const browser = await chromium.launch({ headless: false, channel: "chrome" });
report.browser = browser.version();
const context = await browser.newContext({ viewport: report.viewport });
await context.addCookies(cookie.split("; ").map((c) => { const [name, ...value] = c.split("="); return { name, value: value.join("="), url: WEB }; }));
const page = await context.newPage();
page.on("dialog", (d) => d.accept());

async function front() {
  await page.bringToFront();
  const state = await page.evaluate(() => ({ visible: document.visibilityState, focus: document.hasFocus() }));
  if (state.visible !== "visible" || state.focus !== true) throw new Error("页面不在前台/无焦点");
  return state;
}

async function run(name, fn) {
  const started = Date.now();
  try {
    await front();
    await fn();
    report.cases.push({ name, status: "PASS", ms: Date.now() - started });
    await page.screenshot({ path: path.join(runDir, `${name}.png`) });
  } catch (error) {
    report.cases.push({ name, status: "FAIL", error: String(error).slice(0, 400), ms: Date.now() - started });
    report.failures.push(name);
    await page.screenshot({ path: path.join(runDir, `${name}-failure.png`) }).catch(() => {});
  }
  persist();
  console.log(`[${report.cases.at(-1).status}] ${name} (${report.cases.at(-1).ms}ms)`);
}

const tag = Date.now().toString(36);

/** 写结算后展示快照重建收敛（夹具规模下构建可达 ~10s 预算级）；每个浏览器用例前调用。 */
async function waitForRolesSettled(maxMs = 90_000) {
  const started = Date.now();
  for (;;) {
    const res = await api("/api/admin/roles");
    if (res.s === 200 && res.j?.data?.roles?.length > 0) return Date.now() - started;
    if (Date.now() - started > maxMs) throw new Error(`role-list 快照 ${maxMs}ms 未收敛`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * 前一用例中止时其在途写仍在服务端执行（夹具规模 PATCH 可达 ~45s）：软等待角色描述达到
 * 期望终态再放行下一用例；超时只记录不抛出（若前一用例根本未发出写，等待无意义但无害）。
 */
async function waitForRoleDescription(roleId, expected, maxMs = 120_000) {
  const started = Date.now();
  for (;;) {
    const res = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`);
    const description = res.j?.data?.role?.description ?? res.j?.data?.description;
    if (res.s === 200 && description === expected) return Date.now() - started;
    if (Date.now() - started > maxMs) {
      report.browserTimings.push({ kind: "role-write-settle-timeout", roleId, waitedMs: Date.now() - started });
      return -1;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (phase === "normal") {
  // ── E1/E5：列表加载计时＋创建入口 primary ──────────────────────────────
  await run("E1-E5-roles-list-load", async () => {
    const started = Date.now();
    await page.goto(`${WEB}/admin/roles`, { waitUntil: "commit" });
    await expect(page.getByTestId("role-list-table")).toBeVisible({ timeout: 30000 });
    report.browserTimings.push({ kind: "roles-list-primaryReady", ms: Date.now() - started, ...await front() });
    await expect(page.getByRole("link", { name: "新建 Role" })).toBeVisible();
  });

  // ── E3（API 创建＋浏览器读己之写）────────────────────────────────────
  const apiRoleId = `aww08_api_${tag}`;
  await run("E3-roles-list-read-your-write", async () => {
    await waitForRolesSettled();
    const names = [...Array(2000)].map((_, i) => `req0117.t${String(i + 1).padStart(4, "0")}`);
    const roleDef = { description: "REQ-0117 浏览器创建", allow: { connections: ["demo-mysql"], tableSelectors: [{ connection: "demo-mysql", schema: "req0117", names }], tools: ["lucy_catalog", "lucy_query"] } };
    const dry = await api("/api/admin/roles", "POST", { dryRun: true, roleId: apiRoleId, role: roleDef });
    if (dry.s !== 200) throw new Error(`dryRun 失败 ${dry.s}`);
    const p = dry.j?.data ?? {};
    const started = Date.now();
    const write = await api("/api/admin/roles", "POST", { dryRun: false, roleId: apiRoleId, role: roleDef, baseObjectVersion: p.baseObjectVersion, previewToken: p.previewToken, operationId: crypto.randomUUID() });
    const apiMs = Date.now() - started;
    if (write.s !== 200) throw new Error(`创建失败 ${write.s}`);
    // 写结算后浏览器读取列表必须包含新角色
    await page.goto(`${WEB}/admin/roles`, { waitUntil: "commit" });
    const t0 = Date.now();
    await expect(page.getByTestId("role-list-table")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(apiRoleId).first()).toBeVisible({ timeout: 30000 });
    report.browserTimings.push({ kind: "roles-list-readYourWrite", apiWriteMs: apiMs, frontMs: Date.now() - t0 });
  });

  // ── E9–E12：编辑保存（提交态拦截→成交）＋ E4 重叠成交 ─────────────────
  await run("E4-E12-roles-ui-edit-save-overlap", async () => {
    await waitForRolesSettled();
    await page.goto(`${WEB}/admin/roles/${apiRoleId}`, { waitUntil: "commit" });
    const desc = page.locator("#role-description-input");
    await expect(desc).toBeVisible({ timeout: 60000 });
    await desc.fill(`REQ-0117 编辑 ${tag}`);
    await page.getByRole("button", { name: "保存权限配置" }).click();
    // 定位走稳定 testid：提交态按钮文案会切为「保存中…」，按文案定位会在 pending 后失配
    const confirm = page.getByTestId("role-permission-review-drawer").getByTestId("role-review-confirm");
    await expect(confirm).toBeVisible({ timeout: 90000 });
    // API 重叠写：确认瞬间在另一 roleId 上创建（有界等待后成交）
    const overlapId = `aww08_ovl_${tag}`;
    const ovlDef = { description: "overlap", allow: { connections: ["demo-mysql"], tableSelectors: [{ connection: "demo-mysql", schema: "dataforai", names: ["superstore_orders"] }], tools: ["lucy_catalog"] } };
    const dryB = await api("/api/admin/roles", "POST", { dryRun: true, roleId: overlapId, role: ovlDef });
    if (dryB.s !== 200) throw new Error(`重叠写 dryRun 失败 ${dryB.s} ${JSON.stringify(dryB.j?.error ?? {})}`);
    const pB = dryB.j?.data ?? {};
    const writeStart = Date.now();
    await confirm.click();
    // E10：提交态拦截——按钮进入「保存中…」且 disabled
    await expect(confirm).toHaveText("保存中…", { timeout: 8000 });
    await expect(confirm).toBeDisabled();
    const pendingText = (await confirm.textContent())?.trim();
    report.browserTimings.push({ kind: "save-submit-state", text: pendingText });
    const overlapPromise = api("/api/admin/roles", "POST", { dryRun: false, roleId: overlapId, role: ovlDef, baseObjectVersion: pB.baseObjectVersion, previewToken: pB.previewToken, operationId: crypto.randomUUID() });
    // UI 成交 → 详情呈现新状态（E9）
    await expect(page.getByText("已保存").first()).toBeVisible({ timeout: 90000 });
    const uiWriteMs = Date.now() - writeStart;
    const overlap = await overlapPromise;
    report.browserTimings.push({ kind: "ui-save-frontMs", ms: uiWriteMs, overlapApiStatus: overlap.s, overlapApiMs: overlap.ms });
    // E4 合同（Spec E4/E10）：重叠提交经有界等待后「成交」或「得到可重试提示」，两分支均合规；
    // 夹具规模下写窗 ~18–45s 常超 15s 等待上限，诚实拒绝是预期分支之一
    if (overlap.s === 200) {
      report.browserTimings.push({ kind: "overlap-outcome", branch: "committed" });
      await api(`/api/admin/roles/${overlapId}`, "DELETE", {});
    } else if (overlap.s === 503 && overlap.j?.error?.code === "PUBLISH_COORDINATOR_BUSY") {
      const retryAfter = overlap.h?.get?.("retry-after") ?? overlap.j?.error?.detail?.retryAfterSeconds;
      if (!retryAfter) throw new Error("重叠写 503 缺少 Retry-After 重试指引");
      report.browserTimings.push({ kind: "overlap-outcome", branch: "honest-refusal", retryAfter, holder: overlap.j?.error?.detail?.holder?.kind });
    } else {
      throw new Error(`API 重叠写未成交且非诚实拒绝：${overlap.s} ${JSON.stringify(overlap.j?.error ?? {})}`);
    }
    // E9：详情呈现新状态（描述已更新）
    await expect(page.locator("#role-description-input")).toHaveValue(`REQ-0117 编辑 ${tag}`, { timeout: 60000 });
  });

  // ── E8b：同对象版本冲突提示（编辑内容不丢失）────────────────────────────
  await run("E8b-version-conflict-hint", async () => {
    await waitForRolesSettled();
    // E4 失败中止时其 PATCH 仍在服务端执行：先等它收敛，避免详情首屏撞上在途写
    await waitForRoleDescription(apiRoleId, `REQ-0117 编辑 ${tag}`);
    await page.goto(`${WEB}/admin/roles/${apiRoleId}`, { waitUntil: "commit" });
    const desc = page.locator("#role-description-input");
    await expect(desc).toBeVisible({ timeout: 60000 });
    await desc.fill(`UI 冲突草稿 ${tag}`);
    await page.getByRole("button", { name: "保存权限配置" }).click();
    const confirm = page.getByTestId("role-permission-review-drawer").getByTestId("role-review-confirm");
    await expect(confirm).toBeVisible({ timeout: 90000 });
    // UI dryRun 完成后、确认前：API 以当前版本抢改同一角色（推进 object version）
    const cur = await api(`/api/admin/roles/${apiRoleId}`);
    const curBase = cur.j?.data?.baseObjectVersion;
    const dry2 = await api(`/api/admin/roles/${apiRoleId}`, "PATCH", { dryRun: true, patch: { description: `确认前抢改 ${tag}` } });
    if (dry2.s !== 200) throw new Error(`抢改 dryRun 失败 ${dry2.s} ${JSON.stringify(dry2.j?.error ?? {})}`);
    const grab = await api(`/api/admin/roles/${apiRoleId}`, "PATCH", { dryRun: false, patch: { description: `确认前抢改 ${tag}` }, baseObjectVersion: curBase, previewToken: dry2.j?.data?.previewToken, operationId: crypto.randomUUID() });
    if (grab.s !== 200) throw new Error(`API 抢改失败 ${grab.s} ${JSON.stringify(grab.j?.error ?? {})}`);
    await confirm.click();
    // 期望：409 族 → 审阅抽屉关闭，主页面「配置已变化」恢复面板可见；草稿仍在
    // 409 可能在编译后才返回（夹具规模编译 ~22s），抽屉关闭断言给足写窗量级预算
    await expect(page.getByTestId("role-permission-review-drawer")).toBeHidden({ timeout: 90000 });
    await expect(page.getByText("配置已变化").first()).toBeVisible({ timeout: 30000 });
    const draftKept = (await desc.inputValue()).includes(`UI 冲突草稿 ${tag}`);
    report.browserTimings.push({ kind: "version-conflict-draft-kept", draftKept });
    if (!draftKept) throw new Error("冲突后编辑内容丢失");
  });

  // ── E13/E17：Agent 名册加载＋创建入口 ─────────────────────────────────
  await run("E13-E17-agents-list-load", async () => {
    await waitForRolesSettled();
    const started = Date.now();
    await page.goto(`${WEB}/admin/agents`, { waitUntil: "commit" });
    await expect(page.getByText("uat_agent_").first()).toBeVisible({ timeout: 45000 });
    report.browserTimings.push({ kind: "agents-roster-primaryReady", ms: Date.now() - started, ...await front() });
    await expect(page.getByRole("button", { name: "新建 Agent" })).toBeVisible();
  });

  // ── E18：写窗内名册读取不出现错误终态 ─────────────────────────────────
  await run("E18-agents-no-error-terminal-during-write", async () => {
    await waitForRolesSettled();
    const names = [...Array(2000)].map((_, i) => `req0117.t${String(i + 1).padStart(4, "0")}`);
    const idA = `aww08_agents_${tag}`;
    const roleDef = { description: "aww08", allow: { connections: ["demo-mysql"], tableSelectors: [{ connection: "demo-mysql", schema: "req0117", names }], tools: ["lucy_catalog"] } };
    const dryA = await api("/api/admin/roles", "POST", { dryRun: true, roleId: idA, role: roleDef });
    const pA = dryA.j?.data ?? {};
    const navPromise = page.goto(`${WEB}/admin/agents`, { waitUntil: "commit" });
    await api("/api/admin/roles", "POST", { dryRun: false, roleId: idA, role: roleDef, baseObjectVersion: pA.baseObjectVersion, previewToken: pA.previewToken, operationId: crypto.randomUUID() });
    await navPromise;
    await expect(page.getByText("uat_agent_").first()).toBeVisible({ timeout: 45000 });
    const errorCount = await page.getByText("服务暂不可用").or(page.getByText("读取失败")).count();
    if (errorCount > 0) throw new Error("写窗内出现错误终态文案");
    await api(`/api/admin/roles/${idA}`, "DELETE", {});
  });

  // 清理 API 创建的角色（浏览器跑次收尾）
  await api(`/api/admin/roles/${`aww08_api_${tag}`}`, "DELETE", {});
}

if (phase === "refuse") {
  // 前置：容器已以 override（LUCY_PUBLISH_WAIT_BUDGET_MS=200）重建。
  // ── E2/E8a：超限诚实拒绝的可重试提示（草稿保留）────────────────────────
  const apiRoleId = `aww08_refuse_${tag}`;
  await run("E2-E8a-busy-refusal-hint", async () => {
    const names = [...Array(2000)].map((_, i) => `req0117.t${String(i + 1).padStart(4, "0")}`);
    const roleDef = { description: "refuse probe", allow: { connections: ["demo-mysql"], tableSelectors: [{ connection: "demo-mysql", schema: "req0117", names }], tools: ["lucy_catalog", "lucy_query"] } };
    const dry = await api("/api/admin/roles", "POST", { dryRun: true, roleId: apiRoleId, role: roleDef });
    const p = dry.j?.data ?? {};
    const write = await api("/api/admin/roles", "POST", { dryRun: false, roleId: apiRoleId, role: roleDef, baseObjectVersion: p.baseObjectVersion, previewToken: p.previewToken, operationId: crypto.randomUUID() });
    if (write.s !== 200) throw new Error(`准备创建失败 ${write.s}`);
    await page.goto(`${WEB}/admin/roles/${apiRoleId}`, { waitUntil: "commit" });
    const desc = page.locator("#role-description-input");
    await expect(desc).toBeVisible({ timeout: 60000 });
    await desc.fill(`UI 拒绝草稿 ${tag}`);
    await page.getByRole("button", { name: "保存权限配置" }).click();
    const confirm = page.getByTestId("role-permission-review-drawer").getByTestId("role-review-confirm");
    await expect(confirm).toBeVisible({ timeout: 90000 });
    // API 持窗（2000 表创建），UI 确认 → 200ms 等待超限 → 503 诚实拒绝
    const holdDef = { dryRun: true, roleId: `aww08_hold_${tag}`, role: roleDef };
    const dryHold = await api("/api/admin/roles", "POST", holdDef);
    const pH = dryHold.j?.data ?? {};
    await confirm.click();
    const hold = await api("/api/admin/roles", "POST", { ...holdDef, dryRun: false, baseObjectVersion: pH.baseObjectVersion, previewToken: pH.previewToken, operationId: crypto.randomUUID() });
    if (hold.s !== 200) throw new Error(`持窗写失败 ${hold.s}`);
    // 期望：可重试提示可见（审阅抽屉关闭、恢复面板不被遮挡）；草稿保留
    await expect(page.getByTestId("role-permission-review-drawer")).toBeHidden({ timeout: 30000 });
    await expect(page.getByText("有变更正在保存，请稍后重试").first()).toBeVisible({ timeout: 30000 });
    const draftKept = (await desc.inputValue()).includes(`UI 拒绝草稿 ${tag}`);
    report.browserTimings.push({ kind: "busy-refusal-draft-kept", draftKept });
    if (!draftKept) throw new Error("拒绝后编辑内容丢失");
    await api(`/api/admin/roles/${apiRoleId}`, "DELETE", {});
  });
}

await browser.close();
persist();
console.log(`\n阶段=${phase} 跑次目录：${runDir}`);
console.log(`用例：${report.cases.length}，失败：${report.failures.length}`);
if (report.failures.length > 0) process.exit(1);
