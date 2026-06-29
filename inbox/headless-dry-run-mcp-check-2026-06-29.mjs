const proxyPort = process.env.LUCY_DEMO_PROXY_HOST_PORT ?? "57891";
const token = process.env.LUCY_DEMO_AGENT_TOKEN ?? "lucy-demo-agent-token";

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) throw new Error(`missing SSE data: ${text}`);
  return JSON.parse(data);
}

async function rpc(sessionId, method, params, { allowError = false } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await res.text();
  const body = parseRpcBody(text);
  if (!allowError && (!res.ok || body?.error)) {
    throw new Error(`${method} failed: HTTP ${res.status} ${JSON.stringify(body?.error ?? body)}`);
  }
  return { res, body };
}

const init = await rpc("", "initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "lucy-headless-dry-run", version: "0.1.0" }
});
const sessionId = init.res.headers.get("mcp-session-id");
if (!sessionId) throw new Error("initialize did not return mcp-session-id");
await rpc(sessionId, "notifications/initialized", {}, { allowError: true });

const list = await rpc(sessionId, "tools/list", {});
const names = (list.body?.result?.tools ?? []).map((tool) => tool.name).sort();
const required = ["kx_catalog", "sl_query", "sl_read_source", "wiki_search"];
const missing = required.filter((name) => !names.includes(name));
if (missing.length) throw new Error(`missing required tools: ${missing.join(", ")}`);
if (names.includes("sql_execution")) throw new Error("denied sql_execution appeared in tools/list");
console.log(`tools/list: ${names.join(", ")}`);

const read = await rpc(sessionId, "tools/call", {
  name: "sl_read_source",
  arguments: { connectionId: "demo-mysql", sourceName: "superstore_orders" }
});
const readText = JSON.stringify(read.body?.result ?? {});
if (!readText.includes("total_sales") || !readText.includes("active_rows")) {
  throw new Error("sl_read_source did not include expected demo semantic-layer content");
}
console.log("sl_read_source: ok");

const query = await rpc(sessionId, "tools/call", {
  name: "sl_query",
  arguments: {
    connectionId: "demo-mysql",
    measures: ["superstore_orders.total_sales"],
    dimensions: [{ field: "superstore_orders.region" }],
    segments: ["superstore_orders.active_rows"],
    limit: 5,
    include: ["sql"]
  }
});
const rows = query.body?.result?.structuredContent?.rows;
if (!Array.isArray(rows) || rows.length !== 4) {
  throw new Error(`sl_query expected 4 rows, got ${Array.isArray(rows) ? rows.length : "none"}`);
}
console.log(`sl_query: ${rows.length} rows`);

console.log("acl filter: sql_execution absent from tools/list");
