// 按 UAT-SUITE-ACCESS-MAP-SANKEY cases.md 的步骤，在 Docker 容器（真实镜像、真实 WebUI）上逐条执行 R0／01～05。
// 先 `bash scripts/uat/sankey-docker/up.sh`，再 `node scripts/uat/sankey-docker/run-uat.mjs`，最后 `bash scripts/uat/sankey-docker/down.sh`。
import { openMap } from "./lib.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
const OUT = process.env.SANKEY_EVIDENCE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/qa/uat/suites/access-map-sankey-design/runs/evidence");
const PORTS = { "grants-only": 58301, rich: 58302, sparse: 58303, "candidate-only": 58304, dense: 58305 };
const EXPECT = {
  "grants-only": { grantPaths: 188, accessPaths: 0, rawCalls: 0, deniedCalls: 0 },
  sparse: { grantPaths: 188, accessPaths: 4, rawCalls: 55, deniedCalls: 0 },
  rich: { grantPaths: 188, accessPaths: 20, rawCalls: 173, deniedCalls: 2 },
  "candidate-only": { grantPaths: 188, accessPaths: 0, rawCalls: 0, deniedCalls: 0 },
  dense: { grantPaths: 524, accessPaths: 146, rawCalls: 1455, deniedCalls: 2 },
};
const Q = "window=168h&inquiryKind=all&accessGrade=all";
const out = {};

async function api(port, extra = "") {
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/access-map?${Q}${extra}`);
  return { status: r.status, body: await r.json() };
}

// R0
out.R0 = {};
for (const [p, port] of Object.entries(PORTS)) {
  const { body } = await api(port);
  const m = body.data.meta;
  const got = { grantPaths: m.counts.grantPaths, accessPaths: m.counts.accessPaths, rawCalls: m.access.rawCalls, deniedCalls: m.access.deniedCalls };
  out.R0[p] = { got, ok: JSON.stringify(got) === JSON.stringify(EXPECT[p]) };
}

const MEASURE = () => {
  const num = (s) => (s.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const thick = (d) => { const n = num(d); return n[n.length - 1] - n[1]; };
  const nodes = [...document.querySelectorAll("g[data-node-kind]")].map((g) => {
    const tid = g.getAttribute("data-testid") || "";
    const pillar = g.querySelector("rect[rx]:not([data-testid])");
    return { id: tid.replace("access-map-node-", ""), kind: g.getAttribute("data-node-kind"), h: pillar ? pillar.getBBox().height : 0 };
  });
  const usage = [...document.querySelectorAll('path[data-testid^="access-map-ribbon-"]')].map((p) => ({ id: p.getAttribute("data-testid").replace("access-map-ribbon-", ""), t: thick(p.getAttribute("d")) }));
  const ghost = [...document.querySelectorAll('path[data-testid^="access-map-ghost-"]')].filter((p) => !p.getAttribute("data-testid").includes("hit")).map((p) => ({ id: p.getAttribute("data-testid").replace("access-map-ghost-", ""), t: thick(p.getAttribute("d")) }));
  const aggs = [...document.querySelectorAll('[data-testid^="access-map-node-idle-agg"]')].map((g) => g.querySelector("title")?.textContent || "");
  const plot = (() => { let best = null; document.querySelectorAll("svg").forEach((s) => { if (!best || s.getBoundingClientRect().height > best.getBoundingClientRect().height) best = s; }); return best.parentElement; })();
  const txt = document.body.innerText;
  return {
    nodes, usage, ghost, aggs,
    scroll: { scrollH: plot.scrollHeight, clientH: plot.clientHeight, ov: getComputedStyle(plot).overflowY },
    txt: { allowed: (txt.match(/进入允许调用[^\n]*/) || [""])[0], legend: [...txt.matchAll(/(流带宽度[^\n]*|虚线轮廓[^\n]*|虚线 =[^\n]*|实线 =[^\n]*)/g)].map((m) => m[0]), notice: [...document.querySelectorAll(".pl-notice")].map((n) => n.innerText) },
  };
};

const runs = {};
for (const [p, port] of Object.entries(PORTS)) {
  const { browser, page } = await openMap(port);
  runs[p] = await page.evaluate(MEASURE);
  await page.screenshot({ path: `${OUT}/2026-11-17-docker-${p}.png` });
  if (p === "sparse") {
    const first = await page.$('[data-testid^="access-map-node-idle-agg"]');
    const titles = runs[p].aggs;
    // 找 119 张表的聚合节点
    const handles = await page.$$('[data-testid^="access-map-node-idle-agg"]');
    let target = null;
    for (const h of handles) { const t = await h.evaluate((g) => g.querySelector("title")?.textContent || ""); if (t.includes("119 张表")) target = h; }
    await target.click();
    await page.waitForTimeout(600);
    const list = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((d) => /闲置授权 \d+ 条/.test(d.innerText) && d.innerText.length < 20000 && d.querySelector("button"));
      if (!el) return null;
      const rows = [...el.querySelectorAll("button")].filter((b) => /授权路径 \d+ 条/.test(b.innerText));
      return { header: el.innerText.split("\n")[0], rows: rows.length, first: rows[0]?.innerText };
    });
    runs[p].list = list;
    if (list && list.rows > 0) {
      const row = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find((b) => /授权路径 \d+ 条/.test(b.innerText)));
      await row.asElement().click();
      await page.waitForTimeout(800);
      runs[p].drawer = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.innerText.split("\n").slice(0, 6) : null; });
    }
    await page.screenshot({ path: `${OUT}/2026-11-17-docker-sparse-idle-list.png` });
  }
  await browser.close();
}

const apis = {};
for (const [p, port] of Object.entries(PORTS)) apis[p] = (await api(port)).body.data;
const cand = await api(PORTS["candidate-only"], "&trust=include_candidate");
const states = {};
for (const e of apis.rich.edges) states[e.state] = (states[e.state] || 0) + 1;

const ids = (arr) => new Set(arr.flatMap((x) => x.id.replace(/^e\|/, "").split("|")));
const usageNodeIds = (r) => ids(r.usage);
const zeroUsageNodes = (r) => { const u = usageNodeIds(r); return r.nodes.filter((n) => u.has(n.id) && n.h <= 0).map((n) => n.id); };
const colCount = (r) => { const c = {}; r.nodes.filter((n) => !n.id.startsWith("idle-agg:")).forEach((n) => (c[n.kind] = (c[n.kind] || 0) + 1)); return c; };

out.cases = {
  "01": { usageRibbons: runs.rich.usage.length, zeroUsageNodes: zeroUsageNodes(runs.rich), minUsageThick: Math.min(...runs.rich.usage.map((x) => x.t)), states, allowedText: runs.rich.txt.allowed },
  "02": { kinds: colCount(runs["grants-only"]), aggs: runs["grants-only"].aggs, ghost: runs["grants-only"].ghost.map((g) => ({ id: g.id, t: g.t })), usageRibbons: runs["grants-only"].usage.length },
  "03": { aggs: runs.sparse.aggs, list: runs.sparse.list, drawer: runs.sparse.drawer, legend: runs.sparse.txt.legend, usageRibbons: runs.sparse.usage.length },
  "04": { unconfirmedCalls: apis["candidate-only"].meta.access.unconfirmedCalls, trust: apis["candidate-only"].meta.access.trust, includeCandidate: { status: cand.status, code: cand.body?.error?.code }, notice: runs["candidate-only"].txt.notice, hasOldText: runs["candidate-only"].txt.notice.join(" ").includes("可调整筛选") },
  "05": { cols: colCount(runs.dense), zeroUsageNodes: zeroUsageNodes(runs.dense), minUsageThick: Math.min(...runs.dense.usage.map((x) => x.t)), usageRibbons: runs.dense.usage.length, scroll: runs.dense.scroll },
};
console.log(JSON.stringify(out, null, 1));
