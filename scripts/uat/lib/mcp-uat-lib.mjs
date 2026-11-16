/**
 * P1-37 UAT 共用库：MCP 客户端、分位统计、沙箱令牌读取、容器内只读 SQL。
 * 令牌只在内存里使用，从不打印或落盘。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SANDBOX_DIR = process.env.UAT_WIDE_STATE_DIR ?? path.join(os.tmpdir(), "lucy-uat-wide");

export function loadSandbox() {
  const state = JSON.parse(readFileSync(path.join(SANDBOX_DIR, "state.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(path.join(SANDBOX_DIR, "tokens.json"), "utf8"));
  return { state, tokens };
}

export const parseRpc = (text) => {
  const trimmed = text.replace(/^event: message\ndata: /, "").trim();
  try { return JSON.parse(trimmed); } catch { return { raw: text.slice(0, 300) }; }
};

export function makeClient(url, extraHeaders = {}) {
  async function rpc(token, body, session) {
    const started = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`, ...extraHeaders, ...(session ? { "mcp-session-id": session } : {})
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - started, text, json: parseRpc(text), session: res.headers.get("mcp-session-id") };
  }
  const initBody = (id) => ({
    jsonrpc: "2.0", id, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "lucy-uat", version: "0" } }
  });
  async function open(token) {
    const init = await rpc(token, initBody(`init-${Math.random().toString(36).slice(2, 8)}`));
    await rpc(token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
    return { session: init.session, init };
  }
  async function callTool(token, session, id, name, args) {
    const r = await rpc(token, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, session);
    return { ...r, text: r.json?.result?.content?.[0]?.text ?? "", data: r.json?.result?.data, isError: r.json?.result?.isError === true };
  }
  async function toolNames(token, session) {
    const r = await rpc(token, { jsonrpc: "2.0", id: `list-${Math.random().toString(36).slice(2, 6)}`, method: "tools/list" }, session);
    return (r.json?.result?.tools ?? []).map((t) => t.name);
  }
  return { rpc, initBody, open, callTool, toolNames };
}

export function pct(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10;
}
export function summarize(samples) {
  return {
    n: samples.length, p50: pct(samples, 50), p95: pct(samples, 95), p99: pct(samples, 99),
    max: pct(samples, 100), over30s: samples.filter((ms) => ms > 30_000).length
  };
}

/** 并发上限受控的 map。 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await fn(items[i], i); }
  }));
  return results;
}

/** 在容器内用只读 better-sqlite3 执行查询，返回 JSON 行。SQL 经 stdin 的 JSON 传入，避免转义问题。 */
export function auditQuery(container, sql, params = []) {
  const script = [
    'const D=require("/app/webui/node_modules/better-sqlite3");',
    'const db=new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true});',
    'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{const {sql,params}=JSON.parse(b);console.log(JSON.stringify(db.prepare(sql).all(...params)))});'
  ].join("");
  const out = execFileSync("docker", ["exec", "-i", container, "node", "-e", script], { input: JSON.stringify({ sql, params }), encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return JSON.parse(out);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 沙箱管理员会话（密码从本机 0600 文件读取，不打印）。返回 { api(method, route, body) }。 */
export async function adminSession(state) {
  const password = readFileSync(path.join(SANDBOX_DIR, "admin-password"), "utf8").trim();
  const login = await fetch(`${state.webui}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: state.adminId, password })
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  async function api(method, route, body) {
    const res = await fetch(`${state.webui}${route}`, {
      method, headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  }
  /** 二进制下载（导出包）：返回 { status, buffer, headers }。 */
  async function raw(route) {
    const res = await fetch(`${state.webui}${route}`, { headers: { cookie } });
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buffer, headers: Object.fromEntries(res.headers.entries()), text: buffer.toString("utf8", 0, 300) };
  }
  return { api, raw };
}

export async function healthPolicyVersion(state) {
  const res = await fetch(`${state.webui}/api/health`);
  return (await res.json())?.data?.policy?.policyVersion ?? null;
}

/** 在容器内杀掉 KTX MCP 子进程（入口脚本会拉起新进程）；返回被杀 pid。 */
export function killKtx(container) {
  const out = execFileSync("docker", ["exec", container, "sh", "-c",
    'for p in /proc/[0-9]*; do case "$(tr "\\0" " " < $p/cmdline 2>/dev/null)" in "node /usr/local/bin/ktx"*) echo ${p#/proc/};; esac; done'], { encoding: "utf8" }).trim().split("\n")[0];
  if (!out) throw new Error("ktx process not found");
  execFileSync("docker", ["exec", container, "sh", "-c", `kill -9 ${out}`]);
  return out;
}
