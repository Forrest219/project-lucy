#!/usr/bin/env node
/**
 * UAT-SCAN-EXT-03-DUAL — plain Hive catalog + Kerberos hive_jd column read via WebUI API.
 * Creates temporary connections, asserts columnCount>=1 on both, then removes them.
 * Secrets: login file / env only; never printed.
 */
import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

const BASE = process.env.LUCY_UAT_WEBUI_URL ?? "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_E2E_WEBUI_LOGIN_FILE ??
  "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
const DB_HOST = process.env.UAT_DORIS_HOST ?? "doris-lab-2014-fe-1";
const DB_PORT = Number(process.env.UAT_DORIS_PORT ?? 9030);
const DB_USER = process.env.UAT_DORIS_USER ?? "root";
const DB_PASSWORD = process.env.UAT_DORIS_PASSWORD ?? "";

const PLAIN = {
  id: `uat-ext-hive-${Date.now().toString(36)}`,
  database: process.env.UAT_PLAIN_DB ?? "hive.dw",
  schema: process.env.UAT_PLAIN_SCHEMA ?? "dw",
  table: process.env.UAT_PLAIN_TABLE ?? "dw_sim_001_i_h"
};
const KRB = {
  id: `uat-ext-hivejd-${Date.now().toString(36)}`,
  database: process.env.UAT_KRB_DB ?? "hive_jd.app",
  schema: process.env.UAT_KRB_SCHEMA ?? "app",
  table: process.env.UAT_KRB_TABLE ?? "app_ad_sim_001_stat_i_d"
};

function loadLogin(file) {
  if (!existsSync(file)) throw new Error(`login file missing: ${file}`);
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("login file needs at least adminId + password");
  // Prefer (line2, line3) when 3+ lines — matches lucy-docker-demo-webui.txt shape.
  if (lines.length >= 3) return { adminId: lines[1], password: lines[2] };
  return { adminId: lines[0], password: lines[1] };
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

async function login() {
  const cred = loadLogin(LOGIN_FILE);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
  });
  const json = await res.json().catch(() => ({}));
  const cookie = cookieFrom(res);
  if (!res.ok || json.ok === false || !cookie) {
    throw new Error(`login failed status=${res.status}`);
  }
  return cookie;
}

async function createConn(cookie, target) {
  const body = {
    id: target.id,
    driver: "mysql",
    host: DB_HOST,
    port: DB_PORT,
    database: target.database,
    username: DB_USER,
    password: DB_PASSWORD,
    schemas: [target.schema],
    dryRun: false,
    acknowledgeSeparateConnection: true,
    acknowledgeDifferentDatabase: true
  };
  const res = await fetch(`${BASE}/api/connections`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return {
    step: "create",
    id: target.id,
    database: target.database,
    status: res.status,
    ok: json.ok === true,
    executionRuntimeAck: json.data?.executionRuntimeAck ?? null,
    testStatus: json.data?.test?.status ?? null,
    err: json.ok === true ? null : String(json.error?.message ?? json.message ?? "").slice(0, 200)
  };
}

async function liveTables(cookie, target) {
  const t0 = performance.now();
  const url = `${BASE}/api/connections/${encodeURIComponent(target.id)}/live-tables?schema=${encodeURIComponent(target.schema)}`;
  const res = await fetch(url, { headers: { cookie } });
  const json = await res.json().catch(() => ({}));
  const tables = json.data?.tables ?? json.data ?? [];
  const names = Array.isArray(tables)
    ? tables.map((t) => t.name ?? t.table ?? t).filter(Boolean)
    : [];
  return {
    step: "live-tables",
    id: target.id,
    status: res.status,
    ok: json.ok !== false && res.ok,
    ms: Math.round(performance.now() - t0),
    tableCount: names.length,
    hasTarget: names.includes(target.table)
  };
}

async function schemaStructure(cookie, target) {
  const t0 = performance.now();
  const res = await fetch(
    `${BASE}/api/connections/${encodeURIComponent(target.id)}/schema-structure`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ schema: target.schema, tables: [target.table] })
    }
  );
  const json = await res.json().catch(() => ({}));
  const data = json.data ?? {};
  return {
    step: "schema-structure",
    id: target.id,
    table: target.table,
    status: res.status,
    ok: json.ok === true && res.ok,
    ms: Math.round(performance.now() - t0),
    namesOnly: data.namesOnly ?? null,
    columnCount: data.columnCount ?? data.columns?.length ?? null,
    err: json.ok === true ? null : String(json.error?.message ?? json.message ?? "").slice(0, 240)
  };
}

async function removeConn(cookie, id) {
  const res = await fetch(`${BASE}/api/connections/${encodeURIComponent(id)}/remove`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    // API defaults dryRun=true; must force false or connections linger and block schema reuse.
    body: JSON.stringify({ dryRun: false })
  });
  const json = await res.json().catch(() => ({}));
  return { step: "remove", id, status: res.status, ok: json.ok !== false && res.ok };
}

function passOne(struct) {
  return (
    struct.ok &&
    struct.status >= 200 &&
    struct.status < 300 &&
    struct.namesOnly === false &&
    Number(struct.columnCount) >= 1
  );
}

async function exercise(cookie, target, label) {
  const out = { label, database: target.database, schema: target.schema, table: target.table };
  out.create = await createConn(cookie, target);
  if (!out.create.ok) return { ...out, pass: false };
  out.tables = await liveTables(cookie, target);
  out.struct = await schemaStructure(cookie, target);
  out.remove = await removeConn(cookie, target.id);
  out.pass = passOne(out.struct) && out.tables.hasTarget !== false;
  return out;
}

async function main() {
  const cookie = await login();
  const plain = await exercise(cookie, PLAIN, "plain-hive");
  const krb = await exercise(cookie, KRB, "kerberos-hive_jd");
  const dualPass = plain.pass === true && krb.pass === true;
  const summary = {
    case: "UAT-SCAN-EXT-03-DUAL",
    host: DB_HOST,
    port: DB_PORT,
    plainPass: plain.pass,
    krbPass: krb.pass,
    dualPass,
    plain: {
      createOk: plain.create?.ok,
      tables: plain.tables?.tableCount,
      hasTarget: plain.tables?.hasTarget,
      columnCount: plain.struct?.columnCount,
      namesOnly: plain.struct?.namesOnly,
      ms: plain.struct?.ms,
      status: plain.struct?.status,
      err: plain.struct?.err ?? plain.create?.err
    },
    krb: {
      createOk: krb.create?.ok,
      tables: krb.tables?.tableCount,
      hasTarget: krb.tables?.hasTarget,
      columnCount: krb.struct?.columnCount,
      namesOnly: krb.struct?.namesOnly,
      ms: krb.struct?.ms,
      status: krb.struct?.status,
      err: krb.struct?.err ?? krb.create?.err
    },
    cleanup: { plain: plain.remove?.ok ?? null, krb: krb.remove?.ok ?? null }
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!dualPass) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ case: "UAT-SCAN-EXT-03-DUAL", fatal: String(err.message || err) }));
  process.exit(2);
});
