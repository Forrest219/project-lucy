#!/usr/bin/env node
/**
 * Live API UAT for UAT-SCAN-MYSQL-01/02 against demo Docker.
 * Creates a temporary connection to uat_wide_scan, pulls live-schemas,
 * runs schema-structure, then removes the connection.
 * Secrets: read from env or login file paths; never printed.
 */
import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

const BASE = process.env.LUCY_UAT_WEBUI_URL ?? "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_E2E_WEBUI_LOGIN_FILE ??
  "/Users/forrest/Projects/config-for-agents/lucywebui logi.txt";
const DB_PASSWORD = process.env.UAT_DEMO_DB_PASSWORD ?? "lucy_demo_root";
const DB_HOST = process.env.UAT_DB_HOST ?? "demo-db";
const DB_PORT = Number(process.env.UAT_DB_PORT ?? 3306);
const WIDE_DB = process.env.UAT_WIDE_DB ?? "uat_wide_scan";
const MIN_TABLES = Number(process.env.UAT_WIDE_TABLE_COUNT ?? 200);
const connId = `uat-scan-wide-${Date.now().toString(36)}`;

function loadLogin(file) {
  if (!existsSync(file)) throw new Error(`login file missing: ${file}`);
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) throw new Error("login file needs adminId, spare, password");
  return { adminId: lines[0], password: lines[2] };
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single.split(/,(?=[^;]+?=)/).map((c) => c.split(";")[0].trim()).join("; ");
}

async function main() {
  const login = loadLogin(LOGIN_FILE);
  const jar = { cookie: "" };

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: login.adminId, password: login.password })
  });
  jar.cookie = cookieFrom(loginRes);
  const loginJson = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || loginJson.ok === false) {
    throw new Error(`login failed status=${loginRes.status}`);
  }
  if (!jar.cookie) throw new Error("login did not set cookie");

  const headers = {
    "content-type": "application/json",
    cookie: jar.cookie
  };

  const body = {
    id: connId,
    driver: "mysql",
    host: DB_HOST,
    port: DB_PORT,
    database: WIDE_DB,
    username: "root",
    password: DB_PASSWORD,
    schemas: [WIDE_DB],
    dryRun: false,
    acknowledgeSeparateConnection: true
  };

  const createRes = await fetch(`${BASE}/api/connections`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const createJson = await createRes.json();
  console.log(
    JSON.stringify({
      step: "create",
      host: DB_HOST,
      port: DB_PORT,
      status: createRes.status,
      ok: createJson.ok,
      written: createJson.data?.written,
      executionRuntimeAck: createJson.data?.executionRuntimeAck,
      executionRuntimeStatus: createJson.data?.executionRuntimeStatus,
      testStatus: createJson.data?.test?.status,
      connectionId: connId
    })
  );
  if (!createRes.ok || !createJson.ok) {
    throw new Error(`create failed: ${JSON.stringify(createJson).slice(0, 400)}`);
  }

  const schemasUrl = `${BASE}/api/connections/${encodeURIComponent(connId)}/live-schemas?refresh=1&purpose=manual`;
  const t0 = performance.now();
  const schemasRes = await fetch(schemasUrl, { headers: { cookie: jar.cookie } });
  const schemasJson = await schemasRes.json();
  const schemasMs = Math.round(performance.now() - t0);
  const schemas = schemasJson.data?.schemas ?? schemasJson.data ?? [];
  const wide = Array.isArray(schemas)
    ? schemas.find((s) => (s.schema ?? s.name) === WIDE_DB)
    : null;
  console.log(
    JSON.stringify({
      step: "live-schemas",
      status: schemasRes.status,
      ok: schemasJson.ok,
      ms: schemasMs,
      wideTableCount: wide?.tableCount ?? null,
      schemaCount: Array.isArray(schemas) ? schemas.length : null
    })
  );

  const t1 = performance.now();
  const listRes = await fetch(
    `${BASE}/api/connections/${encodeURIComponent(connId)}/schema-structure`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ schema: WIDE_DB })
    }
  );
  const listJson = await listRes.json();
  const listMs = Math.round(performance.now() - t1);
  console.log(
    JSON.stringify({
      step: "schema-structure-names",
      status: listRes.status,
      ok: listJson.ok,
      ms: listMs,
      tableCount: listJson.data?.tableCount ?? null,
      columnCount: listJson.data?.columnCount ?? null,
      namesOnly: listJson.data?.namesOnly ?? null,
      error: listJson.error?.message ?? null
    })
  );

  const t2 = performance.now();
  const colRes = await fetch(
    `${BASE}/api/connections/${encodeURIComponent(connId)}/schema-structure`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ schema: WIDE_DB, tables: ["uat_t0001"] })
    }
  );
  const colJson = await colRes.json();
  const colMs = Math.round(performance.now() - t2);
  console.log(
    JSON.stringify({
      step: "schema-structure-one-table",
      status: colRes.status,
      ok: colJson.ok,
      ms: colMs,
      tableCount: colJson.data?.tableCount ?? null,
      columnCount: colJson.data?.columnCount ?? null,
      namesOnly: colJson.data?.namesOnly ?? null,
      error: colJson.error?.message ?? null
    })
  );

  const removeRes = await fetch(
    `${BASE}/api/connections/${encodeURIComponent(connId)}/remove`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: false })
    }
  );
  const removeJson = await removeRes.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      step: "remove",
      status: removeRes.status,
      ok: removeJson.ok !== false
    })
  );

  const passSchemas =
    schemasRes.ok && schemasJson.ok !== false && (wide?.tableCount ?? 0) >= MIN_TABLES;
  const passList =
    listRes.ok &&
    listJson.ok !== false &&
    listJson.data?.namesOnly === true &&
    (listJson.data?.tableCount ?? 0) >= MIN_TABLES &&
    listMs < 120_000;
  const passCols =
    colRes.ok &&
    colJson.ok !== false &&
    colJson.data?.namesOnly === false &&
    (colJson.data?.columnCount ?? 0) >= 1 &&
    colMs < 120_000;
  const passCreate = createJson.data?.executionRuntimeAck === true;
  const verdict = passCreate && passSchemas && passList && passCols ? "PASS" : "FAIL";
  console.log(
    JSON.stringify({
      step: "verdict",
      verdict,
      passCreate,
      passSchemas,
      passList,
      passCols,
      notes: "no docker restart; wide seed 200 tables"
    })
  );
  if (verdict !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ step: "fatal", message: String(err?.message ?? err) }));
  process.exit(1);
});
