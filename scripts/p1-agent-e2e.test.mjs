import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  assertionsFromCase,
  checkTextAssertions,
  loadAgentCommands,
  loadEvalCase,
  parseAgentFinalText,
  parseArgs,
  redactValue,
  renderHtmlReport,
  stringIncludesLoose
} from "./p1-agent-e2e.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "p1-agent-e2e.mjs");

function startLucyStub({ token = "main-token" } = {}) {
  const sockets = new Set();
  const catalogSources = [
    { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
    { connectionId: "mysql-aliyun", sourceName: "kx_vw_income_statement_detail" },
    { connectionId: "poc-mysql-aliyun", sourceName: "poc_ceo_metric_snapshot" },
    { connectionId: "poc-mysql-aliyun", sourceName: "poc_ad_revenue_daily" }
  ];
  const tools = ["lucy_catalog", "lucy_read_source", "lucy_query", "wiki_search", "wiki_read"].map((name) => ({
    name,
    inputSchema: { type: "object", properties: {} }
  }));

  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }));
      return;
    }

    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    res.setHeader("content-type", "application/json");

    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "p1-agent-e2e-test-session");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }));
      return;
    }
    if (body.method === "notifications/initialized") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      return;
    }
    if (body.method === "tools/list") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }));
      return;
    }
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments || {};
      if (name === "lucy_catalog") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ sources: catalogSources }) }] }
        }));
        return;
      }
      if (name === "wiki_search") {
        const query = String(args.query || "").toLowerCase();
        const key = query.includes("kx")
          ? "global/kx-financial-analysis-playbook.md"
          : query.includes("superstore")
            ? "global/superstore-analysis-playbook.md"
            : "global/poc-data-agent-playbook.md";
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ results: [{ key, title: key }] }) }] }
        }));
        return;
      }
      if (name === "wiki_read") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ key: args.key, content: "authorized wiki content" }) }] }
        }));
        return;
      }
      if (name === "lucy_read_source") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ sourceName: args.sourceName, measures: ["ok"] }) }],
            _meta: { lucy: { tool: "lucy_read_source", upstreamTool: "sl_read_source" } }
          }
        }));
        return;
      }
      if (name === "lucy_query") {
        let payload = { rows: [{ value: "ok" }] };
        const measures = JSON.stringify(args.measures || []);
        if (measures.includes("order_count")) payload = { rows: [{ order_count: 5083, total_sales: 16867374.07 }] };
        if (measures.includes("营业收入_本年累计")) payload = { rows: [{ report_period: "202605", amount: 69339.62 }] };
        if (measures.includes("ad_revenue")) payload = { rows: [{ dt: "2026-05-31", ad_revenue: 196314.31 }] };
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(payload) }],
            _meta: { lucy: { tool: "lucy_query", upstreamTool: "sl_query" } }
          }
        }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "unknown tool" }] } }));
      return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "not found" } }));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((done) => {
          server.closeIdleConnections?.();
          for (const socket of sockets) socket.destroy();
          server.close(done);
        })
      });
    });
  });
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p1-agent-e2e-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("parseArgs and command JSON validation are strict enough for dry-run", () => {
  const args = parseArgs(["node", SCRIPT, "--profile", "main", "--dry-run", "--timeout-ms", "1234"]);
  assert.deepEqual(args.profiles, ["main"]);
  assert.equal(args.dryRun, true);
  assert.equal(args.timeoutMs, 1234);
  assert.throws(() => loadAgentCommands({ LUCY_E2E_AGENT_COMMANDS: '{"main":"claude"}' }), /string array/);
});

test("case-derived text assertions understand required and forbidden phrases", () => {
  const testCase = loadEvalCase("data_agent_poc-timezone-utc-display-001");
  const assertions = assertionsFromCase(testCase);
  assert(assertions.required.includes("北京时间 2026-05-31"));
  assert(assertions.forbidden.some((phrase) => phrase.includes("2026-05-30")));
  assert.equal(
    checkTextAssertions("北京时间 2026-05-31 Asia/Shanghai 196,314.31 190,213.91 是 2026-05-30 的值", assertions).ok,
    true
  );
  assert.equal(checkTextAssertions("北京时间 2026-05-30", assertions).ok, false);
});

test("final text parser handles stream-json and plain text agents", () => {
  assert.equal(parseAgentFinalText('{"type":"result","result":"最终答案 69339.62"}\n'), "最终答案 69339.62");
  assert.equal(parseAgentFinalText("plain answer\n", ""), "plain answer");
});

test("redaction removes bearer tokens, secret paths, and explicit token values", () => {
  const redacted = JSON.stringify(redactValue({
    Authorization: "Bearer abc.def",
    token: "abc.def",
    nested: "look .ktx/secrets/local.txt token=abc.def"
  }, "abc.def"));
  assert.equal(redacted.includes("abc.def"), false);
  assert.equal(redacted.includes(".ktx/secrets/local.txt"), false);
});

test("loose phrase matching tolerates comma-formatted numbers", () => {
  assert.equal(stringIncludesLoose("196,314.31", "196314.31"), true);
  assert.equal(stringIncludesLoose("一、营业收入 69339.62", "营业收入"), true);
});

test("HTML report renders human-readable redacted evidence", () => {
  const html = renderHtmlReport({
    generatedAt: "2026-07-06T00:00:00.000Z",
    generatedBy: "test",
    status: "pass",
    summary: { profiles: 1, pass: 2, fail: 0, blocked: 0, skip: 0, dryRun: 0 },
    config: { proxyUrl: "http://127.0.0.1:7879/mcp" },
    profiles: [{
      id: "main",
      label: "main process",
      expectedRole: "local_dev_full_access",
      status: "pass",
      token: { present: true, env: "LUCY_E2E_MAIN_TOKEN", value: "main-token" },
      precheck: [{ name: "profile_token", status: "pass", message: "ok" }],
      direct: { checks: [{ name: "initialize", status: "pass", httpStatus: 200 }] },
      agent: { checks: [{ name: "agent:kx-income-001", status: "pass", artifactPath: "inbox/artifact.json" }] }
    }]
  });
  assert(html.includes("Lucy P1 Agent 端到端测试报告"));
  assert(html.includes("预检"));
  assert(html.includes("直接 MCP 控制检查"));
  assert(html.includes("Agent 端到端检查"));
  assert(html.includes("agent:kx-income-001"));
  assert.equal(html.includes("main-token"), false);
});

test("dry-run parses selected profile without touching MCP or agent", async () => {
  await withTempDir(async (dir) => {
    const out = path.join(dir, "dry-run.json");
    const html = path.join(dir, "dry-run.html");
    const result = await runNode([SCRIPT, "--profile", "main", "--dry-run", "--out", out, "--html-report", html]);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(await readFile(out, "utf8"));
    assert.equal(evidence.status, "pass");
    assert.equal(evidence.profiles[0].direct.status, "dry-run");
    const report = await readFile(html, "utf8");
    assert(report.includes("Lucy P1 Agent 端到端测试报告"));
  });
});

test("full runner passes against a stub Lucy proxy and fake agent, without leaking token", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startLucyStub();
    const fakeAgent = path.join(dir, "fake-agent.mjs");
    await writeFile(fakeAgent, `
const prompt = process.argv[2] || "";
const text = prompt.includes("data_agent_poc")
  ? "北京时间 2026-05-31 Asia/Shanghai 196,314.31，与事实表一致；190,213.91 是 2026-05-30 的值。source=poc_ad_revenue_daily"
  : prompt.includes("kx-income-001")
    ? "202605 利润表 一、营业收入 本年累计金额 69339.62，source=kx_vw_income_statement_detail"
    : "各区域订单数校验，总订单数 5083，总销售额 16867374，source=superstore_orders";
console.log(JSON.stringify({ type: "result", result: text }));
`, "utf8");
    try {
      const out = path.join(dir, "evidence.json");
      const html = path.join(dir, "evidence.html");
      const artifacts = path.join(dir, "artifacts");
      const commands = JSON.stringify({ main: [process.execPath, fakeAgent, "{prompt}", "{mcpConfig}"] });
      const result = await runNode([
        SCRIPT,
        "--profile", "main",
        "--proxy-url", proxy.url,
        "--out", out,
        "--html-report", html,
        "--artifacts", artifacts,
        "--timeout-ms", "2000",
        "--agent-timeout-ms", "10000"
      ], {
        LUCY_E2E_MAIN_TOKEN: "main-token",
        LUCY_E2E_AGENT_COMMANDS: commands
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const rawEvidence = await readFile(out, "utf8");
      assert.equal(rawEvidence.includes("main-token"), false);
      const evidence = JSON.parse(rawEvidence);
      assert.equal(evidence.status, "pass");
      assert.equal(evidence.profiles[0].direct.status, "pass");
      assert.equal(evidence.profiles[0].agent.status, "pass");
      const report = await readFile(html, "utf8");
      assert(report.includes("agent:kx-income-001"));
      assert.equal(report.includes("main-token"), false);
    } finally {
      await proxy.close();
    }
  });
});

test("missing moz expected role blocks instead of fake-passing", async () => {
  await withTempDir(async (dir) => {
    const out = path.join(dir, "blocked.json");
    const result = await runNode([SCRIPT, "--profile", "moz", "--out", out]);
    assert.equal(result.status, EXIT_CODES.blocked);
    const evidence = JSON.parse(await readFile(out, "utf8"));
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.profiles[0].precheck[0].reason, "missing_expected_role");
  });
});
