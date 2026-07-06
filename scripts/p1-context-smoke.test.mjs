import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "p1-context-smoke.mjs");

function runNodeAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

async function withTempProject(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p1-context-smoke-"));
  try {
    await writeFixtureProject(dir);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFixtureProject(dir) {
  await mkdir(path.join(dir, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(dir, "semantic-layer", "poc-mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(dir, "wiki", "global"), { recursive: true });

  await writeFile(path.join(dir, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    columns:
      - name: row_id
        type: number
`, "utf8");
  await writeFile(path.join(dir, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"), `name: superstore_orders
grain:
  - row_id
measures:
  - name: total_sales
    expr: sum(sales)
segments:
  - name: active_rows
    expr: is_deleted = 0
`, "utf8");

  await writeFile(path.join(dir, "semantic-layer", "poc-mysql-aliyun", "_schema", "data_agent_poc.yaml"), `tables:
  poc_ceo_metric_snapshot:
    table: data_agent_poc.poc_ceo_metric_snapshot
    columns:
      - name: snapshot_dt
        type: time
`, "utf8");
  await writeFile(path.join(dir, "semantic-layer", "poc-mysql-aliyun", "poc_ceo_metric_snapshot.yaml"), `name: poc_ceo_metric_snapshot
grain:
  - snapshot_dt
  - metric_code
measures:
  - name: metric_value
    expr: max(metric_value)
segments:
  - name: mock_values
    expr: benchmark_type = 'mock_value'
`, "utf8");

  await writeWiki(path.join(dir, "wiki", "global", "superstore-analysis-playbook.md"), "superstore_orders", "Superstore order_count weighted_discount");
  await writeWiki(path.join(dir, "wiki", "global", "poc-data-agent-playbook.md"), "poc_ceo_metric_snapshot", "CEO一眼报 poc_ceo_metric_snapshot");
  await writeWiki(path.join(dir, "wiki", "global", "kx-financial-analysis-playbook.md"), "kx_fact_financial_amount", "KX 财务 营业收入");
}

async function writeWiki(file, source, body) {
  await writeFile(file, `---
sl_refs:
  - test/${source}
---

# ${body}

${body}
`, "utf8");
}

function startProxyStub() {
  const sockets = new Set();
  const calls = [];
  const tools = [
    { name: "sl_read_source", inputSchema: { type: "object" } },
    { name: "wiki_search", inputSchema: { type: "object" } }
  ];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    calls.push(body);
    res.setHeader("content-type", "application/json");
    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "p1-context-test-session");
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
    if (body.method === "tools/call" && body.params?.name === "sl_read_source") {
      const sourceName = body.params?.arguments?.sourceName;
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `source ${sourceName}` }] } }));
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "wiki_search") {
      const query = body.params?.arguments?.query ?? "";
      const key = query.includes("CEO")
        ? "global/poc-data-agent-playbook.md"
        : query.includes("KX")
          ? "global/kx-financial-analysis-playbook.md"
          : "global/superstore-analysis-playbook.md";
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: key }] } }));
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
    server.once("error", (error) => {
      resolve({
        error,
        url: undefined,
        calls,
        close: async () => {}
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        calls,
        close: () => new Promise((done) => {
          server.closeIdleConnections?.();
          for (const socket of sockets) socket.destroy();
          server.close(done);
        })
      });
    });
  });
}

async function writeFakeKtx(dir) {
  const file = path.join(dir, "fake-ktx.sh");
  await writeFile(file, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "@kaelio/ktx 0.13.0"
  exit 0
fi
if [ "$3" = "admin" ] && [ "$4" = "reindex" ]; then
  echo '{"ok":true,"scopes":["sl/mysql-aliyun","wiki/global"]}'
  exit 0
fi
if [ "$3" = "sl" ]; then
  last=""
  for arg in "$@"; do last="$arg"; done
  echo "{\\"name\\":\\"$last\\"}"
  exit 0
fi
if [ "$3" = "wiki" ]; then
  query="$7"
  case "$query" in
    *CEO*) echo '[{"key":"global/poc-data-agent-playbook.md"}]' ;;
    *KX*) echo '[{"key":"global/kx-financial-analysis-playbook.md"}]' ;;
    *) echo '[{"key":"global/superstore-analysis-playbook.md"}]' ;;
  esac
  exit 0
fi
echo "unexpected fake ktx args: $@" >&2
exit 2
`, "utf8");
  await chmod(file, 0o755);
  return file;
}

test("static context smoke passes required checks and records skipped runtime", async () => {
  await withTempProject(async (dir) => {
    const outFile = path.join(dir, "inbox", "evidence.json");
    const result = await runNodeAsync(["scripts/p1-context-smoke.mjs", "--root", dir, "--out", outFile]);
    assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.status, "partial");
    assert.equal(evidence.checks.semanticInventory, "pass");
    assert.equal(evidence.checks.semanticSourceReadability, "pass");
    assert.equal(evidence.checks.wikiPlaybooks, "pass");
    assert.equal(evidence.checks.ktxRuntime, "skipped");
    assert.equal(evidence.checks.proxyRuntime, "skipped");
    assert.deepEqual(evidence.summary.skippedRuntime, ["ktxRuntime", "proxyRuntime"]);
  });
});

test("static context smoke fails closed when a required wiki playbook is missing", async () => {
  await withTempProject(async (dir) => {
    const outFile = path.join(dir, "inbox", "evidence.json");
    const result = await runNodeAsync([
      "scripts/p1-context-smoke.mjs",
      "--root", dir,
      "--wiki", "global/missing-playbook.md",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.checks.wikiPlaybooks, "fail");
    assert.equal(evidence.checkDetails.wikiPlaybooks.failed[0].key, "global/missing-playbook.md");
  });
});

test("context smoke can validate Lucy proxy sl_read_source and wiki_search", async () => {
  await withTempProject(async (dir) => {
    const proxy = await startProxyStub();
    if (proxy.error) {
      assert.equal(proxy.error.code, "EPERM");
      return;
    }
    try {
      const outFile = path.join(dir, "inbox", "evidence.json");
      const result = await runNodeAsync([
        "scripts/p1-context-smoke.mjs",
        "--root", dir,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--out", outFile
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.proxyRuntime, "pass");
      assert.equal(evidence.checks.ktxRuntime, "skipped");
      assert.deepEqual(evidence.checkDetails.proxyRuntime.missingTools, []);
      assert.equal(evidence.checkDetails.proxyRuntime.slReads.length, 2);
      assert.equal(evidence.checkDetails.proxyRuntime.wikiSearches.length, 3);
      assert(proxy.calls.some((call) => call.params?.name === "sl_read_source"));
      assert(proxy.calls.some((call) => call.params?.name === "wiki_search"));
    } finally {
      await proxy.close();
    }
  });
});

test("context smoke records blocked proxy evidence when URL is provided without token", async () => {
  await withTempProject(async (dir) => {
    const outFile = path.join(dir, "inbox", "evidence.json");
    const result = await runNodeAsync([
      "scripts/p1-context-smoke.mjs",
      "--root", dir,
      "--proxy-url", "http://127.0.0.1:1/mcp",
      "--out", outFile
    ], {
      LUCY_P1_PROXY_TOKEN: "",
      LUCY_LOCAL_TOKEN: ""
    });
    assert.equal(result.status, 1);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.checks.proxyRuntime, "blocked");
    assert.equal(evidence.checkDetails.proxyRuntime.reason, "incomplete_proxy_configuration");
  });
});

test("context smoke can run ktx runtime checks with a provided ktx binary", async () => {
  await withTempProject(async (dir) => {
    const fakeKtx = await writeFakeKtx(dir);
    const outFile = path.join(dir, "inbox", "evidence.json");
    const result = await runNodeAsync([
      "scripts/p1-context-smoke.mjs",
      "--root", dir,
      "--with-ktx",
      "--ktx-bin", fakeKtx,
      "--out", outFile
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.checks.ktxRuntime, "pass");
    assert.equal(evidence.checks.proxyRuntime, "skipped");
    assert.equal(evidence.checkDetails.ktxRuntime.slReads.length, 2);
    assert.equal(evidence.checkDetails.ktxRuntime.wikiSearches.length, 3);
  });
});
