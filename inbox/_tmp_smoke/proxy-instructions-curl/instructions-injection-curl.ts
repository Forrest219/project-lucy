// One-shot manual smoke harness for the instructions-injection code path.
// Starts a mock KTX upstream and a real Lucy MCP proxy on free ports, points
// the proxy at the mock, fires a single `initialize` request, prints the
// proxy's response, and exits. Run from the project root with:
//
//   KTX_PROJECT_ROOT=/Users/forrest/Projects/project-lucy \
//   LUCY_PROXY_PORT=8790 LUCY_PROXY_UPSTREAM_PORT=8791 \
//   LUCY_AUDIT_DB=/tmp/lucy-instructions-smoke.sqlite \
//   npx tsx webui/server/__smoke__/instructions-injection-curl.ts
//
// It will:
//   1) print the upstream request the proxy sent (auth header sanity check)
//   2) print the proxy response body (instructions field replaced)
//   3) exit 0 on success, non-zero on assertion failure

import { createServer } from "node:http";
import { rmSync } from "node:fs";

const PROXY_PORT = Number(process.env.LUCY_PROXY_PORT ?? 8790);
const UPSTREAM_PORT = Number(process.env.LUCY_PROXY_UPSTREAM_PORT ?? 8791);

// Use a smoke-only access.yaml with a known token (NOT a production token).
const SMOKE_TOKEN = "proxy-instructions-curl-smoke-token";
const SMOKE_USER_ID = "instructions_smoke_agent";

// Need to materialize access.yaml under <KTX_PROJECT_ROOT>/webui/config before
// the proxy starts. We use a throwaway PROJECT_ROOT for this smoke run.
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const smokeProjectRoot = mkdtempSync(path.join(tmpdir(), "lucy-instructions-smoke-"));
mkdirSync(path.join(smokeProjectRoot, "webui", "config"), { recursive: true });
mkdirSync(path.join(smokeProjectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
writeFileSync(path.join(smokeProjectRoot, "ktx.yaml"), "connections: {}\n", "utf8");

// Read the real data-qa-instructions.md so the proxy has something to inject.
import { readFileSync } from "node:fs";
const realInstructionsPath = "/Users/forrest/Projects/project-lucy/webui/config/data-qa-instructions.md";
const realInstructions = readFileSync(realInstructionsPath, "utf-8");
writeFileSync(path.join(smokeProjectRoot, "webui", "config", "data-qa-instructions.md"), realInstructions, "utf-8");

// access.yaml needs a token that hashes to a known value. Compute it.
import { createHash } from "node:crypto";
const tokenHash = "sha256:" + createHash("sha256").update(SMOKE_TOKEN).digest("hex");
const realAccessYaml = `users:
  - id: ${SMOKE_USER_ID}
    name: Instructions Smoke
    enabled: true
    role: kx_readonly
    tokens:
      - hash: "${tokenHash}"
        label: smoke-token
        created: 2026-06-23
defaults:
  deny_tools: []
`;
writeFileSync(path.join(smokeProjectRoot, "webui", "config", "access.yaml"), realAccessYaml, "utf-8");
writeFileSync(
  path.join(smokeProjectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
  "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
  "utf-8"
);

process.env.KTX_PROJECT_ROOT = smokeProjectRoot;
process.env.LUCY_PROXY_PORT = String(PROXY_PORT);
process.env.LUCY_PROXY_HOST = "127.0.0.1";
process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
process.env.LUCY_PROXY_UPSTREAM_PORT = String(UPSTREAM_PORT);
process.env.LUCY_AUDIT_DB = "/tmp/lucy-instructions-smoke.sqlite";
delete process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;

try { rmSync(process.env.LUCY_AUDIT_DB); } catch {}

async function main(): Promise<number> {
  const upstreamSeen: { authorization?: string; body: string }[] = [];
  const upstream = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      upstreamSeen.push({ authorization: req.headers.authorization, body });
      res.writeHead(200, { "content-type": "application/json" });
      // Intentionally return a response WITHOUT instructions so the proxy
      // can prove it injected them.
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "smoke-1",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "mock-ktx", version: "0.0.1" },
          capabilities: { tools: {} }
          // no `instructions` field
        }
      }));
    });
  });

  await new Promise<void>((r) => upstream.listen(UPSTREAM_PORT, "127.0.0.1", r));
  const { buildProxy } = await import("../proxy/mcp-proxy.js");
  const { server, host } = buildProxy();
  await new Promise<void>((r) => server.listen(PROXY_PORT, host, r));

  try {
    const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SMOKE_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "smoke-1",
        method: "initialize",
        params: { clientInfo: { name: "manual-curl-smoke" } }
      })
    });

    const text = await res.text();
    console.log("=== upstream received ===");
    console.log(JSON.stringify(upstreamSeen, null, 2));
    console.log("=== proxy response (status " + res.status + ") ===");
    console.log(text);

    if (res.status !== 200) {
      console.error("FAIL: expected 200, got " + res.status);
      return 1;
    }
    const body = JSON.parse(text) as { result?: { instructions?: string; serverInfo?: { name: string } } };
    if (!body.result?.instructions) {
      console.error("FAIL: result.instructions is empty or missing");
      return 1;
    }
    if (body.result.instructions.trim() !== realInstructions.trim()) {
      console.error("FAIL: result.instructions does not match data-qa-instructions.md content");
      console.error("got first 200 chars:", body.result.instructions.slice(0, 200));
      return 1;
    }
    console.log("\nPASS: instructions field is populated and matches data-qa-instructions.md");
    console.log("      instructions length:", body.result.instructions.length, "chars");
    console.log("      serverInfo preserved:", body.result.serverInfo);
    return 0;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => upstream.close(() => r()));
  }
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("smoke harness crashed:", err);
  process.exit(1);
});
