#!/usr/bin/env node
/**
 * Spider2-lite Pilot — browser SOP walk (E2E-ONBOARD-EVAL §14).
 * Uses Playwright Chromium against WEBUI_BASE; screenshots + JSON evidence → OUT_DIR.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../webui/package.json"));
const { chromium } = require("playwright");

const WEBUI = process.env.WEBUI_BASE || "http://127.0.0.1:55176";
const CONN = "starrocks-r1";
const SCHEMA = "sandbox";
const OUT = process.env.SPIDER2_BROWSER_OUT || "inbox/spider2-lite-sqlite/results/browser-sop";
const started = new Date().toISOString();

const steps = [];
function record(id, status, detail = {}) {
  steps.push({ id, status, ...detail, at: new Date().toISOString() });
  console.log(`[${status}] ${id}${detail.note ? ` — ${detail.note}` : ""}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(path.join(OUT, "shots"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);

async function shot(name) {
  const p = path.join(OUT, "shots", `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

try {
  // —— Phase 0: precheck ——
  const home = await page.goto(WEBUI + "/", { waitUntil: "domcontentloaded" });
  if (!home || home.status() >= 400) {
    record("P0-home", "fail", { note: `HTTP ${home?.status()}` });
    throw new Error("WebUI home not reachable");
  }
  record("P0-home", "pass", { note: `HTTP ${home.status()}`, shot: await shot("01-home") });

  await page.goto(`${WEBUI}/connections`, { waitUntil: "networkidle" });
  const card = page.getByTestId(`connection-card-${CONN}`);
  await card.waitFor({ state: "visible" });
  const cardText = await card.innerText();
  const hasSandbox = /sandbox/i.test(cardText);
  record("P0-connection-card", hasSandbox ? "pass" : "fail", {
    note: hasSandbox ? "starrocks-r1 card shows sandbox" : "sandbox not visible on card",
    shot: await shot("02-connections"),
  });
  if (!hasSandbox) throw new Error("sandbox missing on connection card");

  // API cross-check (same origin)
  const connApi = await page.evaluate(async (id) => {
    const r = await fetch(`/api/connections`);
    const j = await r.json();
    const list = j?.data?.connections || j?.connections || j?.data || [];
    const arr = Array.isArray(list) ? list : [];
    return arr.find((c) => c.id === id) || null;
  }, CONN);
  const enabled = connApi?.enabledTables || connApi?.enabled_tables || [];
  const s2Enabled = enabled.filter((t) => String(t).includes("sandbox.s2_") || String(t).startsWith("s2_"));
  record("P0-api-enabled-tables", s2Enabled.length >= 10 ? "pass" : "fail", {
    note: `enabled s2-like entries=${s2Enabled.length}`,
    sample: s2Enabled.slice(0, 5),
  });

  // —— Phase 1: enabled-tables UI ——
  await page.goto(
    `${WEBUI}/connections/enabled-tables?connection=${encodeURIComponent(CONN)}&schema=${encodeURIComponent(SCHEMA)}`,
    { waitUntil: "networkidle" },
  );
  await shot("03-enabled-tables");
  const table = page.getByTestId("pl-whitelist-table");
  const tableVisible = await table.isVisible().catch(() => false);
  const bodyText = await page.locator("body").innerText();
  const s2OnPage = (bodyText.match(/s2_[a-z0-9_]+/gi) || []).length;
  record("P1-enabled-tables-page", tableVisible || s2OnPage > 0 ? "pass" : "fail", {
    note: `whitelist table visible=${tableVisible}, s2 token hits=${s2OnPage}`,
  });

  // —— Phase 2: publish workbench ——
  await page.goto(`${WEBUI}/publish/workbench`, { waitUntil: "networkidle" });
  await shot("04-publish-workbench");
  const pubText = await page.locator("body").innerText();
  record("P2-publish-workbench", /语义|发布|索引|生效/i.test(pubText) ? "pass" : "fail", {
    note: "workbench loaded",
  });

  // —— Phase 3: wiki ——
  await page.goto(`${WEBUI}/wiki`, { waitUntil: "networkidle" });
  await shot("05-wiki");
  // try search / filter if present
  const search = page.getByPlaceholder(/搜索|search/i).first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill("spider2");
    await page.waitForTimeout(500);
  }
  let wikiText = await page.locator("body").innerText();
  let wikiHit = /spider2|rfm|ecommerce/i.test(wikiText);
  if (!wikiHit) {
    // deep link common key
    await page.goto(`${WEBUI}/wiki/global/spider2-ecommerce-rfm`, { waitUntil: "networkidle" });
    await shot("05b-wiki-rfm");
    wikiText = await page.locator("body").innerText();
    wikiHit = /RFM|spider2|ecommerce|Recency/i.test(wikiText);
  }
  record("P3-wiki", wikiHit ? "pass" : "warn", {
    note: wikiHit ? "spider2 RFM wiki reachable" : "spider2 wiki not found via list/deeplink",
  });

  // —— Phase 4: admin roles ——
  await page.goto(`${WEBUI}/admin/roles`, { waitUntil: "networkidle" });
  await shot("06-admin-roles");
  const rolesText = await page.locator("body").innerText();
  const roleHit = /ksc_financial_readonly|spider2_sandbox_readonly/i.test(rolesText);
  record("P4-roles-list", roleHit ? "pass" : "warn", {
    note: roleHit ? "expected role id visible" : "role id not in list text",
  });

  await page.goto(`${WEBUI}/admin/roles/ksc_financial_readonly`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "权限配置" }).click();
  await page.waitForTimeout(400);
  await shot("07-role-permissions");
  let roleDetail = await page.locator("body").innerText();
  let aclOk = /sandbox/i.test(roleDetail) && /s2_/i.test(roleDetail);
  if (!aclOk) {
    await page.getByRole("button", { name: "生效边界" }).click();
    await page.waitForTimeout(400);
    await shot("07b-role-effective");
    roleDetail = await page.locator("body").innerText();
    aclOk = /sandbox/i.test(roleDetail) && /s2_/i.test(roleDetail);
  }
  record("P4-role-sandbox-acl", aclOk ? "pass" : "fail", {
    note: aclOk ? "role permissions/effective shows sandbox + s2_" : "sandbox/s2_ not found on role tabs",
  });
  await page.goto(`${WEBUI}/admin/agents/demo_agent`, { waitUntil: "networkidle" });
  await shot("08-agent-demo");
  const agentText = await page.locator("body").innerText();
  record("P4-demo-agent", /ksc_financial_readonly|demo_agent|sandbox|s2_/i.test(agentText) ? "pass" : "warn", {
    note: "demo_agent detail loaded",
  });
} catch (err) {
  record("BROWSER-ABORT", "fail", { note: String(err?.message || err) });
  try {
    await shot("99-error");
  } catch {
    /* ignore */
  }
} finally {
  await browser.close();
}

const failed = steps.filter((s) => s.status === "fail");
const evidence = {
  gateId: "G-browser-sop",
  gateKind: "e2e",
  suite: "spider2_lite_sqlite",
  sop: "docs/qa/suite-semantic-onboard-mcp-eval.md §14",
  webuiBase: WEBUI,
  connectionId: CONN,
  schema: SCHEMA,
  status: failed.length ? "fail" : "pass",
  stub: false,
  steps,
  startedAt: started,
  finishedAt: new Date().toISOString(),
};
const outFile = path.join(OUT, "browser-sop-evidence.json");
await writeFile(outFile, JSON.stringify(evidence, null, 2) + "\n");
console.log(`\n[browser-sop] ${evidence.status.toUpperCase()} → ${outFile}`);
process.exit(failed.length ? 1 : 0);
