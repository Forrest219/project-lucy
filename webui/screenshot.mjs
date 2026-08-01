// One-off screenshot script for Lucy WebUI sidebar IA review.
// Run from webui/ so it picks up the local @playwright/test install.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:5173";
const OUT_DIR = "/Users/zhangxingchen/Projects/project-lucy/inbox/lucy-screenshots";

const TARGETS = [
  { slug: "01-system-overview",           title: "系统概览（置顶）",          path: "/onboarding" },
  { slug: "02-data-access-connections",   title: "数据接入 / 连接概览",       path: "/connections" },
  { slug: "03-data-access-whitelist",     title: "数据接入 / 启用表范围",     path: "/connections/whitelist" },
  { slug: "04-data-access-conn-test",     title: "数据接入 / 连通测试（兼容）",path: "/connections/test" },
  { slug: "05-semantic-modeling-catalog", title: "语义建模 / 表目录",         path: "/" },
  { slug: "06-semantic-modeling-wiki",    title: "语义建模 / 业务 Wiki",      path: "/wiki" },
  { slug: "07-semantic-publish-workbench",title: "语义发布 / 发布工作台",     path: "/publish/workbench" },
  { slug: "08-semantic-publish-history",  title: "语义发布 / 发布记录",       path: "/publish/history" },
  { slug: "09-eval-cases",                title: "质量评测 / 评测用例",       path: "/eval/cases" },
  { slug: "10-eval-runs",                 title: "质量评测 / 运行历史",       path: "/eval/runs" },
  { slug: "11-eval-monitor",              title: "质量评测 / 趋势监控",       path: "/eval/monitor" },
  { slug: "12-admin-agents",              title: "访问治理 / Agent 实例",     path: "/admin/agents" },
  { slug: "13-admin-roles",               title: "访问治理 / 角色权限",       path: "/admin/roles" },
  { slug: "14-admin-audit-log",           title: "访问治理 / 访问日志（log）",path: "/admin/audit" },
  { slug: "15-admin-audit-heatmap",       title: "访问治理 / 访问日志（heatmap）", path: "/admin/audit?tab=heatmap" },
  { slug: "16-admin-config-audit",        title: "访问治理 / 配置审计",       path: "/admin/config-audit" }
];

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai"
});
const page = await context.newPage();

let failed = 0;
for (const target of TARGETS) {
  const url = `${BASE}${target.path}`;
  const file = `${OUT_DIR}/${target.slug}.png`;
  process.stdout.write(`[${target.slug}] ${target.title.padEnd(34, " ")} ${url}  ... `);
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const status = resp ? resp.status() : "n/a";
    // wait for sidebar to render and main content to settle
    await page.waitForSelector("nav[aria-label='主导航'], .pl-sidebar", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`OK (HTTP ${status}) -> ${file}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${err.message}`);
  }
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
