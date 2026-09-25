#!/usr/bin/env node
/**
 * G-sample: Spider2-lite MCP-direct E2E (Cursor lucy-demo path).
 * Default: Bearer lucy-demo-agent-token against local MCP — no Claude CLI / eval-runner.
 * Missing MCP / ACL scope => blocked evidence (exit 42).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SAMPLE_FILE = "evals/spider2_lite_sqlite/sample-ids.txt";
const OUT =
  process.env.SPIDER2_SAMPLE_OUT ||
  "inbox/spider2-lite-sqlite/results/p1-spider2-lite-sample-evidence.json";
const MCP_URL =
  process.env.EVAL_KTX_MCP_URL ||
  process.env.KTX_MCP_URL ||
  "http://127.0.0.1:57881/mcp";
const TOKEN =
  process.env.LUCY_SPIDER2_E2E_TOKEN ||
  process.env.EVAL_KTX_MCP_TOKEN ||
  process.env.KTX_MCP_TOKEN ||
  "lucy-demo-agent-token";

const started = new Date().toISOString();
const sampleIds = (await readFile(SAMPLE_FILE, "utf8"))
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

async function mcpPost(body, sessionId) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const sid = res.headers.get("mcp-session-id") || sessionId;
  const raw = await res.text();
  let payload = {};
  if (raw.startsWith("event:") || raw.includes("\ndata:")) {
    const lines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    const last = lines[lines.length - 1];
    payload = last ? JSON.parse(last.slice(5).trim()) : {};
  } else if (raw.trim()) {
    payload = JSON.parse(raw);
  }
  if (!res.ok) {
    const err = new Error(`MCP HTTP ${res.status}`);
    err.payload = payload;
    err.status = res.status;
    throw err;
  }
  return { sid, payload };
}

function contentText(payload) {
  const parts = payload?.result?.content || [];
  return parts
    .filter((c) => c?.type === "text")
    .map((c) => c.text || "")
    .join("\n");
}

async function writeBlocked(reason, extra = {}) {
  const evidence = {
    gateId: "G-sample",
    gateKind: "e2e",
    suite: "spider2_lite_sqlite",
    status: "blocked",
    stub: false,
    runner: "mcp-direct",
    reason,
    mcpUrl: MCP_URL,
    tokenLabel: TOKEN === "lucy-demo-agent-token" ? "lucy-demo-agent-token" : "custom",
    sampleIds,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    ...extra,
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(evidence, null, 2) + "\n");
  console.error(`[e2e-spider2-lite-sample] BLOCKED: ${reason}`);
  process.exit(42);
}

console.log(`[e2e-spider2-lite-sample] runner=mcp-direct mcp=${MCP_URL} cases=${sampleIds.length}`);

let sid;
let instructions = "";
try {
  const init = await mcpPost({
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-spider2-lite-sample", version: "1.1" },
    },
  });
  sid = init.sid;
  instructions = init.payload?.result?.instructions || "";
  await mcpPost(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    sid,
  );
} catch (err) {
  await writeBlocked(`MCP initialize failed: ${err.message}`, {
    httpStatus: err.status || null,
  });
}

const scopeHasSandbox =
  /Visible Scope[\s\S]*sandbox\.s2_/i.test(instructions) ||
  /s2_sakila_payment/i.test(instructions);
if (!scopeHasSandbox) {
  await writeBlocked(
    "Visible Scope missing sandbox.s2_* — expand demo_agent / ksc_financial_readonly ACL (prefix sandbox s2_)",
    { instructionsSnippet: instructions.slice(0, 600) },
  );
}

let catalogText = "";
try {
  const cat = await mcpPost(
    {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name: "lucy_catalog", arguments: {} },
    },
    sid,
  );
  catalogText = contentText(cat.payload);
} catch (err) {
  await writeBlocked(`lucy_catalog failed: ${err.message}`);
}

const s2Matches = [...new Set(catalogText.match(/s2_[a-z0-9_]+/gi) || [])];
if (s2Matches.length < 10) {
  await writeBlocked(`lucy_catalog returned too few s2_* sources (${s2Matches.length})`, {
    s2Sample: s2Matches.slice(0, 20),
  });
}

let queryText = "";
try {
  const q = await mcpPost(
    {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: {
        name: "lucy_query",
        arguments: {
          connectionId: "starrocks-r1",
          measures: ["s2_sakila_payment.payment_count"],
        },
      },
    },
    sid,
  );
  queryText = contentText(q.payload);
} catch (err) {
  await writeBlocked(`lucy_query datapath failed: ${err.message}`);
}

const paymentOk = /16049/.test(queryText);
if (!paymentOk) {
  const evidence = {
    gateId: "G-sample",
    gateKind: "e2e",
    suite: "spider2_lite_sqlite",
    status: "fail",
    stub: false,
    runner: "mcp-direct",
    reason: "datapath payment_count != 16049",
    mcpUrl: MCP_URL,
    sampleIds,
    s2SourceCount: s2Matches.length,
    queryText: queryText.slice(0, 800),
    startedAt: started,
    finishedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(evidence, null, 2) + "\n");
  console.error(`[e2e-spider2-lite-sample] FAIL: ${evidence.reason}`);
  process.exit(1);
}

const evidence = {
  gateId: "G-sample",
  gateKind: "e2e",
  suite: "spider2_lite_sqlite",
  status: "pass",
  stub: false,
  runner: "mcp-direct",
  mcpUrl: MCP_URL,
  tokenLabel: TOKEN === "lucy-demo-agent-token" ? "lucy-demo-agent-token" : "custom",
  sampleIds,
  checks: {
    visibleScopeSandbox: true,
    catalogS2Count: s2Matches.length,
    datapathPaymentCount: 16049,
  },
  note:
    "MCP-direct gate on Cursor lucy-demo token. Full NL sample scoring is a Cursor Agent turn against this MCP (no Claude CLI). sample-ids remain the question set.",
  startedAt: started,
  finishedAt: new Date().toISOString(),
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(evidence, null, 2) + "\n");
console.log(
  `[e2e-spider2-lite-sample] PASS evidence=${OUT} s2=${s2Matches.length} payment_count=16049`,
);
process.exit(0);
