// UAT-PDS generalized foreground page probe.
// Protocol (same as RACS validated runs): system Chrome headed, 1920x1080,
// sidebar SPA click -> per-page readyExpr truthy -> performance.now() delta.
// longtasks armed pre-click; per-round visibilityState must be "visible".
// API baseline sampled in-page via fetch, reported separately.
// Secrets via env only. Usage:
//   LUCY_ADMIN_ID=.. LUCY_ADMIN_PASSWORD=.. node scripts/uat/page-dom-probe.mjs \
//     --pages tokens,calls,publish,evalruns,whitelist,accessmap --rounds 3 --out <abs.json>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require2 = createRequire(new URL("../../webui/package.json", import.meta.url));
const { chromium } = require2("playwright");

const WEB = process.env.LUCY_WEBUI || "http://127.0.0.1:55176";
const ADMIN_ID = process.env.LUCY_ADMIN_ID;
const ADMIN_PASSWORD = process.env.LUCY_ADMIN_PASSWORD;
if (!ADMIN_ID || !ADMIN_PASSWORD) throw new Error("LUCY_ADMIN_ID/LUCY_ADMIN_PASSWORD required");

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = argv.includes("--out") ? resolve(opt("out", "")) : resolve("inbox/uat-pds/page-probe.json");
const ROUNDS = Number(opt("rounds", 3));
const HEADLESS = process.env.HEADLESS === "1";
const CHANNEL = process.env.CHANNEL || "chrome";

// Page manifest. readyFn evaluated in page via page.evaluate (real function serialization).
const rowExpr = (floor) =>
  new Function(`return Math.max(0, ...[...document.querySelectorAll("table")].map((t) => t.querySelectorAll("tbody tr").length)) >= ${floor};`);
const domReady = (extra = "true") =>
  new Function(`return document.readyState === "complete" && (${extra});`);

const PAGES = {
  tokens: {
    label: "Token 凭据", nav: 'a[href="/admin/tokens"]', url: "/admin/tokens",
    readyFn: rowExpr(5), floor: 5, api: ["/api/admin/tokens"]
  },
  calls: {
    label: "调用监控", nav: 'a[href="/ops/calls"]', url: "/ops/calls",
    readyFn: rowExpr(4), floor: 4, api: ["/api/admin/audit?range=7d&page=1&pageSize=10"]
  },
  publish: {
    label: "发布记录", nav: 'a[href="/publish/history"]', url: "/publish/history",
    readyFn: domReady(`(document.body.innerText.includes("发布") || !!document.querySelector("table, [role=table], .card"))`),
    floor: 0, api: ["/api/semantic-assets/releases?limit=10"]
  },
  evalruns: {
    label: "评测运行历史", nav: 'a[href="/eval/runs"]', url: "/eval/runs",
    readyFn: domReady(`(!!document.querySelector("table, [role=table]") || document.body.innerText.length > 200)`),
    floor: 0, api: ["/api/eval/runs?limit=10"]
  },
  whitelist: {
    label: "启用表范围", nav: 'a[href="/connections/enabled-tables"]', url: "/connections/enabled-tables",
    readyFn: rowExpr(8), floor: 8, api: []
  },
  accessmap: {
    label: "访问关系图", nav: 'a[href="/admin/access-map"]', url: "/admin/access-map",
    readyFn: new Function(`return document.querySelectorAll("svg, canvas").length > 0;`),
    floor: 0, api: ["/api/admin/access-map"]
  },
  connections: {
    label: "连接概览", nav: 'a[href="/connections"]', url: "/connections",
    readyFn: domReady(`!!document.querySelector("table, .card")`),
    floor: 0, api: ["/api/catalog/connections"]
  },
  wiki: { label: "业务 Wiki", nav: 'a[href="/wiki"]', url: "/wiki", readyFn: domReady(), floor: 0, api: [] },
  skills: { label: "业务 Skill", nav: 'a[href="/skills"]', url: "/skills", readyFn: domReady(), floor: 0, api: [] },
  accounts: { label: "AdminAccounts", nav: 'a[href="/admin/accounts"]', url: "/admin/accounts", readyFn: domReady(), floor: 0, api: [] },
  configaudit: {
    label: "ConfigAudit", nav: 'a[href="/admin/config-audit"]', url: "/admin/config-audit",
    readyFn: domReady(), floor: 0, api: ["/api/admin/config-audit?page=1&pageSize=10"]
  },
  usage: {
    label: "使用概况", nav: 'a[href="/admin/usage"]', url: "/admin/usage",
    readyFn: domReady(`!!document.querySelector("table, .card, [class*=metric]")`),
    floor: 0, api: ["/api/admin/ui-usage/overview?hours=168"]
  },
  workbench: { label: "发布工作台", nav: 'a[href="/publish/workbench"]', url: "/publish/workbench", readyFn: domReady(), floor: 0, api: [] },
  evalcases: {
    label: "评测用例", nav: 'a[href="/eval/cases"]', url: "/eval/cases",
    readyFn: domReady(), floor: 0, api: ["/api/eval/domains"]
  }
};

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.click();
      return sel;
    }
  }
  return null;
}

async function measure(page, key, cfg, rounds) {
  const results = [];
  for (let round = 1; round <= rounds + 1; round++) {
    await page.evaluate(() => {
      window.__lt = [];
      window.__ltpo?.disconnect();
      window.__ltpo = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push(Math.round(e.duration));
      });
      window.__ltpo.observe({ entryTypes: ["longtask"] });
    });
    const t0 = await page.evaluate(() => performance.now());
    const clicked = await clickFirst(page, [cfg.nav]);
    if (!clicked) {
      await page.goto(`${WEB}${cfg.url}`);
    }
    let ok = false;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      ok = await page.evaluate(cfg.readyFn).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(120);
    }
    const t1 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(400);
    const stats = await page.evaluate(() => {
      window.__ltpo?.disconnect();
      const lt = window.__lt || [];
      const tables = [...document.querySelectorAll("table")];
      return {
        dom: document.getElementsByTagName("*").length,
        rows: Math.max(0, ...tables.map((t) => t.querySelectorAll("tbody tr").length)),
        visibility: document.visibilityState,
        hidden: document.hidden,
        url: location.pathname,
        longtasks: { count: lt.length, totalMs: lt.reduce((a, b) => a + b, 0), samples: lt.slice(0, 10) }
      };
    });
    results.push({
      round, kind: round === 1 ? "colder" : "spa",
      primaryReadyMs: ok ? Math.round((t1 - t0) * 10) / 10 : null,
      ready: ok, ...stats
    });
    await clickFirst(page, ['a[href*="/overview"]']);
    await page.waitForTimeout(400);
  }
  return results;
}

async function apiBaseline(page, routes) {
  const out = {};
  for (const r of routes) {
    const xs = [];
    for (let i = 0; i < 3; i++) {
      const ms = await page.evaluate(async (p) => {
        const t = performance.now();
        const resp = await fetch(p, { credentials: "same-origin" });
        await resp.json();
        return Math.round(performance.now() - t);
      }, r);
      xs.push(ms);
    }
    xs.sort((a, b) => a - b);
    out[r] = { p50: xs[1], min: xs[0], max: xs[2] };
  }
  return out;
}

(async () => {
  mkdirSync(dirname(OUT), { recursive: true });
  const wanted = opt("pages", "tokens,calls,publish,evalruns,whitelist,accessmap").split(",").map((s) => s.trim()).filter(Boolean);
  const browser = await chromium.launch({ headless: HEADLESS, channel: CHANNEL });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${m.text().slice(0, 140)}`));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror:${String(e).slice(0, 140)}`));

  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input", { timeout: 15000 });
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.locator("form input").first().fill(ADMIN_ID);
  await page.click('button:has-text("登录")');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(800);

  const report = { at: new Date().toISOString(), web: WEB, headless: HEADLESS, channel: CHANNEL, viewport: { w: 1920, h: 1080 }, protocol: "SPA sidebar click -> readyExpr -> performance.now(); longtasks pre-armed", rounds: ROUNDS, pages: {}, api: {}, consoleErrors: [] };

  for (const key of wanted) {
    const cfg = PAGES[key];
    if (!cfg) continue;
    await clickFirst(page, ['a[href*="/overview"]']);
    await page.waitForTimeout(400);
    report.pages[key] = await measure(page, key, cfg, ROUNDS);
    if (cfg.api?.length) report.api[key] = await apiBaseline(page, cfg.api);
  }
  report.consoleErrors = consoleErrors.slice(0, 30);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ out: OUT, pages: Object.fromEntries(Object.entries(report.pages).map(([k, v]) => [k, v.map((r) => `${r.kind}:${r.primaryReadyMs}ms rows=${r.rows} dom=${r.dom} lt=${r.longtasks.count}`)])), consoleErrors: consoleErrors.length }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
