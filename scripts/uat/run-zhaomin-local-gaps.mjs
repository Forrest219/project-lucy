#!/usr/bin/env node
/**
 * Local full-fidelity UAT for the zhaomin gaps that demo Docker can run.
 * Batches: case | gate | reload | all
 * Does not print passwords.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.LUCY_UAT_WEBUI_URL ?? "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_E2E_WEBUI_LOGIN_FILE ??
  "/Users/forrest/Projects/config-for-agents/lucywebui logi.txt";
const DB_PASSWORD = process.env.UAT_DEMO_DB_PASSWORD ?? "lucy_demo_root";
const CAPABILITY = "/data/lucy/.ktx-ui/ktx-reload.capability";
const batch = process.argv[2] ?? "all";

function loadLogin(file) {
  if (!existsSync(file)) throw new Error(`login file missing: ${file}`);
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) throw new Error("login file needs adminId, spare, password");
  return { adminId: lines[0], password: lines[2] };
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((cookie) => cookie.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  if (!single) return "";
  return single.split(/,(?=[^;]+?=)/).map((cookie) => cookie.split(";")[0].trim()).join("; ");
}

function publicError(json) {
  const error = json?.error ?? {};
  return {
    ok: json?.ok ?? null,
    code: error.code ?? json?.code ?? null,
    message: typeof error.message === "string" ? error.message : json?.message ?? null
  };
}

function docker(args, input) {
  return execFileSync("docker", args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function mysql(sql) {
  docker(
    [
      "exec",
      "-i",
      "compose-demo-db-1",
      "mysql",
      "-uroot",
      `-p${DB_PASSWORD}`,
      "-e",
      sql
    ]
  );
}

async function login() {
  const creds = loadLogin(LOGIN_FILE);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: creds.adminId, password: creds.password })
  });
  const cookie = cookieFrom(res);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false || !cookie) {
    throw new Error(`login failed status=${res.status}`);
  }
  return cookie;
}

function headers(cookie) {
  return { "content-type": "application/json", cookie };
}

async function createConnection(cookie, body) {
  const res = await fetch(`${BASE}/api/connections`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function removeConnection(cookie, id) {
  const res = await fetch(`${BASE}/api/connections/${encodeURIComponent(id)}/remove`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ dryRun: false })
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: json.ok !== false };
}

function residualCount(prefix) {
  const out = docker([
    "exec",
    "compose-lucy-1",
    "sh",
    "-c",
    `grep -c '${prefix}' /data/lucy/ktx.yaml 2>/dev/null || true`
  ]).trim();
  return Number(out.split("\n").pop() || "0");
}

async function batchCase(cookie) {
  const id = `uat-case-${Date.now().toString(36)}`;
  mysql(
    "CREATE DATABASE IF NOT EXISTS uat_case_pair; " +
      "CREATE TABLE IF NOT EXISTS uat_case_pair.Foo (id INT PRIMARY KEY, label VARCHAR(8)); " +
      "CREATE TABLE IF NOT EXISTS uat_case_pair.foo (id INT PRIMARY KEY, label VARCHAR(8)); " +
      "CREATE TABLE IF NOT EXISTS uat_case_pair.only_one (id INT PRIMARY KEY);"
  );
  const names = docker([
    "exec",
    "compose-demo-db-1",
    "mysql",
    "-N",
    "-uroot",
    `-p${DB_PASSWORD}`,
    "-e",
    "SELECT table_name FROM information_schema.tables WHERE table_schema='uat_case_pair' ORDER BY table_name;"
  ]).trim();
  const created = await createConnection(cookie, {
    id,
    driver: "mysql",
    host: "demo-db",
    port: 3306,
    database: "uat_case_pair",
    username: "root",
    password: DB_PASSWORD,
    schemas: ["uat_case_pair"],
    dryRun: false,
    acknowledgeSeparateConnection: true
  });
  const report = {
    batch: "case",
    connectionId: id,
    tables: names.split(/\s+/).filter(Boolean),
    create: {
      status: created.status,
      ack: created.json?.data?.executionRuntimeAck ?? null,
      ...publicError(created.json)
    }
  };
  if (created.status !== 200 || created.json?.ok === false) {
    report.verdict = "FAIL";
    console.log(JSON.stringify(report));
    return 1;
  }
  const ambiguousRes = await fetch(`${BASE}/api/connections/${encodeURIComponent(id)}/schema-structure`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ schema: "uat_case_pair", tables: ["Foo"] })
  });
  const ambiguousJson = await ambiguousRes.json().catch(() => ({}));
  const ambiguousText = JSON.stringify(publicError(ambiguousJson));
  report.ambiguous = {
    status: ambiguousRes.status,
    ...publicError(ambiguousJson),
    columnCount: ambiguousJson.data?.columnCount ?? null,
    tableCount: ambiguousJson.data?.tableCount ?? null,
    namesOnly: ambiguousJson.data?.namesOnly ?? null,
    leakedPassword: ambiguousText.includes(DB_PASSWORD)
  };
  const uniqueRes = await fetch(`${BASE}/api/connections/${encodeURIComponent(id)}/schema-structure`, {
    method: "POST",
    headers: headers(cookie),
    body: JSON.stringify({ schema: "uat_case_pair", tables: ["only_one"] })
  });
  const uniqueJson = await uniqueRes.json().catch(() => ({}));
  report.unique = {
    status: uniqueRes.status,
    ok: uniqueJson.ok ?? null,
    columnCount: uniqueJson.data?.columnCount ?? null,
    namesOnly: uniqueJson.data?.namesOnly ?? null
  };
  const diffRes = await fetch(
    `${BASE}/api/connections/${encodeURIComponent(id)}/table-structure-diff?schema=uat_case_pair&tables=only_one,missing_tbl`,
    { headers: { cookie } }
  );
  const diffJson = await diffRes.json().catch(() => ({}));
  const tables = diffJson.data?.tables ?? [];
  report.diff = {
    status: diffRes.status,
    ok: diffJson.ok ?? null,
    onlyOne: tables.find((row) => String(row.table).endsWith("only_one"))?.status ?? null,
    missing: tables.find((row) => String(row.table).endsWith("missing_tbl"))?.status ?? null,
    missingReason: tables.find((row) => String(row.table).endsWith("missing_tbl"))?.reason ?? null
  };
  report.remove = await removeConnection(cookie, id);
  mysql("DROP DATABASE IF EXISTS uat_case_pair;");
  report.residual = residualCount(id);
  const casePass =
    report.ambiguous.status === 400 &&
    String(report.ambiguous.message).includes("对应多张表") &&
    report.ambiguous.leakedPassword === false &&
    report.unique.status === 200 &&
    report.unique.namesOnly === false &&
    (report.unique.columnCount ?? 0) >= 1;
  const diffPass =
    report.diff.status === 200 &&
    report.diff.onlyOne === "ok" &&
    report.diff.missing === "not_in_library";
  report.caseVerdict = casePass ? "PASS" : "FAIL";
  report.diffVerdict = diffPass ? "PASS" : "FAIL";
  report.verdict = casePass && diffPass && report.residual === 0 ? "PASS" : "FAIL";
  console.log(JSON.stringify(report));
  return report.verdict === "PASS" ? 0 : 1;
}

async function batchGate(cookie) {
  const id = `uat-gate-${Date.now().toString(36)}`;
  const created = await createConnection(cookie, {
    id,
    driver: "mysql",
    host: "demo-db",
    port: 3306,
    database: "hive.dw",
    username: "root",
    password: DB_PASSWORD,
    schemas: ["dw"],
    dryRun: false
  });
  const message = publicError(created.json).message ?? "";
  const report = {
    batch: "gate",
    connectionId: id,
    status: created.status,
    ...publicError(created.json),
    residual: residualCount(id)
  };
  report.verdict =
    created.status === 409 &&
    message === "这是另一个外部目录，不会加到已有连接。确认后将新增一张连接卡片。" &&
    report.residual === 0
      ? "PASS"
      : "FAIL";
  console.log(JSON.stringify(report));
  return report.verdict === "PASS" ? 0 : 1;
}

function readCapability() {
  return docker(["exec", "compose-lucy-1", "cat", CAPABILITY]);
}

function writeCapability(text) {
  docker(["exec", "-i", "compose-lucy-1", "sh", "-c", `cat > ${CAPABILITY}`], text.endsWith("\n") ? text : `${text}\n`);
}

function signalSupervisor(pid, signal) {
  const name = signal.startsWith("SIG") ? signal : `SIG${signal}`;
  docker([
    "exec",
    "compose-lucy-1",
    "node",
    "-e",
    `process.kill(${Number(pid)}, ${JSON.stringify(name)})`
  ]);
}

async function batchReload(cookie) {
  const id = `uat-reload-fail-${Date.now().toString(36)}`;
  mysql("CREATE DATABASE IF NOT EXISTS e2e_conn_reload;");
  const original = readCapability();
  const cap = JSON.parse(original);
  const pid = Number(cap.supervisorPid);
  if (!Number.isFinite(pid) || pid <= 0) throw new Error("supervisor pid missing");
  let stopped = false;
  let created = null;
  try {
    cap.state = "reloading";
    cap.heartbeatAt = new Date().toISOString();
    writeCapability(JSON.stringify(cap));
    signalSupervisor(pid, "STOP");
    stopped = true;
    created = await createConnection(cookie, {
      id,
      driver: "mysql",
      host: "demo-db",
      port: 3306,
      database: "e2e_conn_reload",
      username: "root",
      password: DB_PASSWORD,
      schemas: ["e2e_conn_reload"],
      dryRun: false,
      acknowledgeSeparateConnection: true
    });
  } finally {
    if (stopped) {
      try {
        signalSupervisor(pid, "CONT");
      } catch (error) {
        console.error(JSON.stringify({ step: "sigcont", message: String(error.message ?? error) }));
      }
    }
    try {
      writeCapability(original);
    } catch (error) {
      console.error(JSON.stringify({ step: "restore-capability", message: String(error.message ?? error) }));
    }
  }
  const info = publicError(created?.json ?? {});
  let removed = null;
  if (residualCount(id) > 0) removed = await removeConnection(cookie, id);
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = await healthRes.json().catch(() => ({}));
  const report = {
    batch: "reload",
    connectionId: id,
    status: created?.status ?? null,
    code: info.code,
    message: info.message,
    ack: created?.json?.data?.executionRuntimeAck ?? null,
    removed,
    residual: residualCount(id),
    healthOk: health.ok === true,
    activation: health.data?.execution?.activation ?? null
  };
  report.verdict =
    report.status === 503 &&
    report.code === "EXECUTION_RUNTIME_NOT_LOADED" &&
    String(report.message).includes("配置已保存，但执行层未加载") &&
    report.ack !== true &&
    report.residual === 0 &&
    report.healthOk === true
      ? "PASS"
      : "FAIL";
  console.log(JSON.stringify(report));
  return report.verdict === "PASS" ? 0 : 1;
}

async function main() {
  const cookie = await login();
  let failed = 0;
  if (batch === "case" || batch === "all") failed += await batchCase(cookie);
  if (batch === "gate" || batch === "all") failed += await batchGate(cookie);
  if (batch === "reload" || batch === "all") failed += await batchReload(cookie);
  if (!["case", "gate", "reload", "all"].includes(batch)) {
    throw new Error(`unknown batch ${batch}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ step: "fatal", message: String(error.message ?? error) }));
  process.exit(1);
});
