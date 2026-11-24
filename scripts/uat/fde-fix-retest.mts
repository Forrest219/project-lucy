#!/usr/bin/env node
/** P1-57 real HTTP/client/SQL UAT. Credentials stay in memory or a private directory outside inbox. */
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import mysql from "../../webui/node_modules/mysql2/promise.js";
import { readCheckedTableColumns } from "../../webui/src/lib/prepareSchemaStructure";
import { startMysqlFaultProxy } from "./lib/mysql-fault-proxy.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "inbox/uat-p157-20261119/live"); mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i < 0 ? undefined : args[i + 1]; };
const IMAGE = opt("image");
const BASE = "http://127.0.0.1:55457", MCP = "http://127.0.0.1:58057/mcp";
const NAME = "lucy-uat-p157", VOL = "lucy-uat-p157-data";
const docker = (a: string[]) => execFileSync("docker", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const compose = parse(readFileSync(path.join(ROOT, "deploy/compose/docker-compose.demo.yml"), "utf8"));
const sqlPassword = String(compose.services["demo-db"].environment.MYSQL_ROOT_PASSWORD);
const db = await mysql.createConnection({ host: "127.0.0.1", port: 53306, user: "root", password: sqlPassword });
const results: any[] = [], wire: any[] = [], attempts: any[] = [];
let cookie = "", mode = "off", session = "";
let delay = 0, clientCalls = 0;
const connections: string[] = [];
let dorisAdmin: Awaited<ReturnType<typeof mysql.createConnection>> | undefined;
let temporaryDorisUser = false;
const record = (id: string, pass: boolean, detail: unknown, level = "real") => {
  const row = { id, verdict: pass ? "PASS" : "FAIL", level, detail };
  results.push(row); console.log(JSON.stringify(row)); flush();
};
function flush() { writeFileSync(path.join(OUT, "result.json"), JSON.stringify({ at: new Date().toISOString(), image: IMAGE, results, attempts, wire }, null, 2)); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function seed(database: string, count: number, wide: number, wideCount: number, narrow = 30) {
  await db.query(`CREATE DATABASE IF NOT EXISTS ${database}`);
  for (let i = 0; i < count; i++) {
    const cols = i < wideCount ? wide : narrow;
    await db.query(`CREATE TABLE IF NOT EXISTS ${database}.t${i} (${Array.from({ length: cols }, (_, c) => `c${c} TINYINT`).join(",")}) ENGINE=MyISAM`);
  }
  const [facts] = await db.query<any[]>("SELECT COUNT(DISTINCT table_name) tables_count,COUNT(*) columns_count FROM information_schema.columns WHERE table_schema=?", [database]);
  const expected = wideCount * wide + (count - wideCount) * narrow;
  assert(Number(facts[0].tables_count) === count && Number(facts[0].columns_count) === expected, "fixture counts differ");
  attempts.push({ step: "seed", database, tables: count, columns: expected, engine: "MyISAM" }); flush();
}
await seed("uat_fde_wide", 50, 400, 50);
await seed("uat_fde_mix", 30, 10, 30);
await seed("uat_fde_progress", 600, 1500, 50);
if (args.includes("--seed-only")) { await db.end(); flush(); process.exit(0); }
assert(IMAGE, "--image required after fixture seeding");

const secrets = mkdtempSync(path.join(os.tmpdir(), "lucy-p157-secrets-")); chmodSync(secrets, 0o700);
const bootstrapToken = randomBytes(24).toString("hex"), password = "UatP157!" + randomBytes(24).toString("hex");
writeFileSync(path.join(secrets, "bootstrap"), bootstrapToken, { mode: 0o600 });
writeFileSync(path.join(secrets, "login.json"), JSON.stringify({ adminId: "uatp157", password }), { mode: 0o600 });

async function api(route: string, body?: unknown) {
  const start = performance.now();
  const res = await fetch(BASE + route, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25_000) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const json = (res.headers.get("content-type") ?? "").includes("json") ? JSON.parse(bytes.toString()) : null;
  return { status: res.status, data: json?.data, error: json?.error, bytes, ms: Math.round(performance.now() - start) };
}
async function create(id: string, database: string, port: number, upstream = "host.docker.internal", username = "root", pw = sqlPassword) {
  const r = await api("/api/connections", { id, driver: "mysql", host: upstream, port, database, username, password: pw, schemas: [database.split(".").at(-1)], dryRun: false, acknowledgeSeparateConnection: true });
  assert(r.status === 200 && r.data?.written, `connection create ${id}: ${r.status}/${r.error?.code}`); connections.push(id);
}
const proxies: Awaited<ReturnType<typeof startMysqlFaultProxy>>[] = [];
async function read(id: string, schema: string, tables: string[], onProgress?: (done: number) => void) {
  const original = globalThis.fetch, calls: any[] = [];
  globalThis.fetch = async (input, init) => {
    const begin = performance.now();
    const headers = new Headers(init?.headers); headers.set("cookie", cookie);
    const response = await original(typeof input === "string" && input.startsWith("/") ? BASE + input : input, { ...init, headers, signal: AbortSignal.timeout(22_000) });
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ size: body.tables?.length, ms: Math.round(performance.now() - begin), status: response.status });
    return response;
  };
  let result: any, error: any;
  try { result = await readCheckedTableColumns(id, schema, tables, (done) => onProgress?.(done)); }
  catch (e) { error = e; }
  finally { globalThis.fetch = original; }
  assert(calls.every((r) => r.ms <= 20_000), "single HTTP response exceeded 20s");
  return { result, error, calls };
}
try {
  try { docker(["inspect", NAME]); throw new Error("existing UAT container must be resolved before rerun"); }
  catch (e) { if (!(e instanceof Error) || e.message.includes("existing UAT")) throw e; }
  docker(["volume", "create", VOL]);
  docker(["run", "--rm", "--user", "0", "--entrypoint", "sh", "-v", `${VOL}:/data/lucy`, IMAGE, "-c", "mkdir -p /data/lucy/config && chown -R 10001:10001 /data/lucy"]);
  docker(["run", "-d", "--name", NAME, "--network", "compose_default", "-p", "55457:5174", "-p", "58057:7879", "-v", `${VOL}:/data/lucy`, "-v", `${path.join(secrets, "bootstrap")}:/run/secrets/webui_bootstrap_token:ro`,
    "-e", "LUCY_TEMPLATE_ROOT=/app/examples/docker-demo/project-template", "-e", "LUCY_CONTENT_ROOT=/data/lucy/config", "-e", "LUCY_DEPLOYMENT_MODE=customer", "-e", "LUCY_WEBUI_TEST_PROFILE=1", "-e", "LUCY_WEBUI_COOKIE_SECURE=0", "-e", "LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE=/run/secrets/webui_bootstrap_token", "-e", `LUCY_PUBLIC_MCP_URL=${MCP}`, IMAGE]);
  let health: any;
  for (let i = 0; i < 150; i++) { try { health = await api("/api/health"); if (health.status === 200) break; } catch {} await pause(1000); }
  assert(health?.status === 200, "new container not healthy");
  record("UAT-FDE-FIX-R0", health.data.gitDirty === false, { gitSha: health.data.gitSha, gitDirty: health.data.gitDirty, imageId: docker(["inspect", NAME, "--format", "{{.Image}} "]).trim(), architecture: docker(["image", "inspect", IMAGE, "--format", "{{.Architecture}}"]).trim() });
  const auth = await fetch(BASE + "/api/auth/bootstrap", { method: "POST", headers: { "content-type": "application/json", "x-lucy-bootstrap-token": bootstrapToken }, body: JSON.stringify({ adminId: "uatp157", displayName: "UAT P157", password }) });
  cookie = auth.headers.getSetCookie().map((v) => v.split(";")[0]).join("; "); assert(auth.ok && cookie, `bootstrap ${auth.status}`);

  const source = readFileSync(path.join(ROOT, "scripts/smoke/p0-demo-docker-smoke.mjs"), "utf8");
  const bearer = source.match(/const demoToken = process\.env\.LUCY_DEMO_AGENT_TOKEN \?\? "([^"]+)"/)?.[1];
  async function rpc(method: string, params: unknown) {
    const r = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}`, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: ++clientCalls }), method, params }), signal: AbortSignal.timeout(20_000) });
    session = r.headers.get("mcp-session-id") ?? session;
    const text = await r.text(), data = text.split("\n").find((v) => v.startsWith("data: "));
    return { status: r.status, body: text ? JSON.parse(data ? data.slice(6) : text) : null };
  }
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "uat-p157", version: "1" } });
  await rpc("notifications/initialized", {}); const tools = await rpc("tools/list", {});
  const query = await rpc("tools/call", { name: "lucy_query", arguments: { connectionId: "demo-mysql", measures: ["superstore_orders.total_sales"], dimensions: [{ field: "superstore_orders.region" }], segments: ["superstore_orders.active_rows"], limit: 5 } });
  const rows = query.body?.result?.structuredContent?.rows ?? [];
  const gold = JSON.parse(readFileSync(path.join(ROOT, "examples/docker-demo/mysql/_baseline.json"), "utf8")).sales_by_region;
  const queryOk = init.status === 200 && tools.status === 200 && rows.length === 4 && rows.every(([region, value]: any[]) => Math.abs(Number(value) - Number(gold[region])) < 0.001);
  record("UAT-FDE-FIX-08", queryOk, { initialize: init.status, instructionsLength: init.body?.result?.instructions?.length ?? 0, rows, expected: gold });
  const exports = [];
  for (const route of ["export-v2", "export-pack-v2"]) {
    const r = await api(`/api/admin/audit/${route}?mode=complete`);
    exports.push({ route, status: r.status, error: r.error, bytes: r.bytes.length, sha256: createHash("sha256").update(r.bytes).digest("hex") });
  }
  record("UAT-FDE-FIX-01", exports.every((r) => r.status === 200), { initialization: "fresh volume, normal bootstrap, real MCP query; no baseline writes", exports });

  const mysqlProxy = await startMysqlFaultProxy({ host: "127.0.0.1", port: 53306, record: (e) => wire.push(e), decide: (sql: string) => {
    const metadata = /FROM information_schema\.(tables|columns)/i.test(sql);
    const selected = [...sql.matchAll(/'(t\d+)'/g)].map((m) => m[1]);
    const refusal = mode === "mix" && /FROM information_schema.columns/i.test(sql) && selected.includes("t0");
    return { delayMs: metadata ? delay : 0, ...(refusal ? { errorCode: 1142, message: "command denied to UAT table t0" } : {}), evidence: { mode, selected, metadata, fault: refusal ? "D5-permission" : null } };
  } }); proxies.push(mysqlProxy);
  await create("uat-fde-wide", "uat_fde_wide", mysqlProxy.port);
  mode = "wide"; delay = 6000;
  const wide = await read("uat-fde-wide", "uat_fde_wide", Array.from({ length: 50 }, (_, i) => `t${i}`), (done) => { if (done > 0) delay = 0; });
  record("UAT-FDE-FIX-04-wide", wide.result?.tableCount === 50 && wide.result?.columnCount === 20000, { tables: wide.result?.tableCount, columns: wide.result?.columnCount, error: wide.error?.message, calls: wide.calls }, "real SQL + authorized latency");
  await api("/api/connections/uat-fde-wide/remove", { dryRun: false });

  // First attempt real metadata permissions. MySQL hides t0 rather than reporting a table error.
  const naturalPw = randomBytes(24).toString("hex");
  await db.query("CREATE USER IF NOT EXISTS 'uat_fde_natural'@'%' IDENTIFIED BY ?", [naturalPw]);
  await db.query("ALTER USER 'uat_fde_natural'@'%' IDENTIFIED BY ?", [naturalPw]);
  for (let i = 1; i < 30; i++) await db.query(`GRANT SELECT ON uat_fde_mix.t${i} TO 'uat_fde_natural'@'%'`);
  mode = "off"; delay = 0;
  await create("uat-fde-natural", "uat_fde_mix", mysqlProxy.port, "host.docker.internal", "uat_fde_natural", naturalPw);
  const hidden = await api("/api/connections/uat-fde-natural/schema-structure", { schema: "uat_fde_mix", tables: ["t0"] });
  attempts.push({ step: "R1 real permission construction", status: hidden.status, errorCode: hidden.error?.code, detail: hidden.error?.detail, boundary: "information_schema hides the denied table; cannot trigger permission-refusal split" });
  await api("/api/connections/uat-fde-natural/remove", { dryRun: false });
  await create("uat-fde-mix", "uat_fde_mix", mysqlProxy.port);
  mode = "mix"; delay = 6000;
  const mixed = await read("uat-fde-mix", "uat_fde_mix", Array.from({ length: 30 }, (_, i) => `t${i}`), (done) => { if (done > 0) delay = 0; });
  record("UAT-FDE-FIX-04-mixed", mixed.error?.data?.partial?.tableCount === 29 && /有 1 张表没有读到字段/.test(mixed.error?.message ?? ""), { tables: mixed.error?.data?.partial?.tableCount, columns: mixed.error?.data?.partial?.columnCount, error: mixed.error?.message, calls: mixed.calls }, "受控降级 D5: t0 permission refusal, 29 tables from real MySQL");
  await api("/api/connections/uat-fde-mix/remove", { dryRun: false });

  mode = "progress"; delay = 6000;
  await create("uat-fde-progress", "uat_fde_progress", mysqlProxy.port);
  const progress = await read("uat-fde-progress", "uat_fde_progress", Array.from({ length: 600 }, (_, i) => `t${i}`), (done) => { if (done > 0) delay = 0; });
  record("UAT-FDE-FIX-06", progress.result?.tableCount === 600 && progress.result?.columnCount === 91500 && progress.calls.length > 100, { tables: progress.result?.tableCount, columns: progress.result?.columnCount, error: progress.error?.message, calls: progress.calls }, "real SQL + authorized latency");

  let hiveMode = "off";
  // Preserve the API password requirement; use a temporary lab principal.
  const hiveUser = process.env.UAT_DORIS_USER ?? "uat_fde_p157";
  const hivePassword = process.env.UAT_DORIS_PASSWORD ?? randomBytes(24).toString("hex");
  if (!process.env.UAT_DORIS_USER) {
    dorisAdmin = await mysql.createConnection({ host: "127.0.0.1", port: 19030, user: "root" });
    await dorisAdmin.query("CREATE USER IF NOT EXISTS 'uat_fde_p157'@'%' IDENTIFIED BY '" + hivePassword + "'");
    await dorisAdmin.query("SET PASSWORD FOR 'uat_fde_p157'@'%' = PASSWORD('" + hivePassword + "')");
    temporaryDorisUser = true;
    await dorisAdmin.query("GRANT SELECT_PRIV ON hive.dw.* TO 'uat_fde_p157'@'%'");
  }
  const hiveTable = "dw_sim_001_i_h";
  const hiveProxy = await startMysqlFaultProxy({ host: "127.0.0.1", port: 19030, record: (e) => wire.push(e), decide: (sql: string) => {
    const target = sql.match(/`([^`]+)`\s*$/)?.[1] ?? "";
    const desc = /^DESC\s/i.test(sql), show = /^SHOW COLUMNS\s/i.test(sql);
    const targeted = target === hiveTable;
    const refused = targeted && ((hiveMode === "slow" && (desc || show)) || (hiveMode === "budget" && (desc || show)));
    const wait = !targeted ? 0 : hiveMode === "slow" ? (desc ? 7100 : 100) : hiveMode === "budget" ? 6000 : hiveMode === "timeout" ? 9000 : 0;
    return { delayMs: wait, ...(refused ? { errorCode: 1064, message: "You have an error in your SQL syntax (UAT controlled refusal)" } : {}), evidence: { mode: `hive-${hiveMode}`, table: target, fault: refused ? "D5-syntax" : null } };
  } }); proxies.push(hiveProxy);
  await create("uat-fde-hive", "hive.dw", hiveProxy.port, "host.docker.internal", hiveUser, hivePassword);
  const plain = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw", tables: [hiveTable] });
  attempts.push({ step: "F02 real dialect attempt", status: plain.status, columnCount: plain.data?.columnCount, boundary: "lab DESC succeeds; the first-two-syntax refusal state cannot be naturally induced" });
  hiveMode = "slow";
  const slow = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw", tables: [hiveTable] });
  hiveMode = "timeout";
  const timeout = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw", tables: [hiveTable] });
  hiveMode = "budget";
  const deferred = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw", tables: [hiveTable] });
  const names = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw" });
  const other = Object.keys(parse(names.data.yaml).tables).find((name) => name !== hiveTable)!;
  assert(other, "need a second real Hive table");
  const continued = await read("uat-fde-hive", "dw", [hiveTable, other]);
  record("UAT-FDE-FIX-03", deferred.status === 200 && deferred.data?.deferred?.includes(hiveTable) && continued.error?.data?.partial?.tableCount === 1 && /有 1 张表/.test(continued.error?.message ?? ""), { firstStatus: deferred.status, deferred: deferred.data?.deferred, ms: deferred.ms, other, completedTables: continued.error?.data?.partial?.tableCount, columns: continued.error?.data?.partial?.columnCount, error: continued.error?.message, calls: continued.calls }, "受控降级 D5: specified syntax refusals + delay, successful fields from real Hive");
  hiveMode = "off"; await hiveProxy.close();
  const closed = await api("/api/connections/uat-fde-hive/schema-structure", { schema: "dw", tables: [hiveTable] });
  record("UAT-FDE-FIX-02", plain.status === 200 && plain.data?.columnCount > 0 && slow.status === 200 && slow.data?.columnCount === plain.data.columnCount && slow.ms < 10000 && timeout.status >= 400 && closed.status >= 400, { plain: { status: plain.status, columns: plain.data?.columnCount }, slow: { status: slow.status, columns: slow.data?.columnCount, ms: slow.ms }, timeout: { status: timeout.status, ms: timeout.ms }, closed: { status: closed.status } }, "受控降级 D5: first two syntax refusals; successful third syntax from real Hive; real proxy shutdown control");
} catch (error) {
  record("UAT-FDE-FIX-RUN", false, { error: error instanceof Error ? error.message : String(error) });
} finally {
  mode = "off"; delay = 0;
  for (const id of connections.reverse()) { try { await api(`/api/connections/${id}/remove`, { dryRun: false }); } catch {} }
  for (const proxy of proxies) await proxy.close();
  if (temporaryDorisUser) { try { await dorisAdmin?.query("DROP USER 'uat_fde_p157'@'%'"); } catch {} }
  await dorisAdmin?.end();
  try { await db.query("DROP USER IF EXISTS 'uat_fde_natural'@'%'"); } catch {}
  await db.end(); flush();
  // Leave only the isolated instance and private login path for the remaining UAT steps.
  console.log(JSON.stringify({ privateLoginFile: path.join(secrets, "login.json"), container: NAME, output: OUT }));
}
process.exitCode = results.some((r) => r.verdict === "FAIL") ? 1 : 0;
