#!/usr/bin/env node
/**
 * UAT-SUITE-COPY-FAKE-SUCCESS 探针（P1-40）。
 *
 * 目的：在「非安全上下文（明文 HTTP、非回环）」的真实 Chromium 里，对每个复制入口回答三件事：
 *   1. 界面有没有说「已复制」（Toast／按钮／状态文案）；
 *   2. 系统剪贴板里到底有没有这段文字（真实 Ctrl/Cmd+V 粘贴读回，不 stub execCommand）；
 *   3. 二者不一致＝假成功。
 *
 * 用法（仓库根）：
 *   node scripts/uat/copy-button-fake-success-probe.mjs \
 *     [--base http://<局域网IP>:55176] [--creds <凭据文件路径>] [--out inbox/uat-copy-fake-success-YYYY-MM-DD]
 *
 * 凭据文件：第 1 行 WebUI URL，第 2 行管理员 id，第 3 行密码（只读入进程，不打印、不落盘）。
 * 回环地址（127.0.0.1／localhost）是安全上下文，Clipboard API 恒可用，**没有判定力**——探针会拒绝并报 BLOCKED。
 * 退出码：0＝全部 REAL；1＝存在假成功／静默／诚实失败；2＝环境不满足（BLOCKED）。
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chromium } = createRequire(path.join(repoRoot, "webui", "package.json"))("playwright");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith("--") ? [...acc, [cur.slice(2), all[i + 1]]] : acc), [])
);
const CREDS = args.creds ?? "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
const today = new Date().toISOString().slice(0, 10);
const OUT = path.resolve(repoRoot, args.out ?? `inbox/uat-copy-fake-success-${today}`);

const credLines = readFileSync(CREDS, "utf8").split("\n").map((s) => s.trim());
const credUrl = new URL(credLines[0]);
function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  }
  return null;
}
const BASE = (args.base ?? `${credUrl.protocol}//${lanIp()}:${credUrl.port}`).replace(/\/$/, "");

const SENTINEL = "__lucy_copy_probe_sentinel__";
const SUCCESS_RE = /已复制|复制成功/;
const FAILURE_RE = /复制失败/;
const results = { base: BASE, startedAt: new Date().toISOString(), r0: {}, helper: [], surfaces: [] };

// ── 页面内辅助 ────────────────────────────────────────────────────────────
const INIT_SCRIPT = () => {
  window.__copyCalls = [];
  const orig = document.execCommand.bind(document);
  document.execCommand = (cmd, ...rest) => {
    const ae = document.activeElement;
    const ctrl = ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")
      ? ae.value.substring(ae.selectionStart ?? 0, ae.selectionEnd ?? 0)
      : null;
    const selection = document.getSelection()?.toString() ?? null;
    const ret = orig(cmd, ...rest);
    if (cmd === "copy") window.__copyCalls.push({ ret, selection, ctrl });
    return ret;
  };
};

/** 阳性对照写入：聚焦并选中 textarea 后 execCommand，必须由真实点击触发（用户手势）。 */
async function writeControl(page, text) {
  await page.evaluate((payload) => {
    document.getElementById("__probe_seed")?.remove();
    const b = document.createElement("button");
    b.id = "__probe_seed";
    b.textContent = "seed";
    b.style.cssText = "position:fixed;bottom:0;right:0;z-index:99999";
    b.addEventListener("click", () => {
      const t = document.createElement("textarea");
      t.value = payload;
      t.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(t);
      t.focus();
      t.select();
      t.setSelectionRange(0, t.value.length);
      document.execCommand("copy");
      t.remove();
    });
    document.body.appendChild(b);
  }, text);
  await page.locator("#__probe_seed").click();
  await page.evaluate(() => document.getElementById("__probe_seed")?.remove());
}

async function pasteBack(page) {
  await page.evaluate(() => {
    document.getElementById("__probe_paste")?.remove();
    const t = document.createElement("textarea");
    t.id = "__probe_paste";
    t.style.cssText = "position:fixed;top:0;left:0;width:300px;height:40px;z-index:99999";
    document.body.appendChild(t);
    t.focus();
  });
  await page.keyboard.press("ControlOrMeta+V");
  await page.waitForTimeout(150);
  const value = await page.evaluate(() => document.getElementById("__probe_paste")?.value ?? null);
  await page.evaluate(() => document.getElementById("__probe_paste")?.remove());
  return value;
}

/** 点击后「新出现」的文本行（按行集合差，避免状态文案被替换时计数不变而漏判）。 */
const newLines = (before, after) => {
  const seen = new Set(before.split("\n"));
  return after.split("\n").filter((l) => !seen.has(l));
};
const bodyText = (page) => page.evaluate(() => document.body.innerText);

/**
 * 点击一个复制入口并给出判定。`expected`：string＝剪贴板必须完全等于；function＝自定义校验；缺省＝非空且不是哨兵。
 */
async function clickAndJudge(page, id, label, locator, expected) {
  if (await locator.isDisabled()) return notRun(id, label, "按钮处于禁用态（当前实例没有可复制的数据）");
  await writeControl(page, SENTINEL);
  await page.evaluate(() => { window.__copyCalls = []; });
  const before = await bodyText(page);
  await locator.click();
  await page.waitForTimeout(500);
  const after = await bodyText(page);
  const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
  const calls = await page.evaluate(() => window.__copyCalls);
  const pasted = await pasteBack(page);

  const fresh = newLines(before, after);
  const successShown = fresh.some((l) => SUCCESS_RE.test(l)) || toasts.some((t) => SUCCESS_RE.test(t));
  const failureShown = fresh.some((l) => FAILURE_RE.test(l)) || toasts.some((t) => FAILURE_RE.test(t));
  const notEmpty = typeof pasted === "string" && pasted.length > 0 && pasted !== SENTINEL;
  const clipboardOk = typeof expected === "string" ? pasted === expected : typeof expected === "function" ? notEmpty && expected(pasted) : notEmpty;

  let verdict;
  if (clipboardOk) verdict = successShown || failureShown ? (failureShown && !successShown ? "REAL-BUT-SHOWED-FAILURE" : "REAL") : "REAL-NO-FEEDBACK";
  else if (successShown) verdict = "FAKE-SUCCESS";
  else if (failureShown) verdict = "HONEST-FAILURE";
  else verdict = "SILENT";

  return { id, label, verdict, successShown, failureShown, clipboardOk, toasts, execCommandCalls: calls,
    pasted: pasted === null ? null : pasted.length > 80 ? `${pasted.slice(0, 80)}…(${pasted.length} chars)` : pasted,
    expected: typeof expected === "string" ? expected : expected ? "(custom)" : "(non-empty)" };
}

const notRun = (id, label, reason) => ({ id, label, verdict: "NOT-RUN", reason });

/** 单个入口组失败只记 NOT-RUN，不拖垮整轮；ids 是该组负责的入口。 */
async function group(ids, fn) {
  try {
    await fn();
  } catch (error) {
    const reason = `探针步骤失败：${String(error?.message ?? error).split("\n")[0]}`;
    for (const [id, label] of ids) if (!results.surfaces.some((s) => s.id === id)) results.surfaces.push(notRun(id, label, reason));
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.addInitScript(INIT_SCRIPT);

async function goto(route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

try {
  // UAT-COPY-R0：环境与探针自检
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { adminId: credLines[1], password: credLines[2] } });
  await goto("/admin/version");
  const env = await page.evaluate(() => ({ isSecureContext: window.isSecureContext, hasClipboardApi: typeof navigator.clipboard?.writeText === "function", href: location.href }));
  await writeControl(page, SENTINEL);
  const controlRead = await pasteBack(page);
  const sha = await page.getByTestId("version-info-sha").getAttribute("title").catch(() => null);
  results.r0 = { login: login.status(), ...env, controlSentinelRoundTrip: controlRead === SENTINEL, build: sha ? sha.slice(0, 12) : "unknown" };
  const r0Ok = login.ok() && env.isSecureContext === false && env.hasClipboardApi === false && controlRead === SENTINEL;
  results.r0.verdict = r0Ok ? "PASS" : "BLOCKED";
  if (!r0Ok) throw new Error(`R0 BLOCKED: ${JSON.stringify(results.r0)}`);

  // UAT-COPY-01：已发布 bundle 里的共享 helper，直接真实写入
  const html = await (await fetch(`${BASE}/admin/version`)).text();
  const indexJs = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  const indexSrc = await (await fetch(BASE + indexJs)).text();
  const chunk = indexSrc.match(/clipboard-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!chunk) throw new Error("R0 BLOCKED: 在已发布 bundle 里找不到 clipboard chunk");
  await page.evaluate(async (url) => {
    const mod = await import(url);
    window.__helperFn = Object.values(mod).find((f) => typeof f === "function" && /writeText/.test(f.toString()));
  }, `${BASE}/assets/${chunk}`);
  const helperReady = await page.evaluate(() => typeof window.__helperFn === "function");
  if (!helperReady) throw new Error("R0 BLOCKED: 无法从 bundle 里取出 copyTextToClipboard");
  const payloads = [
    ["ascii-40hex", "c84e6d7d1a5bdc43891fac51159f49dc9b7b2b45"],
    ["cjk-multiline", "表排行\n第二行 中文 | tab\t结尾"],
    ["long-3k", "x".repeat(3000)]
  ];
  for (const [name, payload] of payloads) {
    await writeControl(page, SENTINEL);
    await page.evaluate(({ payload }) => {
      document.getElementById("__probe_helper")?.remove();
      window.__helperResult = null;
      window.__copyCalls = [];
      const b = document.createElement("button");
      b.id = "__probe_helper";
      b.textContent = "helper";
      b.style.cssText = "position:fixed;bottom:0;left:0;z-index:99999";
      b.addEventListener("click", async () => { window.__helperResult = await window.__helperFn(payload); });
      document.body.appendChild(b);
    }, { payload });
    await page.locator("#__probe_helper").click();
    await page.waitForTimeout(300);
    const helperResult = await page.evaluate(() => window.__helperResult);
    const calls = await page.evaluate(() => window.__copyCalls);
    const pasted = await pasteBack(page);
    const reported = helperResult?.ok === true;
    const real = pasted === payload;
    results.helper.push({
      id: `helper:${name}`, helperResult, execCommandCalls: calls,
      pasted: pasted === null ? null : pasted.length > 60 ? `${pasted.slice(0, 60)}…(${pasted.length} chars)` : pasted,
      verdict: real ? "REAL" : reported ? "FAKE-SUCCESS" : "HONEST-FAILURE"
    });
    await page.evaluate(() => document.getElementById("__probe_helper")?.remove());
  }

  // UAT-COPY-02：各入口点击探针
  // 版本信息
  const V = [["version-sha", "版本信息：复制构建提交"]];
  await group(V, async () => {
    await goto("/admin/version");
    const fullSha = await page.getByTestId("version-info-sha").getAttribute("title");
    results.surfaces.push(fullSha
      ? await clickAndJudge(page, V[0][0], V[0][1], page.getByTestId("version-info-copy"), fullSha)
      : notRun(V[0][0], V[0][1], "构建提交不是 40 位 hex，页面不提供复制按钮"));
  });

  // 新建 Token（POST 打桩，不写真实凭据）与 Agent hash
  const agentsResp = await context.request.get(`${BASE}/api/admin/agents`);
  const agents = (await agentsResp.json()).data?.agents ?? [];
  const agent = agents.find((a) => (a.tokens ?? []).length > 0) ?? agents[0];
  const NT = [["new-token-plaintext", "新建 Token：复制 Token 明文"], ["new-token-snippet", "新建 Token：复制当前配置"]];
  const AH = [["agent-token-hash", "Agent 详情：复制 Token hash"]];
  if (!agent) {
    for (const [id, label] of [...NT, ...AH]) results.surfaces.push(notRun(id, label, "实例里没有 Agent"));
  } else {
    await group(NT, async () => {
      const STUB_TOKEN = "lucy_copy_probe_stub_token";
      await page.route("**/api/admin/agents/*/tokens", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { token: STUB_TOKEN, hash: "sha256:probe", label: "copy-probe", created: "2026-01-01T00:00:00.000Z", expires_at: "2027-01-01T23:59:59.999Z" } }) });
      });
      try {
        await goto(`/admin/agents/${encodeURIComponent(agent.id)}/tokens/new`);
        await page.getByLabel("Token 标签").fill("copy-probe");
        await page.getByRole("button", { name: "生成 Token" }).click();
        await page.getByTestId("snippet-active").waitFor({ timeout: 15000 });
        results.surfaces.push(await clickAndJudge(page, NT[0][0], NT[0][1], page.getByRole("button", { name: "复制 token 明文" }), STUB_TOKEN));
        results.surfaces.push(await clickAndJudge(page, NT[1][0], NT[1][1], page.getByRole("button", { name: /复制当前配置/ }), (v) => v.includes(`Bearer ${STUB_TOKEN}`)));
      } finally {
        await page.unroute("**/api/admin/agents/*/tokens");
      }
    });

    const token = (agent.tokens ?? [])[0];
    if (!token) results.surfaces.push(notRun(AH[0][0], AH[0][1], `Agent ${agent.id} 没有 Token`));
    else await group(AH, async () => {
      await goto(`/admin/agents/${encodeURIComponent(agent.id)}`);
      await page.locator("[role=tab], button").filter({ hasText: /^Token$/ }).first().click();
      await page.getByText("安全信息 / 技术详情").first().click();
      results.surfaces.push(await clickAndJudge(page, AH[0][0], AH[0][1], page.getByRole("button", { name: /的 hash$/ }).first(), token.hash));
    });
  }

  // 审计对账
  const RC = [["reconciliation-ranking", "审计对账：复制表排行全文"]];
  await group(RC, async () => {
    await goto("/admin/audit-reconciliation");
    const recon = page.getByTestId("reconciliation-table-copy");
    results.surfaces.push(await recon.waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
      ? await clickAndJudge(page, RC[0][0], RC[0][1], recon)
      : notRun(RC[0][0], RC[0][1], "复制按钮未出现"));
  });

  // 概览 MCP 配置
  const MC = [["onboarding-mcp-config", "接入向导／概览：复制 MCP 配置"]];
  await group(MC, async () => {
    await goto("/overview");
    const mcp = page.getByTestId("mcp-config-copy-button");
    results.surfaces.push(await mcp.waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
      ? await clickAndJudge(page, MC[0][0], MC[0][1], mcp, (v) => /mcp/i.test(v))
      : notRun(MC[0][0], MC[0][1], "复制按钮未出现"));
  });

  // 连接测试（真跑 ktx connection test，只读）
  const CT = [["connection-test-command", "连接测试：复制命令"], ["connection-test-log", "连接测试：复制 Log"]];
  await group(CT, async () => {
    await goto("/connections/test");
    const rerun = page.getByTestId("rerun-connection-test");
    if (!(await rerun.waitFor({ timeout: 10000 }).then(() => true).catch(() => false))) {
      for (const [id, label] of CT) results.surfaces.push(notRun(id, label, "没有可测试的连接"));
      return;
    }
    await rerun.click();
    const cmdEl = page.getByTestId("connection-test-command");
    if (!(await cmdEl.waitFor({ timeout: 120000 }).then(() => true).catch(() => false))) {
      for (const [id, label] of CT) results.surfaces.push(notRun(id, label, "120 秒内没有测试结果面板"));
      return;
    }
    const cmd = (await cmdEl.innerText()).trim();
    results.surfaces.push(await clickAndJudge(page, CT[0][0], CT[0][1], page.getByRole("button", { name: "复制命令" }), cmd));
    results.surfaces.push(await clickAndJudge(page, CT[1][0], CT[1][1], page.getByRole("button", { name: "复制 Log" })));
  });
} catch (error) {
  results.error = String(error?.message ?? error);
} finally {
  await browser.close();
}

// ── 登记表对照：未点击的入口列出原因 ─────────────────────────────────────
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "webui/scripts/copy-surfaces.manifest.json"), "utf8"));
const clicked = new Set(results.surfaces.map((s) => s.id));
results.manifestCoverage = Object.entries(manifest.files).flatMap(([file, entry]) =>
  entry.surfaces.map((s) => ({ file, id: s.id, label: s.label, declared: s.coverage, probed: clicked.has(s.id), reason: s.reason ?? null }))
);
for (const row of results.manifestCoverage) {
  if (row.declared === "click" && !row.probed) row.problem = "登记为 click 但本次探针没有执行";
}

const bad = (v) => ["FAKE-SUCCESS", "SILENT", "HONEST-FAILURE", "REAL-BUT-SHOWED-FAILURE"].includes(v);
const helperBad = results.helper.some((h) => h.verdict !== "REAL");
const surfaceBad = results.surfaces.some((s) => bad(s.verdict));
const notRunClick = results.manifestCoverage.some((r) => r.problem);
results.verdict = results.error ? "BLOCKED" : helperBad || surfaceBad ? "FAIL" : notRunClick || results.surfaces.some((s) => s.verdict === "NOT-RUN") ? "PASS WITH GAP" : "PASS";
results.finishedAt = new Date().toISOString();

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "probe-result.json"), JSON.stringify(results, null, 2));

const lines = [];
lines.push(`# 复制按钮假成功探针结果（${results.finishedAt}）`, "", `- 被测实例：\`${BASE}\`（构建 \`${results.r0.build ?? "?"}\`）`, `- R0：${results.r0.verdict ?? "未执行"}（isSecureContext=${results.r0.isSecureContext}，Clipboard API=${results.r0.hasClipboardApi}，阳性对照往返=${results.r0.controlSentinelRoundTrip}）`, `- 总判定：**${results.verdict}**${results.error ? `（${results.error}）` : ""}`, "", "## UAT-COPY-01 共享 helper", "", "| 载荷 | helper 自报 | execCommand 调用 | 粘贴读回 | 判定 |", "|---|---|---|---|---|");
for (const h of results.helper) lines.push(`| ${h.id} | ${JSON.stringify(h.helperResult)} | ${JSON.stringify(h.execCommandCalls)} | ${JSON.stringify(h.pasted)} | **${h.verdict}** |`);
lines.push("", "## UAT-COPY-02 入口点击", "", "| 入口 | 界面说已复制 | 界面说失败 | 剪贴板确有内容 | 判定 |", "|---|---|---|---|---|");
for (const s of results.surfaces) lines.push(s.verdict === "NOT-RUN" ? `| ${s.label} | — | — | — | NOT-RUN（${s.reason}） |` : `| ${s.label} | ${s.successShown} | ${s.failureShown} | ${s.clipboardOk} | **${s.verdict}** |`);
lines.push("", "## 登记表对照（全部复制入口）", "", "| 文件 | 入口 | 登记覆盖 | 本次点击 | 未点击原因 |", "|---|---|---|---|---|");
for (const r of results.manifestCoverage) lines.push(`| ${r.file} | ${r.label} | ${r.declared} | ${r.probed ? "是" : "否"} | ${r.problem ?? r.reason ?? ""} |`);
writeFileSync(path.join(OUT, "probe-result.md"), lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`\n证据：${path.relative(repoRoot, OUT)}/probe-result.{json,md}`);
process.exit(results.verdict === "BLOCKED" ? 2 : results.verdict === "FAIL" ? 1 : 0);
