#!/usr/bin/env tsx
/**
 * UAT-SUITE-LARGE-SCHEMA runner (cases UAT-SCALE-01…10). Real WebUI HTTP API, real KTX, real Doris/Hive/MySQL.
 *
 *   cd webui && npx tsx ../scripts/uat/run-large-schema-ingestion.mts [--out DIR]
 *
 * Prerequisites: demo Docker up; `bash scripts/uat/seed-large-schema-fixtures.sh all`.
 * Secrets: login file path only; passwords are never printed or written to the result file.
 * Exit code: 0 all required cases PASS, 1 any FAIL, 2 BLOCKED (fixtures/environment missing).
 *
 * Budgets are the Spec lucy-20261115-large-schema-ingestion-spec.md §4 values. Do not lower the scale floor.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { stringify } from "yaml";
import { readCheckedTableColumns } from "../../webui/src/lib/prepareSchemaStructure";

const BASE = process.env.LUCY_UAT_WEBUI_URL ?? "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_E2E_WEBUI_LOGIN_FILE ?? "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-login.txt";
const LUCY_CONTAINER = process.env.UAT_LUCY_CONTAINER ?? "compose-lucy-1";

const MYSQL = {
  host: process.env.UAT_DB_HOST ?? "demo-db",
  port: Number(process.env.UAT_DB_PORT ?? 3306),
  database: process.env.UAT_SCALE_MYSQL_DB ?? "uat_scale_mysql",
  user: process.env.UAT_DEMO_DB_USER ?? "root",
  password: process.env.UAT_DEMO_DB_PASSWORD ?? "lucy_demo_root",
  tables: Number(process.env.UAT_SCALE_MYSQL_TABLES ?? 1200),
  wideCols: Number(process.env.UAT_SCALE_MYSQL_WIDE_COLS ?? 1000)
};
const HIVE = {
  catalog: process.env.UAT_SCALE_DORIS_CATALOG ?? "hive_scale",
  schema: process.env.UAT_SCALE_HIVE_DB ?? "uat_scale_hive",
  user: process.env.UAT_SCALE_DORIS_USER ?? "uat_scale_ro",
  password: process.env.UAT_SCALE_DORIS_PASS ?? "uat_scale_pw",
  network: process.env.UAT_SCALE_HIVE_NET ?? "lucy-uat-hive",
  dorisFe: process.env.UAT_DORIS_FE_CONTAINER ?? "lucy-uat-doris-fe",
  tables: Number(process.env.UAT_SCALE_HIVE_TABLES ?? 600),
  cols: Number(process.env.UAT_SCALE_HIVE_COLS ?? 30),
  wide: (process.env.UAT_SCALE_HIVE_WIDE ?? "1500 1999 2000 3000 5000").split(/\s+/).map(Number)
};

/** Spec §4 budgets. */
const B = {
  listMs: 5_000,
  singleTableMs: 3_000,
  diff20Ms: 5_000,
  ingest600Ms: 60_000,
  wideTableMs: 10_000,
  httpMaxMs: 20_000,
  mergeTotalMs: 5_000,
  mergeStepMs: 200,
  validateMs: 20_000,
  missingTableMs: 5_000
};
const BATCH = 50;

type Verdict = "PASS" | "FAIL" | "BLOCKED";
type CaseResult = { id: string; verdict: Verdict; detail: string; metrics: Record<string, unknown> };
const results: CaseResult[] = [];
const outDirArg = process.argv.indexOf("--out");
const outDir = outDirArg > -1 ? process.argv[outDirArg + 1] : path.resolve(process.cwd(), "..", "inbox", `uat-large-schema-${new Date().toISOString().slice(0, 10)}`);

function record(id: string, verdict: Verdict, detail: string, metrics: Record<string, unknown> = {}) {
  results.push({ id, verdict, detail, metrics });
  console.log(`${verdict.padEnd(7)} ${id}  ${detail}`);
}

function loadLogin(): { adminId: string; password: string } {
  if (!existsSync(LOGIN_FILE)) throw new Error(`login file missing: ${LOGIN_FILE}`);
  const lines = readFileSync(LOGIN_FILE, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Labelled file: 地址：… / 姓名：… / 密码：… (full-width or ASCII colon). Positional file: adminId, spare, password.
  const labelled = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^([^：:]+)[：:]\s*(.*)$/);
    if (m) labelled.set(m[1].trim(), m[2].trim());
  }
  // 姓名 is a display name on some machines; LUCY_E2E_WEBUI_ADMIN_ID pins the real admin id.
  const adminId = process.env.LUCY_E2E_WEBUI_ADMIN_ID ?? labelled.get("管理员") ?? labelled.get("adminId") ?? labelled.get("姓名");
  const password = labelled.get("密码") ?? labelled.get("password");
  if (adminId && password) return { adminId, password };
  if (lines.length < 3) throw new Error("login file needs adminId and password");
  return { adminId: lines[0], password: lines[2] };
}

let cookie = "";
async function api(method: string, url: string, body?: unknown): Promise<{ status: number; ms: number; json: any }> {
  const t = performance.now();
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ms: Math.round(performance.now() - t), json };
}

function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function login() {
  const creds = loadLogin();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds)
  });
  cookie = cookieFrom(res);
  if (!res.ok || !cookie) throw new Error(`login failed status=${res.status}`);
}

function dockerIp(container: string, network: string): string {
  const out = execFileSync("docker", ["inspect", container, "--format", `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`], { encoding: "utf8" });
  return out.trim();
}

async function createConnection(id: string, body: Record<string, unknown>) {
  const res = await api("POST", "/api/connections", { id, dryRun: false, acknowledgeSeparateConnection: true, ...body });
  if (res.status >= 400 || res.json?.ok === false) {
    throw new Error(`create ${id} failed: ${JSON.stringify(res.json).slice(0, 300)}`);
  }
}
async function removeConnection(id: string) {
  await api("POST", `/api/connections/${encodeURIComponent(id)}/remove`, { dryRun: false }).catch(() => undefined);
}

/** LS-24 / Task 6: same pass criteria as `large-schema-ingestion-ls24.test.mjs`. */
export function judgeReadTables(
  result: { done: number; columns: number; failure: string },
  expectedTables: number,
  expectedColumnsMin: number
): { pass: boolean; reason: string } {
  if (result.failure) return { pass: false, reason: `request failed: ${result.failure}` };
  if (result.done !== expectedTables) return { pass: false, reason: `done=${result.done} < expected=${expectedTables}` };
  if (result.columns < expectedColumnsMin) return { pass: false, reason: `columns=${result.columns} < min=${expectedColumnsMin}` };
  return { pass: true, reason: "ok" };
}

/**
 * Read `tables` like `readCheckedTableColumns`: batches, deferred retries, halve on all-deferred.
 * `done` counts only tables that actually returned column data (not deferred-only advancement).
 */
async function readTables(conn: string, schema: string, tables: string[], budgetMs: number) {
  const start = performance.now();
  let done = 0;
  let columns = 0;
  let maxCallMs = 0;
  let calls = 0;
  let mode: "batch" | "single" = "batch";
  let failure = "";
  let batchSize = BATCH;
  const strikes = new Map<string, number>();
  let pending = [...tables];
  while (pending.length > 0) {
    if (performance.now() - start > budgetMs) break;
    const slice =
      mode === "batch"
        ? pending.slice(0, Math.min(batchSize, BATCH))
        : [pending[0]];
    const res = await api("POST", `/api/connections/${encodeURIComponent(conn)}/schema-structure`, { schema, tables: slice });
    calls += 1;
    maxCallMs = Math.max(maxCallMs, res.ms);
    if (res.status === 400 && mode === "batch" && slice.length > 1 && /一次只读取一张表/.test(JSON.stringify(res.json))) {
      mode = "single";
      calls -= 1;
      continue;
    }
    if (res.status >= 400 || res.json?.ok === false) {
      failure = `HTTP ${res.status} ${res.json?.error?.message ?? ""}`.trim();
      break;
    }
    const data = res.json?.data ?? {};
    const deferred: string[] = data.deferred ?? [];
    const rejections: Array<{ table: string }> = data.rejections ?? [];
    const deferredSet = new Set(deferred);
    const dropped: string[] = [];
    for (const t of deferred) {
      if (slice.length === 1) {
        const count = (strikes.get(t) ?? 0) + 1;
        strikes.set(t, count);
        if (count >= 2) {
          failure = `表「${t}」这次没有读完，请稍后重试。`;
          dropped.push(t);
          deferredSet.delete(t);
        }
      } else {
        strikes.delete(t);
      }
    }
    const allDeferred =
      deferredSet.size > 0 &&
      rejections.length === 0 &&
      slice.every((t) => deferredSet.has(t) || dropped.includes(t));
    if (allDeferred && deferredSet.size > 0) {
      batchSize = Math.max(1, Math.ceil(batchSize / 2));
    }
    let batchRead = 0;
    for (const name of slice) {
      if (deferredSet.has(name) || rejections.some((r) => r.table === name) || dropped.includes(name)) continue;
      done += 1;
      batchRead += 1;
    }
    if (batchRead > 0) columns += Number(data.columnCount ?? 0);
    if (rejections.length > 0) {
      failure = rejections.map((r) => `${r.table}:${(r as { message?: string }).message ?? "rejected"}`).join("; ");
      break;
    }
    pending = [...deferredSet, ...pending.slice(slice.length)];
    if (failure) break;
    if (calls > 200) {
      failure = "too many schema-structure calls";
      break;
    }
  }
  if (!failure && done < tables.length) {
    failure = `stopped at ${done}/${tables.length} before budget or completion`;
  }
  return { done, columns, calls, mode, maxCallMs, ms: Math.round(performance.now() - start), failure };
}

function syntheticTable(table: string, cols: number): string {
  const columns: Record<string, unknown> = {};
  for (let j = 0; j < cols; j++) columns[`c${j}`] = { type: j % 3 === 0 ? "number" : "string", description: "" };
  return stringify({ [table]: { columns } }).replace(/^(?=.)/gm, "  ");
}

/**
 * 09: the real client read path (`readCheckedTableColumns`) with the server stubbed by prebuilt batch
 * responses, so only client-side parse/accumulate/serialise time is measured. No login, no fixtures.
 */
async function caseClientMerge() {
  const names = Array.from({ length: 600 }, (_, i) => `t_${String(i + 1).padStart(4, "0")}`);
  const prebuilt = new Map(names.map((name) => [name, syntheticTable(name, 30)]));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const tables = (JSON.parse(init?.body ?? "{}") as { tables: string[] }).tables;
    const data = {
      schema: "dw",
      readable: true,
      yaml: `tables:\n${tables.map((table) => prebuilt.get(table)).join("")}`,
      tableCount: tables.length,
      columnCount: tables.length * 30,
      namesOnly: false,
      mapped: { number: tables.length * 10, string: tables.length * 20, time: 0 },
      downgraded: []
    };
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 });
  }) as typeof fetch;
  let maxStep = 0;
  let last = performance.now();
  const start = last;
  let tableCount = 0;
  let failure = "";
  try {
    const result = await readCheckedTableColumns("c1", "dw", names, () => {
      const now = performance.now();
      maxStep = Math.max(maxStep, now - last);
      last = now;
    });
    tableCount = result.tableCount;
  } catch (error) {
    failure = (error as Error).message;
  } finally {
    globalThis.fetch = realFetch;
  }
  const ms = Math.round(performance.now() - start);
  const pass = !failure && tableCount === 600 && ms <= B.mergeTotalMs && maxStep <= B.mergeStepMs;
  record("UAT-SCALE-09", pass ? "PASS" : "FAIL", `client read path ${tableCount}/600 tables in ${ms}ms, slowest batch step ${Math.round(maxStep)}ms (budget ${B.mergeTotalMs}ms, step ${B.mergeStepMs}ms)${failure ? ` failure=${failure}` : ""}`, { tableCount, ms, maxStepMs: Math.round(maxStep) });
}

async function main() {
  await caseClientMerge(); // needs no login or server
  await login();
  const health = await api("GET", "/api/health");
  const meta = { gitSha: health.json?.gitSha ?? health.json?.data?.gitSha ?? null, gitDirty: health.json?.gitDirty ?? health.json?.data?.gitDirty ?? null };
  console.log(`container build: ${JSON.stringify(meta)}`);

  const stamp = Date.now().toString(36);
  const myId = `uat-scale-mysql-${stamp}`;
  const hvId = `uat-scale-hive-${stamp}`;
  let hiveHost = "";
  try {
    hiveHost = dockerIp(HIVE.dorisFe, HIVE.network);
  } catch {
    // fixtures not joined to the network
  }
  if (!hiveHost) {
    record("UAT-SCALE-R0", "BLOCKED", `Doris FE ${HIVE.dorisFe} is not on network ${HIVE.network}; run seed-large-schema-fixtures.sh hive`);
    return;
  }

  try {
    await createConnection(myId, { driver: "mysql", host: MYSQL.host, port: MYSQL.port, database: MYSQL.database, username: MYSQL.user, password: MYSQL.password, schemas: [MYSQL.database] });
    await createConnection(hvId, { driver: "mysql", host: hiveHost, port: 9030, database: `${HIVE.catalog}.${HIVE.schema}`, username: HIVE.user, password: HIVE.password, schemas: [HIVE.schema] });
  } catch (e) {
    record("UAT-SCALE-R0", "BLOCKED", String((e as Error).message));
    await removeConnection(myId);
    await removeConnection(hvId);
    return;
  }

  try {
    // R0: fixtures present at the scale floor (names-only read doubles as SCALE-01 / SCALE-05).
    const myNames = await api("POST", `/api/connections/${encodeURIComponent(myId)}/schema-structure`, { schema: MYSQL.database });
    const hvNames = await api("POST", `/api/connections/${encodeURIComponent(hvId)}/schema-structure`, { schema: HIVE.schema });
    const myCount = Number(myNames.json?.data?.tableCount ?? 0);
    const hvCount = Number(hvNames.json?.data?.tableCount ?? 0);
    const myFloor = MYSQL.tables + 1;
    const hvFloor = HIVE.tables + HIVE.wide.length;
    const r0ok = myCount >= myFloor && hvCount >= hvFloor;
    record("UAT-SCALE-R0", r0ok ? "PASS" : "BLOCKED", `mysql tables=${myCount}/${myFloor}, hive tables=${hvCount}/${hvFloor}, build=${JSON.stringify(meta)}`, { myCount, hvCount, ...meta });
    if (!r0ok) return;

    const myTables = Array.from({ length: MYSQL.tables }, (_, i) => `t_${String(i + 1).padStart(5, "0")}`);
    const hvTables = Array.from({ length: HIVE.tables }, (_, i) => `t_${String(i + 1).padStart(4, "0")}`);

    // 01 / 05 table lists
    record("UAT-SCALE-01", myNames.status === 200 && myNames.ms <= B.listMs ? "PASS" : "FAIL", `mysql names ${myCount} tables in ${myNames.ms}ms (budget ${B.listMs}ms)`, { ms: myNames.ms, tables: myCount });
    record("UAT-SCALE-05", hvNames.status === 200 && hvNames.ms <= B.listMs ? "PASS" : "FAIL", `hive names ${hvCount} tables in ${hvNames.ms}ms (budget ${B.listMs}ms)`, { ms: hvNames.ms, tables: hvCount });

    // 02 single table, narrow and 1000 columns
    const narrow = await api("POST", `/api/connections/${encodeURIComponent(myId)}/schema-structure`, { schema: MYSQL.database, tables: [myTables[0]] });
    const wide = await api("POST", `/api/connections/${encodeURIComponent(myId)}/schema-structure`, { schema: MYSQL.database, tables: [`w_${MYSQL.wideCols}`] });
    const ok02 = narrow.status === 200 && wide.status === 200 && Number(wide.json?.data?.columnCount) === MYSQL.wideCols && narrow.ms <= B.singleTableMs && wide.ms <= B.singleTableMs;
    record("UAT-SCALE-02", ok02 ? "PASS" : "FAIL", `mysql single table: 10 cols ${narrow.ms}ms, ${wide.json?.data?.columnCount ?? "?"} cols ${wide.ms}ms (budget ${B.singleTableMs}ms)`, { narrowMs: narrow.ms, wideMs: wide.ms });

    // 03 structure diff at its 20-table limit
    const diffTables = myTables.slice(0, 20).join(",");
    const diff = await api("GET", `/api/connections/${encodeURIComponent(myId)}/table-structure-diff?schema=${MYSQL.database}&tables=${diffTables}`);
    record("UAT-SCALE-03", diff.status === 200 && diff.ms <= B.diff20Ms ? "PASS" : "FAIL", `mysql structure diff of 20 tables: HTTP ${diff.status} in ${diff.ms}ms (budget ${B.diff20Ms}ms)`, { ms: diff.ms, status: diff.status });

    // 04 / 06 ingest 600 tables
    const my600 = await readTables(myId, MYSQL.database, myTables.slice(0, 600), B.ingest600Ms);
    const colsPerTable = 30;
    const j04 = judgeReadTables(my600, 600, 600 * colsPerTable);
    const ok04 = j04.pass && my600.ms <= B.ingest600Ms && my600.maxCallMs <= B.httpMaxMs;
    record("UAT-SCALE-04", ok04 ? "PASS" : "FAIL", `mysql ingest ${my600.done}/600 tables, ${my600.columns} cols (${j04.reason}) in ${my600.ms}ms via ${my600.calls} ${my600.mode} calls, slowest call ${my600.maxCallMs}ms (budget ${B.ingest600Ms}ms, call ${B.httpMaxMs}ms)${my600.failure ? `; ${my600.failure}` : ""}`, my600);
    const hv600 = await readTables(hvId, HIVE.schema, hvTables, B.ingest600Ms);
    const j06 = judgeReadTables(hv600, HIVE.tables, HIVE.tables * HIVE.cols);
    const ok06 = j06.pass && hv600.ms <= B.ingest600Ms && hv600.maxCallMs <= B.httpMaxMs;
    record("UAT-SCALE-06", ok06 ? "PASS" : "FAIL", `hive ingest ${hv600.done}/${HIVE.tables} tables in ${hv600.ms}ms via ${hv600.calls} ${hv600.mode} calls, slowest call ${hv600.maxCallMs}ms${hv600.failure ? `; ${hv600.failure}` : ""}`, hv600);

    // 07 wide external tables
    const wideRows: string[] = [];
    let ok07 = true;
    const wideMetrics: Record<string, unknown> = {};
    for (const n of HIVE.wide) {
      const res = await api("POST", `/api/connections/${encodeURIComponent(hvId)}/schema-structure`, { schema: HIVE.schema, tables: [`w_${n}`] });
      const got = Number(res.json?.data?.columnCount ?? 0);
      const good = res.status === 200 && got === n && res.ms <= B.wideTableMs;
      ok07 = ok07 && good;
      wideRows.push(`${n}:${good ? "ok" : `FAIL(${res.status},${got} cols,${res.ms}ms)`}`);
      wideMetrics[`w_${n}`] = { status: res.status, columns: got, ms: res.ms, message: res.json?.error?.message ?? null };
    }
    record("UAT-SCALE-07", ok07 ? "PASS" : "FAIL", `hive wide tables ${wideRows.join(" ")}`, wideMetrics);

    // 08 missing table is reported fast and by name
    const miss = await api("POST", `/api/connections/${encodeURIComponent(hvId)}/schema-structure`, { schema: HIVE.schema, tables: ["no_such_table"] });
    const missText = JSON.stringify(miss.json);
    record("UAT-SCALE-08", miss.status >= 400 && miss.ms <= B.missingTableMs && missText.includes("no_such_table") ? "PASS" : "FAIL", `missing table: HTTP ${miss.status} in ${miss.ms}ms, names the table=${missText.includes("no_such_table")}`, { status: miss.status, ms: miss.ms });

    // 10 validate a 600 x 30 manifest (validate only; nothing is written)
    const manifestParts: Record<string, unknown> = {};
    for (let i = 0; i < 600; i++) {
      const cols: Record<string, unknown> = {};
      for (let j = 0; j < 30; j++) cols[`c${j}`] = { type: j % 3 === 0 ? "number" : "string", description: "" };
      manifestParts[`t_${String(i + 1).padStart(4, "0")}`] = { columns: cols };
    }
    const content = stringify({ tables: manifestParts });
    const val = await api("POST", "/api/catalog/assets/validate", { connectionId: myId, schema: MYSQL.database, assetKind: "schema_manifest", filename: `${MYSQL.database}.yaml`, content });
    record("UAT-SCALE-10", val.status === 200 && val.json?.data?.valid === true && val.ms <= B.validateMs ? "PASS" : "FAIL", `validate 600x30 manifest (${Math.round(content.length / 1024)} KiB): HTTP ${val.status} valid=${val.json?.data?.valid} in ${val.ms}ms (budget ${B.validateMs}ms)`, { ms: val.ms, status: val.status, valid: val.json?.data?.valid ?? null });
  } finally {
    await removeConnection(myId);
    await removeConnection(hvId);
  }
}

main()
  .catch((e) => record("UAT-SCALE-R0", "BLOCKED", `runner error: ${(e as Error).message}`))
  .finally(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    const fail = results.some((r) => r.verdict === "FAIL");
    const blocked = results.some((r) => r.verdict === "BLOCKED");
    console.log(`\nresult: ${path.join(outDir, "result.json")}`);
    process.exit(fail ? 1 : blocked ? 2 : 0);
  });
