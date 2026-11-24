#!/usr/bin/env node
/**
 * UAT-PDS token seeder: issue N tokens via real admin API (demo_agent/demo_ops or listed agents).
 * Labels pds-t001..pds-tNNN for clean revocation. Usage:
 *   LUCY_ADMIN_ID=.. LUCY_ADMIN_PASSWORD=.. node scripts/uat/seed-tokens.mjs --count 200 [--per-agent 100] --out <dir>
 */
const OUT_ARG = process.argv.indexOf("--out");
const outDir = OUT_ARG >= 0 ? process.argv[OUT_ARG + 1] : "inbox/uat-pds-batch1-2026-11-20";
const countArg = process.argv.indexOf("--count");
const COUNT = countArg >= 0 ? Number(process.argv[countArg + 1]) : 200;

const WEB = process.env.LUCY_WEBUI || "http://127.0.0.1:55176";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function login() {
  const res = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: process.env.LUCY_ADMIN_ID, password: process.env.LUCY_ADMIN_PASSWORD })
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (res.status !== 200 || !cookie) throw new Error(`login ${res.status}`);
  return cookie;
}

(async () => {
  mkdirSync(outDir, { recursive: true });
  const cookie = await login();
  const agentsRes = await fetch(`${WEB}/api/admin/agents?view=roster`, { headers: { cookie } });
  const agents = (await agentsRes.json()).data.agents.map((a) => a.id ?? a.userId);
  console.log("agents:", agents.join(","));
  const report = { at: new Date().toISOString(), plan: COUNT, issues: [], failures: [] };
  const per = Math.ceil(COUNT / agents.length);
  let issued = 0;
  for (const userId of agents) {
    for (let i = 1; i <= per && issued < COUNT; i++) {
      const label = `pds-t${String(issued + 1).padStart(3, "0")}`;
      const r = await fetch(`${WEB}/api/admin/agents/${encodeURIComponent(userId)}/tokens`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ label, expires_in: "30d", device_name: "uat-pds" })
      });
      const j = await r.json().catch(() => null);
      report.issues.push({ userId, label, status: r.status, ms: 0 });
      if (r.status !== 200) report.failures.push({ userId, label, status: r.status, code: j?.error?.code });
      issued++;
      if (issued % 50 === 0) console.log(`issued ${issued}/${COUNT}`);
      await new Promise((r2) => setTimeout(r2, 400));
    }
  }
  const list = await fetch(`${WEB}/api/admin/tokens`, { headers: { cookie } });
  const lj = await list.json();
  report.afterCount = (lj.data?.tokens ?? lj.data ?? []).length;
  writeFileSync(resolve(outDir, `seed-tokens-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ afterCount: report.afterCount, failures: report.failures.length }, null, 2));
  process.exit(report.failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error(String(e?.stack || e)); process.exit(2); });
