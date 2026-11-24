// UAT foreground browser timing — Roles/Agents primaryReady + DOM scale probe.
// Protocol aligned with runs/2026-11-20-cursor-roles-agents-browser-timing.md:
//   logged-in SPA, sidebar click navigation, performance.now() delta until the
//   largest table reaches a row floor. Per round: DOM node count + render-phase longtasks.
// Foreground headed Chromium by default (HEADLESS=1 to override).
// Secrets via env only. Usage:
//   LUCY_WEBUI=... LUCY_ADMIN_ID=... LUCY_ADMIN_PASSWORD=... node scripts/uat/racs-browser-dom-probe.mjs \
//     --roles-floor 200 --agents-floor 100 --rounds 3 --out <abs path>.json
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

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const OUT = process.argv.includes("--out")
  ? resolve(process.argv[process.argv.indexOf("--out") + 1])
  : resolve("inbox/uat-racs-dbl-2026-11-20/browser-timing.json");
const ROUNDS = arg("rounds", 3);
const ROLES_FLOOR = arg("roles-floor", 200);
const AGENTS_FLOOR = arg("agents-floor", 100);
const HEADLESS = process.env.HEADLESS === "1";
const CHANNEL = process.env.CHANNEL || null; // e.g. "chrome" to use system Chrome

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click();
      return sel;
    }
  }
  throw new Error(`no nav link among ${selectors.join(", ")}`);
}

async function measure(page, navSelectors, floor, rounds, label) {
  const results = [];
  for (let round = 1; round <= rounds + 1; round++) {
    // arm longtask collector before the click so render-phase tasks are captured
    await page.evaluate(() => {
      window.__lt = [];
      window.__ltpo?.disconnect();
      window.__ltpo = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push(Math.round(e.duration));
      });
      window.__ltpo.observe({ entryTypes: ["longtask"] });
    });
    const t0 = await page.evaluate(() => performance.now());
    await clickFirst(page, navSelectors);
    const rows = await page
      .waitForFunction(
        (min) => {
          const tables = [...document.querySelectorAll("table")];
          const best = Math.max(0, ...tables.map((t) => t.querySelectorAll("tbody tr").length));
          return best >= min ? best : false;
        },
        floor,
        { timeout: 60000 }
      )
      .then((h) => h.jsonValue())
      .catch(() => -1);
    const t1 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(400); // let post-render longtasks land
    const stats = await page.evaluate(() => {
      window.__ltpo?.disconnect();
      const lt = window.__lt || [];
      return {
        dom: document.getElementsByTagName("*").length,
        visibility: document.visibilityState,
        hidden: document.hidden,
        longtasks: { count: lt.length, totalMs: lt.reduce((a, b) => a + b, 0), samples: lt.slice(0, 10) },
        url: location.pathname
      };
    });
    results.push({
      round,
      kind: round === 1 ? "colder" : "spa",
      page: label,
      primaryReadyMs: rows === -1 ? null : Math.round((t1 - t0) * 10) / 10,
      rows,
      ...stats
    });
    // back to overview so the next click is a genuine SPA transition
    await clickFirst(page, ['a[href*="/overview"]']).catch(() => page.goto(`${WEB}/admin/governance/overview`));
    await page.waitForTimeout(400);
  }
  return results;
}

async function apiBaseline(page) {
  const routes = ["/api/admin/roles", "/api/admin/agents?view=roster", "/api/admin/agents?range=7d", "/api/admin/agents/statistics?range=7d"];
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
  const browser = await chromium.launch({ headless: HEADLESS, ...(CHANNEL ? { channel: CHANNEL } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror:${String(e).slice(0, 160)}`));

  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input", { timeout: 15000 });
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.locator("form input").first().fill(ADMIN_ID);
  await page.click('button:has-text("登录")');
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  await page.waitForTimeout(800);

  const overviewClicked = await clickFirst(page, ['a[href*="/overview"]']).catch(() => null);
  if (!overviewClicked) await page.goto(`${WEB}/admin/governance/overview`);
  await page.waitForTimeout(500);

  const roles = await measure(page, ['a[href="/admin/roles"]'], ROLES_FLOOR, ROUNDS, "roles");
  const agents = await measure(page, ['a[href="/admin/agents"]'], AGENTS_FLOOR, ROUNDS, "agents");
  const api = await apiBaseline(page);

  const report = {
    at: new Date().toISOString(),
    web: WEB,
    headless: HEADLESS,
    viewport: { w: 1920, h: 1080 },
    protocol: "sidebar SPA click -> largest-table tbody rows >= floor -> performance.now() delta; longtasks armed pre-click",
    floors: { roles: ROLES_FLOOR, agents: AGENTS_FLOOR },
    roles,
    agents,
    api,
    consoleErrors: consoleErrors.slice(0, 20)
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ out: OUT, roles, agents, api, consoleErrors: consoleErrors.length }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
