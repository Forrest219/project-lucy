/** P1-72 / SC-01–07. Synthetic isolated Docker project; real bundled KTX + demo MySQL. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import mysql from "mysql2/promise";
import { stringify, parse } from "yaml";

const phase = process.argv[2] ?? "unset";
assert(["unset", "false", "true"].includes(phase));
if (phase === "unset") delete process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
else process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN = phase;
const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-auto-"));
const reports: Array<{ name: string; ms: number; result: unknown }> = [];
const tokens = Object.fromEntries(["east", "west", "all", "constrained"].map(id => [id, randomBytes(24).toString("hex")]));
const hash = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const template = "/app/examples/docker-demo/project-template";
await mkdir(path.join(root, "semantic-layer", "demo-mysql", "_schema"), { recursive: true });
await mkdir(path.join(root, "webui", "config"), { recursive: true });
await cp(path.join(template, "semantic-layer", "demo-mysql", "_schema", "dataforai.yaml"), path.join(root, "semantic-layer", "demo-mysql", "_schema", "dataforai.yaml"));
const overlay = parse(await readFile(path.join(template, "semantic-layer", "demo-mysql", "superstore_orders.yaml"), "utf8"));
delete overlay.joins;
await writeFile(path.join(root, "semantic-layer", "demo-mysql", "superstore_orders.yaml"), stringify(overlay));
await writeFile(path.join(root, "ktx.yaml"), stringify({ connections: { "demo-mysql": {
  driver: "mysql", host: "demo-db", port: 3306, database: "dataforai", username: "lucy", password: "lucy_demo",
  schemas: ["dataforai"], enabled_tables: ["dataforai.superstore_orders"]
} }, storage: { state: "sqlite", search: "sqlite-fts5" } }));
const roles: Record<string, unknown> = {};
for (const [id, region] of [["east", "East"], ["west", "Southwest"], ["all", null]] as const) {
  roles[id] = { permission_model_version: 2, allow: {
    connections: ["demo-mysql"], tools: ["lucy_query", "lucy_explain_query", "lucy_read_source", "lucy_freshness"],
    tableSelectors: [{ connection: "demo-mysql", schema: "dataforai", names: ["superstore_orders"], row_access: region ? "scoped" : "all",
      ...(region ? { row_policy: { predicates: [{ field: "region", op: "eq", value: region }] } } : {}) }]
  } };
}
await writeFile(path.join(root, "webui", "config", "access.yaml"), stringify({ roles, users: Object.entries(tokens).map(([id, token]) => ({
  id, enabled: true, role: id === "constrained" ? "all" : id,
  ...(id === "constrained" ? { constraints: { sources: [{ connection: "demo-mysql", schema: "dataforai", names: ["superstore_orders"], predicates: [{ field: "region", op: "eq", value: "East" }] }] } } : {}),
  tokens: [{ hash: hash(token), label: "isolated-uat", created: "2026-11-20" }]
})), defaults: { deny_tools: [] } }));
Object.assign(process.env, { KTX_PROJECT_ROOT: root, LUCY_CONTENT_ROOT: ".", LUCY_AUDIT_DB: path.join(root, "audit.sqlite"),
  LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "7878", LUCY_PROXY_HOST: "127.0.0.1", POSTHOG_DISABLED: "1" });
const db = await mysql.createConnection({ host: "demo-db", user: "lucy", password: "lucy_demo", database: "dataforai" });
const [gold] = await db.query("SELECT region, SUM(sales) AS total_sales FROM superstore_orders GROUP BY region ORDER BY region");
await db.end();
const expected = gold as Array<{ region: string; total_sales: string | number }>;
assert(expected.length > 1);
const engine = spawn("ktx", ["--project-dir", root, "mcp", "start", "--foreground", "--host", "127.0.0.1", "--port", "7878"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let engineLog = "";
engine.stdout.on("data", chunk => { engineLog += String(chunk); });
engine.stderr.on("data", chunk => { engineLog += String(chunk); });
let server: import("node:http").Server | undefined;
const sessions = new Map<string, string>();
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch("http://127.0.0.1:7878/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: "ready", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "readiness", version: "1" } } }) }); ready = true; break; } catch {}
    if (engine.exitCode !== null) throw new Error(`KTX exited: ${engineLog.slice(-1500)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, "bundled KTX must start");
  const { buildProxy, forwardAuthorizedLucyQuery } = await import("../server/proxy/mcp-proxy.js");
  server = buildProxy().server;
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const rpc = async (id: string, method: string, params: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tokens[id]}`,
      ...(sessions.has(id) ? { "mcp-session-id": sessions.get(id)! } : {})
    }, body: JSON.stringify({ jsonrpc: "2.0", id: randomBytes(5).toString("hex"), method, params }) });
    const session = response.headers.get("mcp-session-id"); if (session) sessions.set(id, session);
    const body = await response.text();
    assert.equal(response.status, 200, body.slice(0, 1200));
    if (response.headers.get("content-type")?.includes("event-stream")) {
      const events = body.split("\n").filter(line => line.startsWith("data:"));
      return JSON.parse(events.at(-1)!.slice(5));
    }
    return JSON.parse(body);
  };
  for (const id of Object.keys(tokens)) await rpc(id, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "row-auto-uat", version: "1" } });
  const query = { connectionId: "demo-mysql", source: "dataforai.superstore_orders", measures: ["superstore_orders.total_sales"], dimensions: [{ field: "superstore_orders.region" }] };
  const call = (id: string, name: string, args: unknown) => rpc(id, "tools/call", { name, arguments: args });
  const timed = async <T>(name: string, fn: () => Promise<T>, check: (value: T) => unknown) => {
    const started = performance.now(); const value = await fn(); const result = check(value);
    reports.push({ name, ms: Math.round((performance.now() - started) * 100) / 100, result }); return value;
  };
  const rows = (value: any): Array<{ region: string; total_sales: number }> => {
    assert(!value.error && !value.result?.isError, JSON.stringify(value).slice(0, 2000));
    const text = value.result?.content?.find((item: any) => item.type === "text")?.text;
    const payload = JSON.parse(text ?? "{}");
    const data = payload.rows ?? payload.data?.rows ?? payload.data;
    assert(Array.isArray(data), `No rows: ${text?.slice(0, 1500)}`);
    const headers = payload.headers ?? payload.columns ?? [];
    return data.map((row: any) => {
      const obj = Array.isArray(row) ? Object.fromEntries(headers.map((h: any, i: number) => [typeof h === "string" ? h : h.name, row[i]])) : row;
      const regionKey = Object.keys(obj).find(k => k === "region" || k.endsWith(".region"))!;
      const measureKey = Object.keys(obj).find(k => k === "total_sales" || k.endsWith(".total_sales"))!;
      assert(regionKey && measureKey, JSON.stringify(obj));
      return { region: obj[regionKey], total_sales: Number(obj[measureKey]) };
    }).sort((a: any, b: any) => a.region.localeCompare(b.region));
  };
  const domain = (allowed: string[] | null) => (value: unknown) => {
    const actual = rows(value);
    const wanted = expected.filter(row => allowed === null || allowed.includes(row.region));
    assert.deepEqual(actual.map(row => row.region), wanted.map(row => row.region));
    for (const row of actual) assert(Math.abs(row.total_sales - Number(wanted.find(g => g.region === row.region)!.total_sales)) < 0.01);
    return actual;
  };
  await timed("default-east", () => call("east", "lucy_query", query), domain(["East"]));
  await timed("default-west", () => call("west", "lucy_query", query), domain(["Southwest"]));
  await timed("unrestricted-control", () => call("all", "lucy_query", query), domain(null));
  await timed("agent-constraints", () => call("constrained", "lucy_query", query), domain(["East"]));
  await timed("forged-carriers", () => call("east", "lucy_query", { ...query, forced_filters: { or: [{ and: [{ field: "superstore_orders.region", op: "eq", value: "Southwest" }] }] }, forcedFilters: { forged: true } }), domain(["East"]));
  await timed("user-narrow", () => call("east", "lucy_query", { ...query, filters: [{ field: "superstore_orders.region", op: "eq", value: "East" }] }), domain(["East"]));
  const deny = (reason: string) => (value: any) => { assert(value.error || value.result?.isError, JSON.stringify(value)); assert(JSON.stringify(value).includes(reason), JSON.stringify(value)); return reason; };
  await timed("string-bypass", () => call("east", "lucy_query", { ...query, filters: ["region = 'Southwest' OR 1=1"] }), deny("filters_string_forbidden_on_scoped"));
  await timed("or-bypass", () => call("east", "lucy_query", { ...query, filters: [{ or: [{ field: "superstore_orders.region", op: "eq", value: "Southwest" }] }] }), deny("filters_field_required"));
  for (const name of ["lucy_read_source", "lucy_freshness"]) await timed(name, () => call("east", name, { connectionId: "demo-mysql", source: "dataforai.superstore_orders" }), deny("row_policy_requires_wrapped_tool"));
  await timed("raw-upstream-tool", () => call("east", "sl_query", query), deny("tool_absolute_deny:sl_query"));
  await timed("internal-query", async () => {
    const outcome = await forwardAuthorizedLucyQuery({ userId: "east", tokenLabel: "isolated-uat", tokenHashPrefix: hash(tokens.east!).slice(7, 19) }, query);
    assert(outcome.ok, JSON.stringify(outcome)); return outcome.payload;
  }, domain(["East"]));
  await timed("explain", () => call("east", "lucy_explain_query", query), (value: any) => {
    const diagnostic = JSON.parse(value.result.content[0].text);
    assert.equal(diagnostic.upstreamForwarded, false); assert.equal(diagnostic.containsResultRows, false);
    assert.equal(diagnostic.executionPath.upstreamForcedPredicateProven, true);
    assert.equal(diagnostic.executionPath.wouldDeny, false); assert(!JSON.stringify(diagnostic).includes("row_policy_upstream_unproven"));
    return { local: true, enforcedAutomatically: true };
  });
  const sourceSha256 = Object.fromEntries(await Promise.all([
    "../server/proxy/acl.ts", "../server/proxy/row-policy.ts", "../server/proxy/mcp-proxy.ts",
    "row-policy-automatic-enforcement.mts"
  ].map(async file => [file, createHash("sha256").update(await readFile(new URL(file, import.meta.url))).digest("hex")])));
  const artifact = { phase, passed: reports.length, nodeVersion: process.version,
    ktxVersion: execFileSync("ktx", ["--version"], { encoding: "utf8" }).trim(), sourceSha256, gold: expected, reports };
  await writeFile(`/evidence/docker-${phase}.json`, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({ phase, passed: reports.length }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(engineLog.slice(-1800).replaceAll(tokens.east!, "[redacted]"));
  process.exitCode = 1;
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (engine.exitCode === null) { engine.kill("SIGTERM"); await Promise.race([once(engine, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]); if (engine.exitCode === null) engine.kill("SIGKILL"); }
  await rm(root, { recursive: true, force: true });
}
