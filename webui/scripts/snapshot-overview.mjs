#!/usr/bin/env node
// scripts/snapshot-overview.mjs
// 用法:node scripts/snapshot-overview.mjs [url] [out]
// 默认:node scripts/snapshot-overview.mjs http://127.0.0.1:55176/overview /tmp/lucy-overview-snapshot.png

import { chromium } from "@playwright/test";
import path from "node:path";
import process from "node:process";

const url = process.argv[2] ?? "http://127.0.0.1:55176/overview";
const out = process.argv[3] ?? "/tmp/lucy-overview-snapshot.png";

const startedAt = Date.now();

async function main() {
  console.log(`[snapshot-overview] url=${url} out=${out}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => {
      console.warn(`[snapshot-overview] pageerror: ${err.message}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.warn(`[snapshot-overview] console.error: ${msg.text()}`);
      }
    });

    // 视口内 console 也捕获(可选)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    // SPA 渲染 + 数据 fetch + chart/svg 完成 — 给点时间
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    await page.screenshot({ path: out, fullPage: true });
    console.log(`[snapshot-overview] OK wrote ${out} (${Date.now() - startedAt}ms)`);
  } finally {
    await browser.close();
  }
}

try {
  await main();
  process.exit(0);
} catch (err) {
  console.error(`[snapshot-overview] FAIL: ${err.message}`);
  process.exit(1);
}
