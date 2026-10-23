import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stringify as stringifyYaml } from "yaml";

import {
  EXIT_CODES,
  assertionsFromCase,
  checkTextAssertions,
  isExplicitDenial,
  loadAgentCommands,
  loadEvalCase,
  parseAgentFinalText,
  parseArgs,
  redactValue,
  renderHtmlReport,
  resolveContentRoot,
  stringIncludesLoose
} from "./p1-agent-e2e.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SCRIPT = path.join(ROOT, "scripts", "smoke", "p1-agent-e2e.mjs");

// restricted=true emulates a kx_readonly role: only the kx source / wiki doc is reachable.
// denyStyle: "access_denied" (explicit proxy refusal) | "http500" (infrastructure failure) | "plain_error" (unrelated tool error).
function startLucyStub({ token = "main-token", restricted = false, denyStyle = "access_denied" } = {}) {
  const sockets = new Set();
  const catalogSources = [
    { connectionId: "mysql-aliyun", sourceName: "kx_vw_income_statement_detail" },
    ...(restricted ? [] : [
      { connectionId: "mysql-aliyun", sourceName: "superstore_orders" },
      { connectionId: "poc-mysql-aliyun", sourceName: "poc_ceo_metric_snapshot" },
      { connectionId: "poc-mysql-aliyun", sourceName: "poc_ad_revenue_daily" }
    ])
  ];
  const denied = (res, id) => {
    if (denyStyle === "http500") {
      res.statusCode = 500;
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: "internal error" } }));
      return;
    }
    const text = denyStyle === "plain_error" ? "boom" : "Access denied: not visible to this role";
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text }] } }));
  };
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
        if (restricted && !query.includes("kx")) {
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: JSON.stringify({ results: [] }) }] }
          }));
          return;
        }
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
        if (restricted && !String(args.key || "").includes("kx")) {
          denied(res, body.id);
          return;
        }
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ key: args.key, content: "authorized wiki content" }) }] }
        }));
        return;
      }
      if (name === "lucy_read_source") {
        if (restricted && args.sourceName !== "kx_vw_income_statement_detail") {
          denied(res, body.id);
          return;
        }
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

const CASE_FIXTURES = {
  superstore: {
    id: "superstore-ordercount-002",
    question: "各区域的订单数和总销售额分别是多少？",
    assertion: { value_type: "text", compare_mode: "contains_all", data: { required_phrases: ["5083", "16867374"] } }
  },
  kx_financial: {
    id: "kx-income-001",
    question: "202605 利润表“一、营业收入”的本年累计金额是多少？",
    domain: "kx_financial",
    assertion: { value_type: "text", compare_mode: "contains_all", data: { required_phrases: ["一、营业收入", "69339.62"] } }
  },
  data_agent_poc: {
    id: "data_agent_poc-timezone-utc-display-001",
    question: "dt=2026-05-30T16:00:00.000Z 对应哪个北京时间业务日期？",
    context_required: { keys: ["global/poc-data-agent-playbook.md"], queries: ["data_agent_poc"] },
    assertions: [
      { value_type: "text", compare_mode: "contains_all", data: { required_phrases: ["北京时间 2026-05-31", "Asia/Shanghai", "196,314.31", "190,213.91", "2026-05-30 的值"] } },
      { value_type: "text", compare_mode: "forbids_any", data: { forbidden_phrases: ["2026-05-30T16:00:00.000Z 对应北京时间 2026-05-30"] } }
    ]
  }
};

// Hermetic content root: the harness reads evals from LUCY_CONTENT_ROOT, never from private machine paths.
async function writeContentRoot(dir) {
  const root = path.join(dir, "content");
  for (const [suite, fixture] of Object.entries(CASE_FIXTURES)) {
    const { assertion, assertions, ...rest } = fixture;
    const doc = { cases: [{ case_type: "single_turn", domain: suite, ...rest, result_assertions: assertions ?? [assertion] }] };
    const file = path.join(root, "evals", suite, "eval", `${suite}-eval-cases.yaml`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, stringifyYaml(doc), "utf8");
  }
  return root;
}

test("parseArgs and command JSON validation are strict enough for dry-run", () => {
  const args = parseArgs(["node", SCRIPT, "--profile", "main", "--suite", "data_agent_poc", "--dry-run", "--timeout-ms", "1234"]);
  assert.deepEqual(args.profiles, ["main"]);
  assert.deepEqual(args.suites, ["data_agent_poc"]);
  assert.equal(args.dryRun, true);
  assert.equal(args.timeoutMs, 1234);
  assert.throws(() => loadAgentCommands({ LUCY_E2E_AGENT_COMMANDS: '{"main":"claude"}' }), /string array/);
});

test("case-derived text assertions understand required and forbidden phrases", async () => {
  await withTempDir(async (dir) => {
    const contentRoot = await writeContentRoot(dir);
    const testCase = loadEvalCase("data_agent_poc-timezone-utc-display-001", { contentRoot });
    const assertions = assertionsFromCase(testCase);
    assert(assertions.required.includes("北京时间 2026-05-31"));
    assert(assertions.forbidden.some((phrase) => phrase.includes("2026-05-30")));
    assert.equal(
      checkTextAssertions("北京时间 2026-05-31 Asia/Shanghai 196,314.31 190,213.91 是 2026-05-30 的值", assertions).ok,
      true
    );
    assert.equal(checkTextAssertions("北京时间 2026-05-30", assertions).ok, false);
  });
});

test("content root resolves from option, then LUCY_CONTENT_ROOT, then repo config (no private path)", () => {
  assert.equal(resolveContentRoot("/tmp/explicit", { LUCY_CONTENT_ROOT: "/tmp/env" }), "/tmp/explicit");
  assert.equal(resolveContentRoot(undefined, { LUCY_CONTENT_ROOT: "/tmp/env" }), "/tmp/env");
  assert.equal(resolveContentRoot(undefined, {}), path.join(ROOT, "config"));
  assert.throws(() => loadEvalCase("kx-income-001", { contentRoot: path.join(ROOT, "no-such-content-root") }), /ENOENT/);
});

test("only explicit proxy denials count as a correct deny", () => {
  const denial = { ok: true, status: 200, body: { jsonrpc: "2.0", result: { isError: true, content: [{ type: "text", text: "Access denied: not visible" }] } } };
  assert.equal(isExplicitDenial(denial), true);
  assert.equal(isExplicitDenial({ ok: true, status: 200, body: { error: { code: -32003, message: "Access denied: revoked" } } }), true);
  assert.equal(isExplicitDenial({ ok: true, status: 200, body: { result: { isError: true, content: [{ type: "text", text: "context_not_available" }] } } }), true);
  assert.equal(isExplicitDenial({ ok: false, status: 500, body: { error: { code: -32603, message: "Access denied: spoofed" } } }), false);
  assert.equal(isExplicitDenial({ ok: true, status: 200, body: { result: { isError: true, content: [{ type: "text", text: "boom" }] } } }), false);
  assert.equal(isExplicitDenial({ ok: true, status: 200, body: { result: { content: [{ type: "text", text: "Access denied" }] } } }), false);
  assert.equal(isExplicitDenial({ ok: true, status: 200, body: { parseError: "bad json", raw: "Access denied" } }), false);
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

test("HTML report renders human-readable redacted evidence", async () => {
  await withTempDir(async (dir) => {
    const artifactPath = path.join(dir, "artifact.json");
    await writeFile(artifactPath, JSON.stringify({
      profile: "main",
      caseId: "kx-income-001",
      traceId: "trace-kx-001",
      score: { status: "pass" },
      failureClassification: "pass",
      semanticQueries: [{ toolName: "lucy_query", rowCount: 1, args: { sourceName: "kx_vw_income_statement_detail" } }],
      wikiContextEvidence: [{ key: "global/kx-financial-analysis-playbook.md", title: "KX 财务", snippet: "营业收入口径" }],
      finalAnswer: "202605 营业收入 69339.62"
    }), "utf8");
  const html = renderHtmlReport({
    generatedAt: "2026-07-06T00:00:00.000Z",
    generatedBy: "test",
    status: "pass",
    summary: {
      profiles: 1,
      pass: 2,
      fail: 0,
      blocked: 0,
      skip: 0,
      dryRun: 0,
      passedChecks: 2,
      totalChecks: 2,
      passRate: 1,
      scorePassCases: 1,
      scoreTotalCases: 1,
      scorePassRate: 1,
      tracedCases: 1,
      agentCaseCount: 1,
      traceCoverageRate: 1,
      uniqueTraces: 1,
      traceUniquenessRate: 1,
      artifactCompleteCases: 1,
      artifactTotalCases: 1,
      artifactCompleteness: 1
    },
    config: {
      proxyUrl: "http://127.0.0.1:7879/mcp",
      agentRuntime: "hermes-local-real",
      stub: false,
      traceBaseUrl: "http://127.0.0.1:5174/traces?traceId={traceId}"
    },
    profiles: [{
      id: "main",
      label: "main process",
      expectedRole: "local_dev_full_access",
      status: "pass",
      token: { present: true, env: "LUCY_E2E_MAIN_TOKEN", value: "main-token" },
      precheck: [{ name: "profile_token", status: "pass", message: "ok" }],
      direct: { checks: [{ name: "initialize", status: "pass", httpStatus: 200 }] },
      agent: { checks: [{ name: "agent:kx-income-001", status: "pass", traceId: "trace-kx-001", artifactPath }] }
    }]
  });
  assert(html.includes("Lucy P1 Agent 端到端测试报告"));
  assert(html.includes("通过率"));
  assert(html.includes("100% (2/2 checks)"));
  assert(html.includes("100% (1/1 cases)"));
  assert(html.includes("Trace 覆盖"));
  assert(html.includes("环境 / 版本快照"));
  assert(html.includes("预检"));
  assert(html.includes("Data Catalog"));
  assert(html.includes("Agent 端到端检查"));
  assert(html.includes("hermes-local-real"));
  assert(html.includes("Stub 模式"));
  assert(html.includes("agent:kx-income-001"));
  assert(html.includes("查看 artifact 摘要"));
  assert(html.includes("Semantic Queries"));
  assert(html.includes("KX 财务"));
  assert(html.includes("http://127.0.0.1:5174/traces?traceId=trace-kx-001"));
  assert.equal(html.includes("main-token"), false);
  });
});

test("dry-run parses selected profile without touching MCP or agent, and is never a pass", async () => {
  await withTempDir(async (dir) => {
    const out = path.join(dir, "dry-run.json");
    const html = path.join(dir, "dry-run.html");
    const contentRoot = await writeContentRoot(dir);
    const result = await runNode(
      [SCRIPT, "--profile", "main", "--dry-run", "--out", out, "--html-report", html],
      { LUCY_CONTENT_ROOT: contentRoot }
    );
    assert.equal(result.status, EXIT_CODES.dryRun, result.stderr);
    assert.equal(EXIT_CODES.dryRun, 3);
    const evidence = JSON.parse(await readFile(out, "utf8"));
    assert.equal(evidence.status, "dry_run");
    assert.equal(evidence.exitCode, EXIT_CODES.dryRun);
    assert.equal(evidence.releaseReady, false);
    assert.equal(evidence.profiles[0].status, "dry-run");
    assert.equal(evidence.profiles[0].direct.status, "dry-run");
    assert.equal(evidence.summary.pass, 0);
    assert.equal(evidence.summary.passedChecks, 0);
    assert(evidence.summary.dryRun > 0);
    const report = await readFile(html, "utf8");
    assert(report.includes("Lucy P1 Agent 端到端测试报告"));
  });
});

test("dry-run with missing eval case files is blocked, not a pass", async () => {
  await withTempDir(async (dir) => {
    const out = path.join(dir, "dry-run-blocked.json");
    const result = await runNode(
      [SCRIPT, "--profile", "main", "--dry-run", "--out", out, "--html-report", path.join(dir, "r.html")],
      { LUCY_CONTENT_ROOT: path.join(dir, "empty-content-root") }
    );
    assert.equal(result.status, EXIT_CODES.blocked, result.stderr);
    const evidence = JSON.parse(await readFile(out, "utf8"));
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.profiles[0].precheck.find((check) => check.name === "eval_cases").status, "blocked");
  });
});

test("full runner passes against a stub Lucy proxy and fake agent, without leaking token", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startLucyStub();
    const fakeAgent = path.join(dir, "fake-agent.mjs");
    await writeFile(fakeAgent, `
const prompt = process.argv[2] || "";
const caseId = (prompt.match(/Case id: (\\S+)/) || [])[1] || "unknown";
const text = prompt.includes("data_agent_poc")
  ? "北京时间 2026-05-31 Asia/Shanghai 196,314.31，与事实表一致；190,213.91 是 2026-05-30 的值。source=poc_ad_revenue_daily"
  : prompt.includes("kx-income-001")
    ? "202605 利润表 一、营业收入 本年累计金额 69339.62，source=kx_vw_income_statement_detail"
    : "各区域订单数校验，总订单数 5083，总销售额 16867374，source=superstore_orders";
if (prompt.includes("data_agent_poc")) {
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "wiki-1", name: "wiki_search", input: { query: "data_agent_poc", limit: 5 } }] } }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "wiki-1", content: JSON.stringify({ results: [{ key: "global/poc-data-agent-playbook.md", title: "POC Data Agent Playbook", snippet: "POC 日期字段表示北京时间自然日。" }] }) }] } }));
}
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "q-1", name: "lucy_query", input: { measures: ["m"] } }] } }));
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "q-1", content: JSON.stringify({ rows: [{ value: "ok" }], _meta: { lucy: { traceId: "srv-trace-" + caseId } } }) }] } }));
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
        LUCY_E2E_AGENT_COMMANDS: commands,
        LUCY_CONTENT_ROOT: await writeContentRoot(dir)
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const rawEvidence = await readFile(out, "utf8");
      assert.equal(rawEvidence.includes("main-token"), false);
      const evidence = JSON.parse(rawEvidence);
      assert.equal(evidence.status, "pass");
      assert.equal(evidence.releaseReady, false);
      assert(evidence.runId);
      assert.equal(evidence.profiles[0].direct.status, "pass");
      assert.equal(evidence.profiles[0].agent.status, "pass");
      assert.equal(evidence.summary.traceCoverage, true);
      assert.equal(evidence.summary.traceCoverageRate, 1);
      assert.equal(evidence.summary.traceUniqueness, true);
      assert.equal(evidence.summary.traceUniquenessRate, 1);
      assert.equal(evidence.summary.passRate, 1);
      assert.equal(evidence.summary.passedChecks, evidence.summary.pass);
      assert.equal(evidence.summary.totalChecks, evidence.summary.pass + evidence.summary.fail + evidence.summary.blocked);
      assert.equal(evidence.summary.scorePassRate, 1);
      assert.equal(evidence.summary.scorePassCases, 3);
      assert.equal(evidence.summary.scoreTotalCases, 3);
      assert.equal(evidence.summary.latency.agentCaseCount, 3);
      assert.equal(evidence.summary.contextRequiredCases, 1);
      assert.equal(evidence.summary.contextEvidenceCoverage, true);
      const agentCheck = evidence.profiles[0].agent.checks.find((check) => check.name === "agent:kx-income-001");
      assert(agentCheck.traceId);
      assert.equal(agentCheck.scoreStatus, "pass");
      assert(Number.isFinite(agentCheck.durationMs));
      const pocCheck = evidence.profiles[0].agent.checks.find((check) => check.name === "agent:data_agent_poc-timezone-utc-display-001");
      assert.equal(pocCheck.contextRequired, true);
      assert.equal(pocCheck.wikiContextEvidenceCount, 1);
      const artifact = JSON.parse(await readFile(agentCheck.artifactPath, "utf8"));
      assert.equal(artifact.traceId, agentCheck.traceId);
      assert.equal(agentCheck.traceId, "srv-trace-kx-income-001");
      assert.equal(agentCheck.traceGenerated, false);
      assert.equal(artifact.runId, evidence.runId);
      assert.equal(artifact.score.status, "pass");
      const report = await readFile(html, "utf8");
      assert(report.includes("agent:kx-income-001"));
      assert(report.includes("查看 artifact 摘要"));
      assert(report.includes("评分通过率"));
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

const QUIET_AGENT = `
const prompt = process.argv[2] || "";
console.log(JSON.stringify({ type: "result", result: "202605 利润表 一、营业收入 本年累计金额 69339.62，source=kx_vw_income_statement_detail" }));
`;

const QUERYING_AGENT = `
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "q-1", name: "lucy_query", input: { measures: ["m"] } }] } }));
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "q-1", content: JSON.stringify({ rows: [{ value: "ok" }], _meta: { lucy: { traceId: "srv-trace-kx" } } }) }] } }));
console.log(JSON.stringify({ type: "result", result: "202605 利润表 一、营业收入 本年累计金额 69339.62，source=kx_vw_income_statement_detail" }));
`;

async function runHermesAgainstStub(dir, stubOptions, agentSource = QUERYING_AGENT) {
  const proxy = await startLucyStub({ token: "hermes-token", restricted: true, ...stubOptions });
  try {
    const fakeAgent = path.join(dir, "fake-agent.mjs");
    await writeFile(fakeAgent, agentSource, "utf8");
    const out = path.join(dir, "evidence.json");
    const result = await runNode([
      SCRIPT, "--profile", "hermes", "--suite", "kx_financial",
      "--proxy-url", proxy.url, "--out", out, "--html-report", path.join(dir, "r.html"),
      "--artifacts", path.join(dir, "artifacts"), "--timeout-ms", "2000", "--agent-timeout-ms", "10000"
    ], {
      LUCY_E2E_HERMES_TOKEN: "hermes-token",
      LUCY_E2E_AGENT_COMMANDS: JSON.stringify({ hermes: [process.execPath, fakeAgent, "{prompt}"] }),
      LUCY_CONTENT_ROOT: await writeContentRoot(dir)
    });
    return { result, evidence: JSON.parse(await readFile(out, "utf8")) };
  } finally {
    await proxy.close();
  }
}

test("explicit access denials pass the deny controls", async () => {
  await withTempDir(async (dir) => {
    const { result, evidence } = await runHermesAgainstStub(dir, { denyStyle: "access_denied" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(evidence.status, "pass");
    assert(evidence.summary.accessControl.denyTotal > 0);
    assert.equal(evidence.summary.accessControl.denyPass, evidence.summary.accessControl.denyTotal);
  });
});

test("HTTP 500 and unrelated tool errors are not scored as a correct deny", async () => {
  for (const denyStyle of ["http500", "plain_error"]) {
    await withTempDir(async (dir) => {
      const { result, evidence } = await runHermesAgainstStub(dir, { denyStyle });
      assert.equal(result.status, EXIT_CODES.fail, `${denyStyle}: ${result.stderr}`);
      assert.equal(evidence.status, "fail");
      const denyChecks = evidence.profiles[0].direct.checks.filter((check) => check.name.includes(":deny:") || check.name.startsWith("deny:"));
      assert(denyChecks.some((check) => check.status === "fail"), denyStyle);
      assert.equal(evidence.profiles[0].agent.status, "blocked");
    });
  }
});

test("agent answer without a server query or server trace is not covered or passed", async () => {
  await withTempDir(async (dir) => {
    const { result, evidence } = await runHermesAgainstStub(dir, { denyStyle: "access_denied" }, QUIET_AGENT);
    assert.equal(result.status, EXIT_CODES.fail, result.stderr);
    assert.equal(evidence.status, "fail");
    const check = evidence.profiles[0].agent.checks.find((item) => item.name === "agent:kx-income-001");
    assert.equal(check.status, "fail");
    assert.equal(check.traceGenerated, true);
    assert.equal(check.failureClassification, "missing_server_evidence");
    assert(check.score.failures.some((failure) => failure.includes("no lucy_query result")));
    assert.equal(evidence.summary.tracedCases, 0);
    assert.equal(evidence.summary.traceCoverageRate, 0);
    assert.equal(evidence.summary.traceCoverage, false);
  });
});
