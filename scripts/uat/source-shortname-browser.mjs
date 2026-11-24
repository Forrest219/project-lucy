// Real foreground WebUI verification for P1-64. No API/DOM mocking.
// Called by the isolated Docker runner; credentials arrive only through env.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WEB = process.env.SNC_WEB;
const PROJECT = process.env.SNC_PROJECT_DIR;
const OUT = process.env.SNC_OUT;
for (const name of ['SNC_WEB', 'SNC_PROJECT_DIR', 'SNC_OUT', 'SNC_ADMIN_PASSWORD', 'SNC_DB_PASSWORD']) {
  assert(process.env[name], `${name} required`);
}
assert(PROJECT.includes('lucy-snc-'), 'only isolated SNC fixture may be modified');
mkdirSync(OUT, { recursive: true });
const odsPath = join(PROJECT, 'config/semantic-layer/hive-1/_schema/ods.yaml');
const originalOds = readFileSync(odsPath, 'utf8');
assert(originalOds.includes('\n  ods_city:'), 'healthy ods alias required');
const report = { status: 'RUNNING', headed: true, webui: WEB, viewport: { width: 1440, height: 1000 }, measurements: [], consoleErrors: [] };
function persist() {
  let serialized = JSON.stringify(report, null, 2);
  for (const secret of [process.env.SNC_ADMIN_PASSWORD, process.env.SNC_DB_PASSWORD]) serialized = serialized.replaceAll(secret, '[REDACTED]');
  writeFileSync(join(OUT, 'summary.json'), serialized);
}
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
report.browserVersion = browser.version();
const context = await browser.newContext({ viewport: report.viewport });
const page = await context.newPage();
page.on('pageerror', error => report.consoleErrors.push(String(error)));
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/auth/login' && request.method() === 'POST') {
    const body = request.postDataJSON();
    report.loginPayloadMatches = { adminId: body.adminId === process.env.SNC_ADMIN_ID, password: body.password === process.env.SNC_ADMIN_PASSWORD };
  }
});
const stamp = () => page.evaluate(() => performance.now());
async function foreground() {
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  const state = await page.evaluate(() => ({ visibility: document.visibilityState, hasFocus: document.hasFocus() }));
  assert.equal(state.visibility, 'visible');
  assert.equal(state.hasFocus, true, 'browser must be foreground and focused');
  return state;
}
async function navigation(label, route, ready) {
  await foreground();
  await page.goto(WEB + route, { waitUntil: 'domcontentloaded' });
  await expect(ready()).toBeVisible({ timeout: 45000 });
  await expect(ready()).toBeInViewport();
  report.measurements.push({ label, kind: 'navigation', primaryReadyMs: Math.round(await stamp()), ...await foreground() });
  persist();
}
function isWrite(response, kind) {
  const request = response.request();
  if (kind === 'whitelist') return request.method() === 'PUT' && response.url().includes('/api/connections/hive-1/enabled-tables') && request.postDataJSON()?.dryRun === false;
  return request.method() === 'POST' && new URL(response.url()).pathname === '/api/connections' && request.postDataJSON()?.dryRun === false;
}
async function outcome(label, kind, trigger, target, expectedAck, issueTarget = target) {
  await foreground();
  const pending = page.waitForResponse(response => isWrite(response, kind), { timeout: 120000 });
  const t0 = await stamp();
  await trigger();
  const response = await pending;
  const json = await response.json();
  await response.finished();
  assert.equal(response.status(), 200);
  assert.equal(json.ok, true);
  assert.equal(json.data.runtimeAck, expectedAck);
  if (expectedAck) await expect(target).not.toContainText('运行态未确认');
  else {
    await expect(target).toContainText('运行态未确认');
    await expect(issueTarget).toContainText('source_map_compile_failed:');
    assert(json.data.policyRuntimeIssues.some(issue => issue.reason.startsWith('source_map_compile_failed:')));
    // A full navigation precedes each scenario, so no toast from the prior phase remains.
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast][data-type="error"]').first()).toBeVisible();
  }
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  const elapsed = Math.round(await stamp() - t0);
  const timing = response.request().timing();
  report.measurements.push({ label, kind: 'save-feedback', outcomeVisibleMs: elapsed,
    apiMs: Math.round(timing.responseEnd), httpStatus: response.status(), runtimeAck: json.data.runtimeAck,
    issueReasons: (json.data.policyRuntimeIssues ?? []).map(issue => issue.reason),
    feedback: await target.innerText(), ...await foreground() });
  persist();
  await page.screenshot({ path: join(OUT, label + '.png') });
}
async function whitelist(phase, ack) {
  await navigation('whitelist-' + phase, '/connections/enabled-tables?connection=hive-1&schema=ods', () => page.getByTestId('whitelist-row-ods.ods_zebra'));
  await page.getByTestId('whitelist-row-ods.ods_zebra').locator('input[type=checkbox]').click();
  const target = page.getByTestId('whitelist-status-banner');
  await outcome('whitelist-' + phase, 'whitelist', () => page.getByTestId('whitelist-save-changes').click(), target, ack);
  if (ack) await expect(target).toContainText('已保存');
}
async function createConnection(phase, ack) {
  await navigation('connection-' + phase, '/connections', () => page.getByTestId('create-connection-btn').or(page.getByTestId('create-connection-empty-btn')).first());
  await page.getByTestId('create-connection-btn').or(page.getByTestId('create-connection-empty-btn')).first().click();
  const drawer = page.getByTestId('create-connection-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByTestId('create-connection-id').fill('snc_ui_' + phase);
  await drawer.getByTestId('create-connection-driver').selectOption('mysql');
  for (const [field, value] of Object.entries({host: process.env.SNC_DB_HOST, port: '3306', database: 'snc_ui_' + phase, username: 'lucy', password: process.env.SNC_DB_PASSWORD, schemas: 'snc_ui_' + phase})) {
    await drawer.getByTestId('create-connection-' + field).first().fill(value);
  }
  await drawer.getByTestId('create-connection-test-btn').click();
  await expect(drawer.getByTestId('create-connection-probe-result').first()).toContainText('连接成功', { timeout: 60000 });
  await drawer.getByTestId('create-connection-preview-btn').click();
  await expect(drawer.getByTestId('create-connection-confirm-btn').or(page.getByTestId('endpoint-gate-panel'))).toBeVisible({ timeout: 60000 });
  const different = page.getByTestId('endpoint-gate-different-database');
  if (await different.isVisible()) {
    await different.click();
    await expect(drawer.getByTestId('create-connection-confirm-btn')).toBeVisible({ timeout: 60000 });
  }
  const separate = page.getByTestId('endpoint-gate-separate');
  const confirm = drawer.getByTestId('create-connection-confirm-btn');
  const trigger = await separate.isVisible() ? () => separate.click() : () => confirm.click();
  if (!(await separate.isVisible()) && !(await confirm.isVisible())) throw new Error('connection gate has no separate creation action: ' + await page.getByTestId('endpoint-gate-panel').innerText());
  const target = drawer.getByTestId('create-connection-success');
  await outcome('connection-' + phase, 'create', trigger, target, ack, drawer.getByTestId('create-connection-policy-runtime'));
  if (!ack) await expect(drawer.getByTestId('create-connection-policy-runtime')).toContainText('source_map_compile_failed:');
  else await expect(target).toContainText('连接已成功创建并保存');
  await drawer.getByTestId('create-connection-done-btn').click();
  // Each scenario owns and removes its disposable connection; do not let a
  // prior scenario change the endpoint-gate precondition of the next one.
  const cleanup = await page.request.post(WEB + '/api/connections/snc_ui_' + phase + '/remove', { data: { dryRun: false, deleteSecret: true }, headers: { Origin: WEB } });
  assert.equal(cleanup.status(), 200, 'scenario connection cleanup must succeed');
  assert.equal((await cleanup.json()).ok, true);
  report.measurements.push({ label: 'cleanup-' + phase, kind: 'fixture-cleanup', httpStatus: cleanup.status() });
  persist();
}
try {
  await page.bringToFront();
  await page.goto(WEB + '/login');
  await page.getByPlaceholder('例：lucy').fill(process.env.SNC_ADMIN_ID);
  await page.locator('#login-password').fill(process.env.SNC_ADMIN_PASSWORD);
  await expect(page.getByPlaceholder('例：lucy')).toHaveValue(process.env.SNC_ADMIN_ID);
  await expect(page.locator('#login-password')).toHaveValue(process.env.SNC_ADMIN_PASSWORD);
  const loginResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  report.loginStatus = loginResponse.status();
  assert.equal(loginResponse.status(), 200, 'synthetic browser login must succeed');
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
  for (const [phase, ack] of [['success', true], ['unconfirmed', false], ['recovered', true]]) {
    writeFileSync(odsPath, phase === 'unconfirmed' ? originalOds.replace('\n  ods_city:', '\n  city:') : originalOds);
    await whitelist(phase, ack);
    await createConnection(phase, ack);
  }
  assert.equal(report.consoleErrors.length, 0, 'page errors during browser verification');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = String(error);
  report.lastUrl = new URL(page.url()).pathname;
  report.lastVisibleText = (await page.locator('body').innerText().catch(() => '')).slice(-9000);
  // A failure screenshot is intentionally omitted: the form may still hold a secret.
  throw error;
} finally {
  writeFileSync(odsPath, originalOds);
  persist();
  await browser.close();
}
console.log(JSON.stringify({ status: report.status, measurements: report.measurements.length, out: resolve(OUT) }));
