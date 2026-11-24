#!/usr/bin/env -S npx tsx
/**
 * UAT-SUITE-PAGE-OPEN 探针（错题 2026-11-18-audit-calls-render-crash-misreported）。
 *
 * 目的：在真实 Chromium 里，对每个侧栏二级入口与其页签，回答一件事——页面能不能正常打开：
 *   - 没有未捕获的 pageerror（渲染崩溃）；
 *   - 没有路由兜底边界（route-chunk-error／route-render-error）；
 *   - 页面有标题（h1 或页头）或正文，不是空白；
 *   - 页面自身的 /api 请求没有 5xx。
 * 页签逐个点击后重复上述判定。
 *
 * 用法（仓库根，需先 `npm run demo:upgrade` 或确认 demo 在线）：
 *   npx tsx scripts/uat/page-open-probe.mts [--creds <凭据文件>] [--base <url>] [--out <dir>]
 *   npx tsx scripts/uat/page-open-probe.mts --selfcheck     # 只跑判定器自检，不登录
 *
 * 凭据文件：第 1 行 WebUI URL，第 2 行管理员 id，第 3 行密码（只读入进程，不打印、不落盘）。
 * 退出码：0＝全部页面与页签通过；1＝存在 FAIL；2＝环境不满足（BLOCKED，登录失败）。
 */

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { navGroups } from "../../webui/src/app/navigation.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type PageFacts = {
  route: string;
  tab: string | null;
  pageErrors: string[];
  consoleErrors: string[];
  api5xx: string[];
  chunkBoundary: number;
  renderBoundary: number;
  hasHeading: boolean;
  mainTextLength: number;
  boundaryKind?: string | null;
};

export type Verdict = { verdict: "PASS" | "FAIL"; reasons: string[] };

/** 纯判定器：只看 facts，不碰浏览器。自检与探针共用同一套规则。 */
export function classify(f: PageFacts): Verdict {
  const reasons: string[] = [];
  for (const e of f.pageErrors) reasons.push(`pageerror: ${e.slice(0, 160)}`);
  if (f.renderBoundary > 0) reasons.push(`route-render-error（错误类别 ${f.boundaryKind ?? "?"}）`);
  if (f.chunkBoundary > 0) reasons.push("route-chunk-error（页面资源加载失败）");
  for (const u of f.api5xx) reasons.push(`5xx: ${u}`);
  if (!f.hasHeading && f.mainTextLength < 20) reasons.push("页面空白：无标题也无正文");
  return { verdict: reasons.length ? "FAIL" : "PASS", reasons };
}

function selfcheck(): number {
  const clean: PageFacts = {
    route: "/x", tab: null, pageErrors: [], consoleErrors: [], api5xx: [],
    chunkBoundary: 0, renderBoundary: 0, hasHeading: true, mainTextLength: 200
  };
  const crash: PageFacts = {
    ...clean, pageErrors: ["Cannot read properties of undefined (reading 'startsWith')"],
    renderBoundary: 1, boundaryKind: "TypeError"
  };
  const chunk: PageFacts = { ...clean, chunkBoundary: 1 };
  const blank: PageFacts = { ...clean, hasHeading: false, mainTextLength: 0 };
  const checks: Array<[string, Verdict, "PASS" | "FAIL"]> = [
    ["干净页面判 PASS", classify(clean), "PASS"],
    ["渲染崩溃判 FAIL（即本次错题的形态）", classify(crash), "FAIL"],
    ["chunk 加载失败判 FAIL", classify(chunk), "FAIL"],
    ["空白页判 FAIL", classify(blank), "FAIL"]
  ];
  let bad = 0;
  for (const [name, got, want] of checks) {
    const ok = got.verdict === want;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "BAD "} ${name} -> ${got.verdict}`);
  }
  return bad ? 1 : 0;
}

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) out[argv[i].slice(2)] = argv[++i];
    else if (argv[i].startsWith("--")) out[argv[i].slice(2)] = "1";
  }
  return out;
}

/** 侧栏二级入口的 to 路径，去重；另加手册页 /help（不在侧栏）。 */
export function sidebarRoutes(): string[] {
  const set = new Set<string>(["/help"]);
  for (const group of navGroups) for (const item of group.items) set.add(item.to);
  return [...set];
}

async function main(): Promise<number> {
  if (process.argv.includes("--selfcheck")) return selfcheck();

  const a = args();
  const CREDS = a.creds ?? "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
  const today = new Date().toISOString().slice(0, 10);
  const OUT = path.resolve(repoRoot, a.out ?? `inbox/uat-page-open-${today}`);
  const lines = readFileSync(CREDS, "utf8").split("\n").map((s) => s.trim());
  const BASE = (a.base ?? lines[0]).replace(/\/$/, "");
  const [adminId, password] = [lines[1], lines[2]];

  const require = createRequire(path.join(repoRoot, "webui", "package.json"));
  const { chromium } = require("playwright") as typeof import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const api5xx: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) api5xx.push(`${r.status()} ${r.url().replace(BASE, "")}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByPlaceholder("例：lucy").fill(adminId);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(2500);
  const loggedIn = await page.evaluate(async () => {
    const r = await fetch("/api/auth/status", { credentials: "include" });
    const j = await r.json();
    return Boolean(j?.data?.me);
  });
  if (!loggedIn) {
    console.error("BLOCKED：管理员登录失败，未执行页面检查。");
    await browser.close();
    return 2;
  }

  const routes = sidebarRoutes();
  const results: Array<PageFacts & Verdict> = [];

  async function observe(route: string, tab: string | null) {
    await page.waitForTimeout(1500);
    const dom = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      return {
        chunkBoundary: document.querySelectorAll('[data-testid="route-chunk-error"]').length,
        renderBoundary: document.querySelectorAll('[data-testid="route-render-error"]').length,
        boundaryKind: document.querySelector('[data-testid="route-render-error-kind"]')?.textContent ?? null,
        hasHeading: Boolean(document.querySelector("h1, .pl-page-header")),
        mainTextLength: (main.textContent ?? "").replace(/\s+/g, "").length
      };
    });
    const facts: PageFacts = {
      route, tab,
      pageErrors: pageErrors.splice(0),
      consoleErrors: consoleErrors.splice(0),
      api5xx: api5xx.splice(0),
      ...dom
    };
    results.push({ ...facts, ...classify(facts) });
  }

  for (const route of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await observe(route, null);
      const tabCount = await page.locator("main [role='tab'], main .pl-segmented-control-item").count();
      for (let i = 0; i < Math.min(tabCount, 6); i++) {
        const tab = page.locator("main [role='tab'], main .pl-segmented-control-item").nth(i);
        const label = (await tab.innerText().catch(() => `tab-${i}`)).trim().slice(0, 40) || `tab-${i}`;
        await tab.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await observe(route, label);
      }
    } catch (e) {
      results.push({
        route, tab: null, pageErrors: [String(e)], consoleErrors: [], api5xx: [],
        chunkBoundary: 0, renderBoundary: 0, hasHeading: false, mainTextLength: 0,
        verdict: "FAIL", reasons: [`导航异常：${String(e).slice(0, 160)}`]
      });
    }
  }
  await browser.close();

  mkdirSync(OUT, { recursive: true });
  const fails = results.filter((r) => r.verdict === "FAIL");
  writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ base: BASE, total: results.length, failCount: fails.length, results }, null, 2));
  const md = [
    `# UAT-SUITE-PAGE-OPEN 跑次（${today}）`,
    "",
    `- 总检查点：${results.length}；FAIL：${fails.length}`,
    "",
    "| 路由 | 页签 | 判定 | 原因 |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.route} | ${r.tab ?? "—"} | ${r.verdict} | ${r.reasons.join("；") || "—"} |`)
  ].join("\n");
  writeFileSync(path.join(OUT, "summary.md"), md + "\n");
  console.log(`检查点 ${results.length}，FAIL ${fails.length}；证据：${path.relative(repoRoot, OUT)}`);
  for (const f of fails) console.log(`FAIL ${f.route} [${f.tab ?? "页面"}] ${f.reasons.join("；")}`);
  return fails.length ? 1 : 0;
}

const code = await main();
process.exit(code);
