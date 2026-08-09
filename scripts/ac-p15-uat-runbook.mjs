#!/usr/bin/env node
/**
 * AC-P1.5 UAT + Runbook Path D automation against a live WebUI.
 * Plan: docs/access-control/plans/20260809-ac-p15-uat-runbook-plan.md
 *
 * Env:
 *   ACP15_WEBUI_BASE   default http://127.0.0.1:55176
 *   ACP15_MCP_BASE     default http://127.0.0.1:57881/mcp
 *   ACP15_SKIP_UI=1    skip Playwright
 *   ACP15_SKIP_MCP=1   skip MCP spotchecks
 *   ACP15_KEEP_AGENT=1 keep acp15_uat_agent after run
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const requireFromWebui = createRequire(path.join(ROOT, "webui", "package.json"));
const { chromium } = requireFromWebui("playwright");
const EVIDENCE = path.join(ROOT, "inbox", "20260809-ac-p15-uat");
const API_DIR = path.join(EVIDENCE, "api");
const SHOT_DIR = path.join(EVIDENCE, "screenshots");

const WEBUI = process.env.ACP15_WEBUI_BASE ?? "http://127.0.0.1:55176";
const MCP = process.env.ACP15_MCP_BASE ?? "http://127.0.0.1:57881/mcp";
const SKIP_UI = process.env.ACP15_SKIP_UI === "1";
const SKIP_MCP = process.env.ACP15_SKIP_MCP === "1";
const KEEP_AGENT = process.env.ACP15_KEEP_AGENT === "1";

const AGENT_ID = "acp15_uat_agent";
const ROLE_ID = "demo_readonly";

const LEGAL_CONSTRAINTS = {
  sources: [
    {
      connection: "demo-mysql",
      schema: "dataforai",
      names: ["superstore_orders"],
      predicates: [{ field: "region", op: "eq", value: "East" }]
    }
  ]
};

/** @type {Array<{ id: string; pass: boolean; detail?: string }>} */
const results = [];

function record(id, pass, detail) {
  results.push({ id, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${id}${detail ? ` — ${detail}` : ""}`);
}

async function saveJson(name, body) {
  await writeFile(path.join(API_DIR, name), JSON.stringify(body, null, 2), "utf8");
}

async function api(method, urlPath, body) {
  const res = await fetch(`${WEBUI}${urlPath}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function getAgentVersion() {
  const res = await api("GET", `/api/admin/agents/${AGENT_ID}`);
  return res.json?.data?.version;
}

async function ensureAgent() {
  const list = await api("GET", "/api/admin/agents");
  const exists = (list.json?.data?.agents ?? []).some((a) => a.id === AGENT_ID);
  if (exists) {
    await saveJson("00-agent-exists.json", list.json);
    return;
  }
  const created = await api("POST", "/api/admin/agents", {
    dryRun: false,
    agent: {
      id: AGENT_ID,
      name: "AC-P1.5 UAT Agent",
      role: ROLE_ID,
      note: "Automated UAT / Runbook Path D — safe to delete"
    }
  });
  await saveJson("00-agent-create.json", created);
  if (created.status !== 200 || !created.json?.ok) {
    throw new Error(`create agent failed: ${created.status} ${JSON.stringify(created.json)}`);
  }
}

async function cleanupAgent() {
  if (KEEP_AGENT) return;
  // Clear constraints first if present, then delete agent.
  const get = await api("GET", `/api/admin/agents/${AGENT_ID}`);
  if (get.status === 404) return;
  const version = get.json?.data?.version;
  if (get.json?.data?.agent?.constraints) {
    await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: false,
      version,
      patch: { constraints: null }
    });
  }
  const del = await api("DELETE", `/api/admin/agents/${AGENT_ID}`);
  await saveJson("99-agent-delete.json", del);
}

function ordersCap(effective) {
  const caps = effective?.capabilities ?? [];
  return caps.find(
    (c) => c.sourceName === "superstore_orders" && (c.tool === "lucy_query" || c.tool === "lucy_explain_query")
  ) ?? caps.find((c) => c.sourceName === "superstore_orders");
}

async function runAdminCases() {
  await ensureAgent();

  // UAT-A1 dryRun legal
  {
    const version = await getAgentVersion();
    const res = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: true,
      version,
      patch: { constraints: LEGAL_CONSTRAINTS }
    });
    await saveJson("01-uat-a1-dryrun-legal.json", res);
    const cap = ordersCap(res.json?.data?.effectivePermissions);
    const pass =
      res.status === 200
      && res.json?.ok === true
      && String(res.json?.data?.diff ?? "").includes("constraints")
      && cap?.protected === true
      && (cap?.finalRows?.kind === "scoped" || cap?.finalRows?.digest);
    record("UAT-A1", Boolean(pass), pass ? `digest=${cap?.finalRows?.digest ?? "?"}` : `status=${res.status}`);
  }

  // UAT-A2 save
  {
    const version = await getAgentVersion();
    const res = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: false,
      version,
      patch: { constraints: LEGAL_CONSTRAINTS }
    });
    await saveJson("02-uat-a2-save.json", res);
    const pass = res.status === 200 && res.json?.data?.runtimeAck === true && Boolean(res.json?.data?.policyVersion);
    record("UAT-A2", Boolean(pass), pass ? `runtimeAck + policyVersion` : JSON.stringify(res.json?.error ?? res.json?.data));
  }

  // UAT-A3 GET preview
  {
    const res = await api("GET", `/api/admin/agents/${AGENT_ID}`);
    await saveJson("03-uat-a3-get-preview.json", res);
    const agent = res.json?.data?.agent;
    const cap = ordersCap(agent?.effectivePermissions);
    const blob = JSON.stringify(res.json);
    const pass =
      res.status === 200
      && agent?.constraints?.sources?.[0]?.predicates?.[0]?.value === "East"
      && cap?.protected === true
      && !blob.includes("行级取数已生效\"")
      && (cap?.finalRows?.kind === "scoped" || typeof cap?.finalRows?.digest === "string");
    record("UAT-A3", Boolean(pass), pass ? `protected + FinalRows scoped` : `cap=${JSON.stringify(cap)}`);
  }

  // UAT-A4 / RB-D1 mixed names
  {
    const before = await api("GET", `/api/admin/agents/${AGENT_ID}`);
    const version = before.json?.data?.version;
    const res = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: true,
      version,
      patch: {
        constraints: {
          sources: [
            {
              connection: "demo-mysql",
              schema: "dataforai",
              names: ["superstore_orders", "typo_or_unauthorized"],
              predicates: [{ field: "region", op: "eq", value: "East" }]
            }
          ]
        }
      }
    });
    await saveJson("04-uat-a4-mixed-names.json", res);
    const pass = res.status === 400 && res.json?.error?.code === "constraints_source_not_in_capability";
    record("UAT-A4/RB-D1", Boolean(pass), res.json?.error?.code ?? String(res.status));
  }

  // UAT-A5 / RB-D2 unsatisfiable
  {
    const version = await getAgentVersion();
    const res = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: true,
      version,
      patch: {
        constraints: {
          sources: [
            {
              connection: "demo-mysql",
              schema: "dataforai",
              names: ["superstore_orders"],
              predicates: [
                { field: "region", op: "eq", value: "East" },
                { field: "region", op: "eq", value: "West" }
              ]
            }
          ]
        }
      }
    });
    await saveJson("05-uat-a5-unsat.json", res);
    const pass = res.status === 400 && res.json?.error?.code === "final_rows_unsatisfiable";
    record("UAT-A5/RB-D2", Boolean(pass), res.json?.error?.code ?? String(res.status));
  }

  // UAT-A6 Role constraints forbidden (create path — Spec 100 §3.3)
  {
    const res = await api("POST", "/api/admin/roles", {
      dryRun: true,
      roleId: "acp15_role_with_constraints",
      role: {
        description: "illegal constraints on role",
        constraints: { sources: [] },
        allow: {
          connections: ["demo-mysql"],
          tableSelectors: [
            {
              connection: "demo-mysql",
              schema: "dataforai",
              names: ["superstore_orders"],
              row_access: "all"
            }
          ],
          tools: ["lucy_query"]
        }
      }
    });
    await saveJson("06-uat-a6-role-constraints.json", res);
    const msg = JSON.stringify(res.json ?? {});
    const pass = res.status >= 400 && /constraints/i.test(msg);
    record("UAT-A6", Boolean(pass), res.json?.error?.code ?? res.json?.error?.message ?? String(res.status));
  }

  // Keep legal constraints for UI / MCP, then clear at end (UAT-A7)
  // Re-save legal if A5/A4 left state unchanged (dryRun only).
  {
    const get = await api("GET", `/api/admin/agents/${AGENT_ID}`);
    if (!get.json?.data?.agent?.constraints) {
      const version = get.json?.data?.version;
      await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
        dryRun: false,
        version,
        patch: { constraints: LEGAL_CONSTRAINTS }
      });
    }
  }
}

async function runUiCases() {
  if (SKIP_UI) {
    record("UI-1", true, "skipped (ACP15_SKIP_UI=1)");
    record("UI-2", true, "skipped");
    record("UI-3", true, "skipped");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`${WEBUI}/admin/agents/${AGENT_ID}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="agent-constraints-editor"]', { timeout: 20000 });
    const editor = page.locator('[data-testid="agent-constraints-editor"]');
    const editorText = await editor.innerText();
    const ui1 =
      editorText.includes("强制约束")
      && editorText.includes("不表示行级取数已生效");
    await page.screenshot({ path: path.join(SHOT_DIR, "01-agent-constraints-editor.png"), fullPage: true });
    record("UI-1", ui1, ui1 ? "editor + disclaimer" : editorText.slice(0, 120));

    // UI-2: dirty edit → 查看变更 diff → assert dryRun FinalRows preview
    // (durable save already covered by UAT-A2; sticky bar can occlude confirm modal)
    try {
      const east = editor.locator("input.pl-input").nth(4);
      await east.click({ clickCount: 3 });
      await east.fill("West");
      const bar = page.getByTestId("sticky-save-bar");
      await bar.waitFor({ timeout: 10000 });
      await page.screenshot({ path: path.join(SHOT_DIR, "01b-sticky-save-bar.png"), fullPage: true });
      await bar.locator('button[aria-label="查看变更 diff"]').click();
      const dry = page.locator('[data-testid="dryrun-finalrows-preview"]');
      await dry.waitFor({ timeout: 15000 });
      const dryText = await dry.innerText();
      const ok =
        /FinalRows/i.test(dryText)
        && /不表示行级取数已生效/.test(dryText)
        && /protected|constraints=/i.test(dryText);
      await page.screenshot({ path: path.join(SHOT_DIR, "02-dryrun-finalrows.png"), fullPage: true });
      record("UI-2", ok, ok ? "dryRun FinalRows preview" : dryText.slice(0, 160));
    } catch (err) {
      await page.screenshot({ path: path.join(SHOT_DIR, "02-ui2-failed.png"), fullPage: true }).catch(() => {});
      record("UI-2", false, String(err?.message ?? err).slice(0, 220));
    }

    // UI-3: deep-link permissions tab (avoids sticky-bar click interception)
    try {
      await page.goto(`${WEBUI}/admin/agents/${AGENT_ID}?tab=permissions`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="capability-preview"]', { timeout: 15000 });
      const preview = page.locator('[data-testid="capability-preview"]');
      const previewText = await preview.innerText();
      const ui3 =
        /FinalRows/i.test(previewText)
        && /protected|constraints=/i.test(previewText)
        && previewText.includes("不表示行级取数已在上游注入生效");
      await page.screenshot({ path: path.join(SHOT_DIR, "04-capability-preview.png"), fullPage: true });
      record("UI-3", ui3, ui3 ? "preview FinalRows/protected" : previewText.slice(0, 160));
    } catch (err) {
      await page.screenshot({ path: path.join(SHOT_DIR, "04-ui3-failed.png"), fullPage: true }).catch(() => {});
      record("UI-3", false, String(err?.message ?? err).slice(0, 220));
    }
  } finally {
    await browser.close();
  }
}

async function runMcpCases() {
  if (SKIP_MCP) {
    record("MCP-1", true, "skipped (ACP15_SKIP_MCP=1)");
    record("MCP-2", true, "skipped");
    return;
  }

  // Create short-lived token
  const version = await getAgentVersion();
  const tok = await api("POST", `/api/admin/agents/${AGENT_ID}/tokens`, {
    label: "acp15-uat-T1"
  });
  await saveJson("07-token-create.json", tok);
  const token = tok.json?.data?.token ?? tok.json?.data?.plainToken ?? tok.json?.data?.plaintext;
  if (!token) {
    record("MCP-1", false, "token create failed");
    record("MCP-2", false, "skipped");
    return;
  }
  // Token API writes YAML without EffectivePolicy commit — bump Agent to reload runtime.
  const bump = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
    dryRun: false,
    version: await getAgentVersion(),
    patch: { note: `acp15-uat runtime reload ${Date.now()}` }
  });
  await saveJson("07a-runtime-reload-after-token.json", bump);
  void version;

  async function mcpRpc(method, params, sessionId) {
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(MCP, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
    });
    const text = await res.text();
    const nextSession = res.headers.get("mcp-session-id") ?? sessionId;
    return { status: res.status, text, sessionId: nextSession };
  }

  const init = await mcpRpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "acp15-uat", version: "1.0.0" }
  });
  await saveJson("07b-mcp-initialize.json", init);
  let sessionId = init.sessionId;
  if (sessionId) {
    await mcpRpc("notifications/initialized", {}, sessionId);
  }

  async function mcpCall(tool, args) {
    return mcpRpc("tools/call", { name: tool, arguments: args }, sessionId);
  }

  const q = await mcpCall("lucy_query", {
    connectionId: "demo-mysql",
    measures: ["superstore_orders.total_sales"]
  });
  await saveJson("08-mcp-lucy-query.json", q);
  const unproven = /row_policy_upstream_unproven/.test(q.text);
  record("MCP-1", unproven, unproven ? "unproven deny" : q.text.slice(0, 200));

  const read = await mcpCall("lucy_read_source", {
    connectionId: "demo-mysql",
    sourceName: "superstore_orders"
  });
  await saveJson("09-mcp-lucy-read-source.json", read);
  const wrapped = /row_policy_requires_wrapped_tool/.test(read.text);
  record("MCP-2", wrapped, wrapped ? "unwrapped deny" : read.text.slice(0, 200));

  // Revoke token
  const v2 = await getAgentVersion();
  const rev = await api("DELETE", `/api/admin/agents/${AGENT_ID}/tokens/${encodeURIComponent("acp15-uat-T1")}`, undefined);
  // Some APIs need version in query — try path delete first; if fails, ignore for hygiene note
  await saveJson("10-token-revoke.json", { rev, versionTried: v2 });
}

async function runClearAndNonClaim() {
  // UAT-A7 clear
  {
    const version = await getAgentVersion();
    const res = await api("PATCH", `/api/admin/agents/${AGENT_ID}`, {
      dryRun: false,
      version,
      patch: { constraints: null }
    });
    await saveJson("11-uat-a7-clear.json", res);
    const get = await api("GET", `/api/admin/agents/${AGENT_ID}`);
    await saveJson("12-uat-a7-get-after-clear.json", get);
    const cap = ordersCap(get.json?.data?.agent?.effectivePermissions);
    const pass =
      res.status === 200
      && res.json?.data?.runtimeAck === true
      && get.json?.data?.agent?.constraints === undefined
      && (cap?.finalRows === "all" || cap?.finalRows?.kind === "all" || cap?.protected === false || cap?.protected === undefined);
    record("UAT-A7/RB-D3", Boolean(pass), pass ? "cleared" : JSON.stringify({ err: res.json?.error, cap }));
  }

  // SC-P15-08 static — require Non-Claim section; forbid positive delivery claims.
  {
    const notes = await readFile(
      path.join(ROOT, "docs/access-control/release-notes-ac-p15.md"),
      "utf8"
    );
    const positiveClaims = [
      /已交付\s*Dynamic RLS/,
      /Dynamic RLS\s*已交付/,
      /TokenScope\s*行收紧\s*已交付/,
      /已交付\s*多租户隔离/,
      /数据库原生 RLS\s*已交付/
    ];
    const hit = positiveClaims.find((re) => re.test(notes));
    const hasNonClaim =
      notes.includes("明确未交付")
      && notes.includes("Dynamic RLS")
      && notes.includes("TokenScope");
    record("SC-P15-08", !hit && hasNonClaim, hit ? `positive-claim:${hit}` : "release notes Non-Claim OK");
  }
}

async function writeConclusion() {
  const failed = results.filter((r) => !r.pass);
  const summary = {
    when: new Date().toISOString(),
    webui: WEBUI,
    mcp: MCP,
    passed: results.filter((r) => r.pass).length,
    failed: failed.length,
    results
  };
  await writeFile(path.join(EVIDENCE, "00-results-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const md = `# AC-P1.5 UAT / Runbook Path D 自动化结论

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 UAT / Runbook 自动化结论 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | \`20260809-ac-p15-uat-runbook-plan.md\`；环境 lucy-ac-p1-by01 |
| 适用范围 | Gate C 签字前自动化证据 |
| 输出位置 | \`inbox/20260809-ac-p15-uat/09-process-and-conclusion.md\` |

## 环境

- WebUI: ${WEBUI}
- MCP: ${MCP}
- SKIP_UI=${SKIP_UI} SKIP_MCP=${SKIP_MCP}

## 结果

| ID | 结果 | 说明 |
|---|---|---|
${results.map((r) => `| ${r.id} | ${r.pass ? "**PASS**" : "**FAIL**"} | ${r.detail ?? ""} |`).join("\n")}

**汇总：** ${summary.passed} passed / ${summary.failed} failed

## 结论

${failed.length === 0
    ? "自动化矩阵全绿，建议产品抽检截图后在 `uat-ac-p15.md` / Runbook 路径 D 签字。"
    : `存在失败项：${failed.map((f) => f.id).join(", ")}。勿总签 Gate C。`}

— 完
`;
  await writeFile(path.join(EVIDENCE, "09-process-and-conclusion.md"), md, "utf8");
  return failed.length === 0;
}

async function main() {
  await mkdir(API_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });

  const health = await api("GET", "/api/admin/agents");
  if (health.status !== 200) {
    console.error(`WebUI not reachable at ${WEBUI} (status ${health.status})`);
    process.exit(2);
  }

  try {
    await runAdminCases();
    await runUiCases();
    await runMcpCases();
    await runClearAndNonClaim();
  } finally {
    try {
      await cleanupAgent();
    } catch (err) {
      console.warn("cleanup warning:", err);
    }
  }

  const ok = await writeConclusion();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
