#!/usr/bin/env node
/**
 * UAT-SUITE-BUTTON-FEEDBACK 探针（P1-42 / REQ-030-063）。
 *
 * 目的：在真实 Chromium 里，对每个下载／导出入口回答一件事——按钮点下去之后，浏览器是否真的收到
 * 一个「非空、文件名正确、不是错误体」的文件；界面的成功反馈（如有）是否与该结果一致。
 * 另有两个「保存」用例，只用真实结果：真实签发 Token（成功，且不得出现「运行态未确认」警示）、
 * 同标签再签发（服务端真实 4xx TOKEN_LABEL_TAKEN，界面必须报错而不是进入成功页）。
 *
 * 仅按钮级：不判断导出内容的业务正确性，只做大小、文件名、是否错误体的底线检查。
 * 失败场景只用真实失败；做不到的入口标 NOT-RUN 并写原因，不做故障注入。
 *
 * 用法（仓库根）：
 *   node scripts/uat/button-feedback-download-probe.mjs [--base http://127.0.0.1:55176] [--creds <凭据文件>]
 *     [--agent <agentId>] [--out inbox/uat-button-feedback-YYYY-MM-DD]
 *   或 npm run uat:button-feedback -- <同上参数>
 *
 * 凭据文件：第 1 行 WebUI URL，第 2 行管理员 id，第 3 行密码（只读入进程，不打印、不落盘）。
 * 探针签发的 `uat-btn-probe-<时间戳>` Token 一定在结束前吊销；吊销失败整轮判 FAIL。
 * 退出码：0＝没有缺陷判定；1＝存在缺陷判定或吊销失败；2＝环境不满足（BLOCKED，登录失败）。
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chromium } = createRequire(path.join(repoRoot, "webui", "package.json"))("playwright");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith("--") ? [...acc, [cur.slice(2), all[i + 1]]] : acc), [])
);
const CREDS = args.creds ?? "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
const today = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(repoRoot, args.out ?? `inbox/uat-button-feedback-${today}`);
const credLines = readFileSync(CREDS, "utf8").split("\n").map((s) => s.trim());
const BASE = (args.base ?? credLines[0]).replace(/\/$/, "");

const manifest = JSON.parse(readFileSync(path.join(repoRoot, "webui/scripts/download-surfaces.manifest.json"), "utf8"));
const CASE_OF = Object.fromEntries(
  Object.values(manifest.files).flatMap((f) => f.surfaces.map((x) => [x.id, x.case ?? null]))
);
const DEFECT = new Set(["EMPTY-FILE", "ERROR-BODY-AS-FILE", "BAD-NAME", "DOWNLOAD-FAILED", "SILENT", "NAVIGATED-AWAY", "FAKE-SUCCESS"]);
/** 先 fetch 再保存的入口在服务端忙时可能数十秒才响应；窗口过短会把「慢」误判成「静默」。 */
const DOWNLOAD_WAIT_MS = 45000;
const SUCCESS_RE = /已开始下载|已准备|已下载|下载成功|导出成功/;
const FAILURE_RE = /失败|错误|无法/;

const results = { base: BASE, startedAt: new Date().toISOString(), surfaces: [], save: [] };
let createdToken = null;

const notRun = (id, label, reason) => ({ id, case: CASE_OF[id] ?? null, label, verdict: "NOT-RUN", reason });
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const newLines = (before, after) => {
  const seen = new Set(before.split("\n"));
  return after.split("\n").filter((l) => !seen.has(l));
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

async function goto(route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

/** 点击一个下载入口并判定。`nameRe`：文件名必须匹配。 */
async function clickDownload(id, label, locator, nameRe) {
  if (await locator.isDisabled().catch(() => false)) return notRun(id, label, "按钮处于禁用态");
  const startUrl = page.url();
  const before = await bodyText(page);
  let download = null;
  const pending = page.waitForEvent("download", { timeout: DOWNLOAD_WAIT_MS }).then((d) => { download = d; return d; }).catch(() => null);
  await locator.click({ timeout: 10000 });
  // Toast 只停留数秒：与下载事件并行观察并累计，不能等满窗口再读一次快照。
  const seen = new Set();
  const startedAt = Date.now();
  let feedbackAt = null;
  while (!download && Date.now() - startedAt < DOWNLOAD_WAIT_MS) {
    for (const t of await page.locator("[data-sonner-toast]").allInnerTexts()) seen.add(t);
    const hasFailure = [...seen].some((t) => FAILURE_RE.test(t));
    const hasSuccess = [...seen].some((t) => SUCCESS_RE.test(t));
    if ((hasFailure || hasSuccess) && feedbackAt === null) feedbackAt = Date.now();
    // 反馈出现后仍给文件一段到达时间：失败提示 3 秒，成功提示 10 秒；仍没有文件即不再等。
    if (feedbackAt !== null && Date.now() - feedbackAt > (hasFailure ? 3000 : 10000)) break;
    await page.waitForTimeout(150);
  }
  if (!download) download = await Promise.race([pending, page.waitForTimeout(500).then(() => null)]);
  await page.waitForTimeout(400);
  const after = await bodyText(page);
  const toasts = [...new Set([...seen, ...(await page.locator("[data-sonner-toast]").allInnerTexts())])];
  const fresh = newLines(before, after);
  const successShown = [...fresh, ...toasts].some((l) => SUCCESS_RE.test(l));
  const failureShown = toasts.some((t) => FAILURE_RE.test(t));
  const base = { id, case: CASE_OF[id] ?? null, label, successShown, failureShown, toasts };

  if (!download) {
    const navigated = page.url() !== startUrl;
    const verdict = navigated ? "NAVIGATED-AWAY" : successShown ? "FAKE-SUCCESS" : failureShown ? "HONEST-FAILURE" : "SILENT";
    if (navigated) await page.goBack().catch(() => {});
    return { ...base, verdict, navigatedTo: navigated ? "(page URL changed)" : null };
  }
  const failure = await download.failure();
  if (failure) return { ...base, verdict: "DOWNLOAD-FAILED", filename: download.suggestedFilename(), failure };
  const file = await download.path();
  const size = file ? statSync(file).size : 0;
  const filename = download.suggestedFilename();
  const head = file ? readFileSync(file).subarray(0, 200).toString("utf8") : "";
  const sha = file ? createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16) : null;
  let verdict = "REAL";
  if (size === 0) verdict = "EMPTY-FILE";
  else if (/^\s*\{\s*"ok"\s*:\s*false/.test(head)) verdict = "ERROR-BODY-AS-FILE";
  else if (nameRe && !nameRe.test(filename)) verdict = "BAD-NAME";
  return { ...base, verdict, filename, size, sha256_16: sha };
}

/** 单个入口组失败只记 NOT-RUN，不拖垮整轮。 */
async function group(ids, fn) {
  try {
    await fn();
  } catch (error) {
    const reason = `探针步骤失败：${String(error?.message ?? error).split("\n").slice(0, 3).join(" ").slice(0, 300)}`;
    for (const [id, label] of ids) if (!results.surfaces.some((s) => s.id === id)) results.surfaces.push(notRun(id, label, reason));
  }
}

const push = (r) => results.surfaces.push(r);

try {
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { adminId: credLines[1], password: credLines[2] } });
  results.r0 = { login: login.status(), verdict: login.ok() ? "PASS" : "BLOCKED" };
  if (!login.ok()) throw new Error(`R0 BLOCKED: 登录失败 HTTP ${login.status()}`);

  const A = [["audit-export-current", "审计：导出"], ["audit-export-pack", "审计：导出审计证据包"]];
  await group(A, async () => {
    await goto("/admin/audit?range=7d");
    push(await clickDownload(A[0][0], A[0][1], page.getByTestId("audit-export-current"), /\.(csv|json|zip)$/i));
    push(await clickDownload(A[1][0], A[1][1], page.getByTestId("audit-export-pack"), /\.(zip|json|csv)$/i));
  });

  const R = [["reconciliation-export", "审计对账：导出对账证据包"]];
  await group(R, async () => {
    await goto("/admin/audit-reconciliation");
    push(await clickDownload(R[0][0], R[0][1], page.getByTestId("reconciliation-export"), /\.(zip|csv|json)$/i));
  });

  const C = [["config-audit-export", "配置审计：导出 CSV"]];
  await group(C, async () => {
    await goto("/admin/config-audit");
    push(await clickDownload(C[0][0], C[0][1], page.getByRole("link", { name: "导出 CSV" }), /\.csv$/i));
  });

  const P = [["publish-history-export", "发布记录：导出 CSV"]];
  await group(P, async () => {
    await goto("/publish/history");
    push(await clickDownload(P[0][0], P[0][1], page.getByTestId("publish-history-export-csv"), /\.csv$/i));
  });

  const W = [["wiki-download", "Wiki：下载已保存版本"]];
  await group(W, async () => {
    const list = await (await context.request.get(`${BASE}/api/wiki`)).json();
    const key = list.data?.pages?.[0]?.key;
    if (!key) {
      push(notRun(W[0][0], W[0][1], "实例里没有 Wiki 文档"));
      return;
    }
    await goto(`/wiki?key=${encodeURIComponent(key)}`);
    const btn = page.getByTestId("wiki-download-button");
    await btn.waitFor({ timeout: 15000 });
    push(await clickDownload(W[0][0], W[0][1], btn, /\.md$/i));
  });

  const T = [["table-export-yaml", "表编辑器：导出 YAML"]];
  await group(T, async () => {
    await goto("/catalog");
    const href = await page.locator('a[href^="/catalog/"]').first().getAttribute("href", { timeout: 15000 });
    await goto(href);
    push(await clickDownload(T[0][0], T[0][1], page.getByRole("button", { name: "导出 YAML" }), /\.yaml$/i));
  });

  const E = [["eval-suite-download", "评测用例：下载 Eval YAML"]];
  await group(E, async () => {
    await goto("/eval/cases");
    push(await clickDownload(E[0][0], E[0][1], page.getByRole("button", { name: /下载\s*Eval YAML/ }).first(), /\.ya?ml$/i));
  });

  const M = [["catalog-manifest-download", "连接：下载 Manifest"]];
  await group(M, async () => {
    await goto("/connections");
    // 「下载 Manifest」在每个 Schema 行的「更多」折叠菜单里；逐行展开，直到出现可见的下载按钮。
    const rows = page.locator('summary[aria-label^="更多 Schema 操作"]');
    const visibleDownload = page.locator('[data-testid^="download-manifest-"]:visible');
    for (let i = 0, n = await rows.count(); i < n; i += 1) {
      await rows.nth(i).click();
      if ((await visibleDownload.count()) > 0) break;
    }
    if ((await visibleDownload.count()) === 0) {
      push(notRun(M[0][0], M[0][1], "没有任何 Schema 行提供「下载 Manifest」（没有可读 Manifest）"));
      return;
    }
    push(await clickDownload(M[0][0], M[0][1], visibleDownload.first(), /\.ya?ml$/i));
  });

  const B = [["catalog-batch-package", "目录：批量下载语义维护包"]];
  await group(B, async () => {
    await goto("/catalog");
    await page.locator('[data-testid^="catalog-row-select-"]').first().check({ timeout: 15000 });
    await page.getByTestId("catalog-batch-download").first().click();
    const link = page.getByTestId("catalog-batch-export").getByRole("link", { name: "下载语义维护包" });
    await link.waitFor({ timeout: 60000 });
    push(await clickDownload(B[0][0], B[0][1], link, /\.(zip|tar|tgz|gz)$/i));
  });

  // 保存用例：只用真实结果。
  const agents = (await (await context.request.get(`${BASE}/api/admin/agents`)).json()).data?.agents ?? [];
  const agent = (args.agent && agents.find((a) => a.id === args.agent)) ?? agents.find((a) => (a.tokens ?? []).length > 0) ?? agents[0];
  if (!agent) {
    results.save.push({ id: "UAT-BTN-S01", verdict: "NOT-RUN", reason: "实例里没有 Agent" });
    results.save.push({ id: "UAT-BTN-S02", verdict: "NOT-RUN", reason: "实例里没有 Agent" });
  } else {
    const label = `uat-btn-probe-${Date.now()}`;
    const issue = async () => {
      await goto(`/admin/agents/${encodeURIComponent(agent.id)}/tokens/new`);
      await page.getByLabel("Token 标签").fill(label);
      const posted = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/admin\/agents\/[^/]+\/tokens$/.test(new URL(r.url()).pathname));
      await page.getByRole("button", { name: "生成 Token" }).click();
      const resp = await posted;
      const body = await resp.json().catch(() => ({}));
      await page.waitForTimeout(500);
      return { resp, body };
    };
    try {
      const first = await issue();
      if (first.resp.ok() && first.body.data?.token) createdToken = { agentId: agent.id, label };
      const plaintextShown = await page.getByTestId("plaintext-token").isVisible().catch(() => false);
      const warned = await page.getByTestId("token-runtime-unconfirmed").isVisible().catch(() => false);
      const ack = first.body.data?.runtimeAck;
      // 成功：页面进入成功屏；运行态确认时不得出现「未确认」警示（反之，未确认时必须出现）。
      const consistent = ack === true ? !warned : warned;
      results.save.push({
        id: "UAT-BTN-S01", label: "新建 Token：真实签发成功", http: first.resp.status(), runtimeAck: ack ?? null,
        plaintextShown, unconfirmedWarningShown: warned,
        verdict: first.resp.ok() && plaintextShown && consistent ? "REAL" : "FAKE-SUCCESS"
      });

      const second = await issue();
      const successScreen = await page.getByTestId("plaintext-token").isVisible().catch(() => false);
      const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
      const errorShown = toasts.some((t) => FAILURE_RE.test(t) || /已存在|already exists/i.test(t));
      results.save.push({
        id: "UAT-BTN-S02", label: "新建 Token：同标签再次签发（真实 4xx）", http: second.resp.status(),
        serverCode: second.body.error?.code ?? null, successScreenShown: successScreen, errorShown, toasts,
        verdict: !second.resp.ok() && !successScreen && errorShown ? "REAL" : successScreen ? "FAKE-SUCCESS" : second.resp.ok() ? "NOT-RUN" : "SILENT"
      });
    } catch (error) {
      const reason = `探针步骤失败：${String(error?.message ?? error).split("\n")[0].slice(0, 200)}`;
      for (const id of ["UAT-BTN-S01", "UAT-BTN-S02"]) if (!results.save.some((s) => s.id === id)) results.save.push({ id, verdict: "NOT-RUN", reason });
    }
  }

  // manifest 里声明 not-run 的入口：原因来自清单，不在探针里重复。
  for (const entry of Object.values(manifest.files)) {
    for (const s of entry.surfaces) {
      if (s.coverage === "not-run" && !results.surfaces.some((x) => x.id === s.id)) results.surfaces.push(notRun(s.id, s.label, s.reason));
    }
  }
} catch (error) {
  results.fatal = String(error?.message ?? error);
} finally {
  // 吊销探针 Token（Fastify 对无 body 的 DELETE 带 JSON content-type 会 400，所以只带 cookie）。
  if (createdToken) {
    const r = await context.request.delete(`${BASE}/api/admin/agents/${encodeURIComponent(createdToken.agentId)}/tokens/${encodeURIComponent(createdToken.label)}`);
    results.cleanup = { revoked: r.ok(), http: r.status(), label: createdToken.label };
  }
  await browser.close();
}

const all = [...results.surfaces, ...results.save];
const counts = all.reduce((acc, s) => ({ ...acc, [s.verdict]: (acc[s.verdict] ?? 0) + 1 }), {});
results.summary = counts;
results.defects = all.filter((s) => DEFECT.has(s.verdict)).map((s) => `${s.id}:${s.verdict}`);
results.finishedAt = new Date().toISOString();

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "probe-result.json"), JSON.stringify(results, null, 2));
const lines = [`# UAT-SUITE-BUTTON-FEEDBACK 探针结果`, ``, `- 实例：${BASE}`, `- 开始：${results.startedAt}`, `- 汇总：${JSON.stringify(counts)}`, ``,
  `| 入口 | 用例 | 判定 | 文件名 | 字节 | 备注 |`, `|---|---|---|---|---|---|`,
  ...results.surfaces.map((s) => `| ${s.label} | ${s.case ?? "-"} | ${s.verdict} | ${s.filename ?? "-"} | ${s.size ?? "-"} | ${s.reason ?? (s.toasts?.join(" / ") || "")} |`),
  ``, `| 保存用例 | 判定 | HTTP | 备注 |`, `|---|---|---|---|`,
  ...results.save.map((s) => `| ${s.id} ${s.label ?? ""} | ${s.verdict} | ${s.http ?? "-"} | ${s.reason ?? s.serverCode ?? ""} |`)];
if (results.cleanup) lines.push(``, `- Token 吊销：${results.cleanup.revoked ? "成功" : "失败"}（HTTP ${results.cleanup.http}，标签 ${results.cleanup.label}）`);
if (results.fatal) lines.push(``, `- FATAL：${results.fatal}`);
writeFileSync(path.join(OUT, "probe-result.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));

if (results.fatal?.startsWith("R0 BLOCKED")) process.exit(2);
process.exit(results.defects.length > 0 || (results.cleanup && !results.cleanup.revoked) ? 1 : 0);
