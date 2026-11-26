#!/usr/bin/env node
/**
 * P1-84 — 真实前台 Chromium 冷开 `GET /`（UAT-PES-02，Spec §3.5 primaryReady）。
 *
 * primaryReady ＝ 登录表单（#login-password）可见且可操作 ＋ 当次 HTML 引用的
 * 首屏 JS／CSS 全部完成（OQ-3：hash 随构建变化，以当次 HTML 再核）。
 * 计时：导航发起 → TTFB（响应头）→ primaryReady；与同窗 API 探测分列。
 * 有头前台（headless: false）；每次冷开用全新 context（无缓存 cookie／disk cache）。
 * 账本：JSONL 追加到 --out；判定只读账本。
 */
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[a.slice(2)] = true;
      else { args[a.slice(2)] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.url ?? "http://127.0.0.1:55176";
  const count = Number(args.count ?? 10);
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  mkdirSync(outDir, { recursive: true });
  const ledgerPath = path.join(outDir, "browser-cold.jsonl");
  console.log(`[browser-cold] ${base} count=${count} headed chromium → ${ledgerPath}`);

  const executablePath = process.env.PES_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({
    headless: false,
    channel: executablePath ? undefined : "chrome",
    executablePath,
    args: ["--window-size=1920,1080", "--window-position=0,0"]
  });
  try {
    for (let i = 1; i <= count; i++) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      const assetTimings = new Map();
      page.on("requestfinished", (request) => {
        const url = new URL(request.url());
        if (url.origin === base && url.pathname.startsWith("/assets/")) {
          assetTimings.set(url.pathname, Date.now());
        }
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        if (url.origin === base && url.pathname.startsWith("/assets/")) {
          assetTimings.set(url.pathname, -1);
        }
      });
      const navStart = Date.now();
      let ttfbMs = null;
      let httpStatus = null;
      let docBytes = 0;
      try {
        const response = await page.goto(`${base}/`, { waitUntil: "commit", timeout: 20_000 });
        ttfbMs = Date.now() - navStart;
        httpStatus = response?.status() ?? null;
        await page.waitForLoadState("load", { timeout: 20_000 });
        docBytes = (await page.content()).length;
      } catch (error) {
        appendFileSync(ledgerPath, JSON.stringify({ schema: "pes-ledger/1", kind: "browser-cold", tick: i, error: String(error?.message ?? error), ts: Date.now() }) + "\n");
        await context.close();
        continue;
      }
      // 首屏资产清单来自当次 HTML（OQ-3）。
      const assetPaths = [...new Set([...(await page.content()).matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
      let formReady = false;
      try {
        const form = page.locator("#login-password");
        await form.waitFor({ state: "visible", timeout: 10_000 });
        formReady = await form.isEnabled();
      } catch { /* 保持 false，如实记录 */ }
      let primaryReadyMs = null;
      if (formReady) {
        const pending = assetPaths.filter((p) => !assetTimings.has(p) || assetTimings.get(p) < 0);
        if (pending.length === 0) {
          primaryReadyMs = Math.max(Date.now() - navStart, ...assetPaths.map((p) => assetTimings.get(p) - navStart));
        }
      }
      appendFileSync(ledgerPath, JSON.stringify({
        schema: "pes-ledger/1",
        kind: "browser-cold",
        tick: i,
        path: "/",
        method: "GET",
        status: httpStatus,
        ttfbMs,
        totalMs: primaryReadyMs ?? null,
        primaryReady: formReady && primaryReadyMs != null,
        formReady,
        docBytes,
        assets: assetPaths.length,
        ts: Date.now()
      }) + "\n");
      console.log(`[browser-cold] #${i} ttfb=${ttfbMs}ms primaryReady=${primaryReadyMs ?? "FAIL"}ms assets=${assetPaths.length}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[browser-cold] 失败：", error);
  process.exit(1);
});
