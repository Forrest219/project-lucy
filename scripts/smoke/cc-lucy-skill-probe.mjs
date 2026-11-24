#!/usr/bin/env node
/**
 * Optional live probe: Claude Code --strict-mcp-config must get a real
 * lucy_skill_read body (len >= 100). Missing deps => exit 2 blocked.
 * Spec SC-10: docs/specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepoMcpJson, assertMcpClientConfig } from "./mcp-client-config-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIN_CHARS = 100;
const DEFAULT_URL = "http://127.0.0.1:57881/mcp";

function resolveClaudeBin() {
  const preferred = "/Users/forrest/.local/bin/claude";
  if (fs.existsSync(preferred)) return preferred;
  const which = spawnSync("which", ["claude"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split("\n")[0];
  return null;
}

function blocked(reason) {
  console.error(`blocked: ${reason}`);
  process.exit(2);
}

function fail(reason) {
  console.error(`fail: ${reason}`);
  process.exit(1);
}

function toolResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((x) => (x && typeof x === "object" && typeof x.text === "string" ? x.text : ""))
    .join("\n");
}

const token = process.env.LUCY_LOCAL_TOKEN || "";
if (!token) blocked("LUCY_LOCAL_TOKEN unset");

const claudeBin = resolveClaudeBin();
if (!claudeBin) blocked("claude binary not found");

const mcpUrl = process.env.LUCY_PUBLIC_MCP_URL || DEFAULT_URL;
let pathname;
try {
  pathname = new URL(mcpUrl).pathname.replace(/\/+$/, "") || "/";
} catch {
  fail(`invalid LUCY_PUBLIC_MCP_URL: ${mcpUrl}`);
}
if (pathname !== "/mcp") fail(`probe url pathname must be /mcp (got ${pathname})`);

const repoCfg = loadRepoMcpJson(repoRoot);
assertMcpClientConfig(repoCfg);

// Fail closed early when Proxy is unreachable (avoid 180s Claude hang).
{
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cc-lucy-skill-probe", version: "0" }
    }
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream"
      },
      body,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) {
      blocked(`mcp auth failed HTTP ${res.status}`);
    }
    if (!res.ok) blocked(`mcp unreachable HTTP ${res.status}`);
  } catch (err) {
    clearTimeout(timer);
    blocked(`mcp unreachable: ${err && err.name === "AbortError" ? "timeout" : String(err)}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-lucy-skill-probe-"));
const mcpPath = path.join(tmpDir, "mcp.json");
const streamPath = path.join(repoRoot, "inbox/cc-skill-probe/cc-post-fix.stream.jsonl");
fs.mkdirSync(path.dirname(streamPath), { recursive: true });

const mcpConfig = {
  mcpServers: {
    lucy: {
      type: "http",
      url: mcpUrl,
      headers: { Authorization: `Bearer ${token}` }
    }
  }
};
fs.writeFileSync(mcpPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);

const prompt =
  "强制调用 lucy_skill_search(query=杜邦) 再 lucy_skill_read(skill_name=dupont)。" +
  "最终只报告 read 返回字符数与是否含 ROE。不要查数。";

const run = spawnSync(
  claudeBin,
  [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    mcpPath,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions"
  ],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, LUCY_LOCAL_TOKEN: token },
    timeout: 180_000
  }
);

fs.writeFileSync(streamPath, run.stdout || "");
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (run.error) fail(`spawn error: ${run.error.message}`);
if (run.status !== 0) {
  fail(`claude exit ${run.status}; stderr=${(run.stderr || "").slice(0, 500)}; stream=${streamPath}`);
}

let readChars = 0;
let sawRead = false;
for (const line of String(run.stdout || "").split("\n")) {
  if (!line.strip()) continue;
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    continue;
  }
  if (ev.type !== "user") continue;
  for (const c of ev.message?.content || []) {
    if (!c || c.type !== "tool_result") continue;
    const text = toolResultText(c.content);
    if (text.includes("name: dupont") || (text.includes("杜邦") && text.includes("ROE"))) {
      sawRead = true;
      readChars = Math.max(readChars, text.length);
    }
  }
}

if (!sawRead || readChars < MIN_CHARS) {
  fail(`lucy_skill_read body too short or missing (chars=${readChars}); stream=${streamPath}`);
}

console.log(`lucy_skill_read_ok content_chars=${readChars} stream=${streamPath}`);
process.exit(0);
