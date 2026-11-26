/**
 * access-write-window-fixture.mjs — REQ-0117 大目录夹具（自包含、可回滚清理）。
 *
 * 在隔离 compose 栈（scripts/uat/access-write-window-stack.mjs）上构造 ≥2000 张
 * 启用表目录：
 *   up     — 造 2000 物理表（MySQL req0117 schema）→ schema_manifest 批量写入 →
 *            启用表全量启用（保留既有启用表），状态快照落 inbox/req0117-dev/state.json
 *   role   — 以 WebUI 表单同形载荷创建关联 2000 表的角色（dryRun→object-version 写）
 *   clean  — 删除夹具角色 → 恢复启用表 → 删 manifest → 重载 catalog → MySQL drop schema
 *
 * 幂等：`up` 可重复执行（drop schema 重建）；`clean` 只清理本夹具产物。
 * 依赖：隔离栈已 healthy；不需要外部服务（宿主缺席即退出码 2）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WEB, SECRET_DIR, dbContainer, lucyContainer } from "./access-write-window-stack.mjs";

const requireWebui = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../webui/package.json"));
const { parse: parseYaml } = requireWebui("yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "inbox/req0117-dev");
const STATE_FILE = path.join(OUT_DIR, "state.json");

const SCHEMA = "req0117";
const TABLE_COUNT = Number(process.env.REQ0117_TABLE_COUNT ?? 2000);
const CONNECTION = "demo-mysql";
export const FIXTURE_ROLE_PREFIX = "req0117";

const ADMIN_ID = process.env.REQ0117_ADMIN_ID ?? "req0117admin";

let cookie = "";

function die(code, message) {
  console.error(`[req0117-fixture] ${message}`);
  process.exit(code);
}

async function api(pathname, method = "GET", body) {
  const res = await fetch(`${WEB}${pathname}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, headers: res.headers };
}

function dockerExec(args, input) {
  return execFileSync("docker", ["exec", "-i", ...args], {
    input,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 256 * 1024 * 1024
  });
}

async function bootstrapAdmin() {
  const tokenFile = path.join(SECRET_DIR, "webui-bootstrap-token");
  if (!existsSync(tokenFile)) die(2, `bootstrap token 缺失：${tokenFile}（先跑 access-write-window-stack.mjs up）`);
  const credFile = path.join(SECRET_DIR, "admin.json");
  if (existsSync(credFile)) {
    // 幂等：管理员已在先前的运行中 claim，凭据从私有缓存读取。
    const cred = JSON.parse(readFileSync(credFile, "utf8"));
    const login = await api("/api/auth/login", "POST", { adminId: cred.adminId, password: cred.password });
    if (login.status === 200) {
      cookie = (login.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      return;
    }
    die(2, `缓存的管理员凭据登录失败（${login.status}）；隔离栈若已重建，请删除 ${credFile} 后重跑`);
  }
  const token = readFileSync(tokenFile, "utf8").trim();
  const password = `Req0117-${Math.random().toString(36).slice(2, 12)}-9a`;
  const claim = await fetch(`${WEB}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "x-lucy-bootstrap-token": token, "content-type": "application/json" },
    body: JSON.stringify({ adminId: ADMIN_ID, displayName: "REQ-0117 UAT", password })
  });
  if (claim.status === 409 || claim.status === 403) {
    die(2, "bootstrap claim 被拒绝（管理员已存在且无凭据缓存）；请重建隔离栈（down 后 up）以获得全新卷");
  }
  if (!claim.ok) die(2, `bootstrap claim 失败：${claim.status}`);
  cookie = (claim.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const login = await api("/api/auth/login", "POST", { adminId: ADMIN_ID, password });
  if (login.status !== 200) die(2, `admin 登录失败：${login.status}`);
  cookie = (login.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  writeFileSync(credFile, JSON.stringify({ adminId: ADMIN_ID, password }, null, 2), { mode: 0o600 });
}

function createTablesSql() {
  const lines = [
    `DROP DATABASE IF EXISTS ${SCHEMA};`,
    `CREATE DATABASE ${SCHEMA} CHARACTER SET utf8mb4;`,
    `USE ${SCHEMA};`
  ];
  for (let i = 1; i <= TABLE_COUNT; i += 1) {
    const t = `t${String(i).padStart(4, "0")}`;
    lines.push(`CREATE TABLE ${t} (id INT NOT NULL PRIMARY KEY, name VARCHAR(64), created_at DATETIME);`);
  }
  return `${lines.join("\n")}\n`;
}

function manifestYaml() {
  const lines = ["tables:"];
  for (let i = 1; i <= TABLE_COUNT; i += 1) {
    const t = `t${String(i).padStart(4, "0")}`;
    lines.push(`  ${t}:`);
    lines.push(`    table: ${SCHEMA}.${t}`);
    lines.push(`    columns:`);
    lines.push(`      - name: id`);
    lines.push(`        type: number`);
    lines.push(`        pk: true`);
    lines.push(`        nullable: false`);
    lines.push(`      - name: name`);
    lines.push(`        type: string`);
    lines.push(`        nullable: true`);
    lines.push(`      - name: created_at`);
    lines.push(`        type: time`);
    lines.push(`        nullable: true`);
  }
  return `${lines.join("\n")}\n`;
}

function currentEnabledTables() {
  // ktx.yaml 在 lucy 容器项目根（/data/lucy/ktx.yaml），不在 content root。
  const yaml = dockerExec([lucyContainer(), "cat", "/data/lucy/ktx.yaml"]);
  const config = parseYaml(yaml);
  const conn = config?.connections?.[CONNECTION];
  return Array.isArray(conn?.enabled_tables) ? conn.enabled_tables.filter((t) => typeof t === "string") : [];
}

async function createTableSelectors(names) {
  return [{ connection: CONNECTION, schema: SCHEMA, names }];
}

async function cmdUp() {
  mkdirSync(OUT_DIR, { recursive: true });
  const previousEnabled = currentEnabledTables();
  console.log(`[req0117-fixture] 既有启用表 ${previousEnabled.length} 张（已快照）`);
  dockerExec([dbContainer(), "mysql", "-uroot", "-plucy_demo_root"], createTablesSql());
  console.log(`[req0117-fixture] MySQL ${SCHEMA} 已建 ${TABLE_COUNT} 张表`);

  const manifest = manifestYaml();
  const declare = await api(`/api/connections/${CONNECTION}/schemas`, "POST", { schema: SCHEMA, dryRun: false });
  if (declare.status !== 200) die(1, `schema 声明失败：${declare.status} ${JSON.stringify(declare.json)?.slice(0, 300)}`);
  console.log(`[req0117-fixture] connection 已声明 schema ${SCHEMA}`);
  const upload = await api("/api/catalog/assets/upload", "POST", {
    connectionId: CONNECTION,
    schema: SCHEMA,
    assetKind: "schema_manifest",
    filename: `${SCHEMA}.yaml`,
    content: manifest
  });
  if (upload.status !== 200) die(1, `manifest 上传失败：${upload.status} ${JSON.stringify(upload.json)?.slice(0, 300)}`);
  console.log(`[req0117-fixture] schema manifest 已上传（${(manifest.length / 1024).toFixed(0)}KiB）`);

  const enabled = [...new Set([...previousEnabled, ...Array.from({ length: TABLE_COUNT }, (_, i) => `${SCHEMA}.t${String(i + 1).padStart(4, "0")}`)])];
  const put = await api(`/api/connections/${CONNECTION}/enabled-tables`, "PUT", { enabledTables: enabled, dryRun: false });
  if (put.status !== 200) die(1, `启用表写入失败：${put.status} ${JSON.stringify(put.json)?.slice(0, 300)}`);
  const ackCount = put.json?.data?.newEnabledTables?.length ?? put.json?.data?.count;
  console.log(`[req0117-fixture] 启用表已写入：${ackCount ?? enabled.length} 张`);
  writeFileSync(STATE_FILE, JSON.stringify({ previousEnabled, schema: SCHEMA, tableCount: TABLE_COUNT, roles: [], at: new Date().toISOString() }, null, 2));
  console.log(`[req0117-fixture] 状态快照 → ${path.relative(ROOT, STATE_FILE)}`);
}

async function fixtureRole(roleId, tableCount) {
  const names = Array.from({ length: tableCount }, (_, i) => `${SCHEMA}.t${String(i + 1).padStart(4, "0")}`);
  const role = {
    description: `REQ-0117 fixture role (${tableCount} tables)`,
    allow: {
      connections: [CONNECTION],
      tableSelectors: await createTableSelectors(names),
      tools: ["lucy_catalog", "lucy_query", "lucy_read_source"]
    }
  };
  const dry = await api("/api/admin/roles", "POST", { dryRun: true, roleId, role });
  if (dry.status !== 200) die(1, `dryRun 失败：${dry.status} ${JSON.stringify(dry.json)?.slice(0, 300)}`);
  const preview = dry.json?.data ?? {};
  const operationId = crypto.randomUUID();
  const write = await api("/api/admin/roles", "POST", {
    dryRun: false,
    roleId,
    role,
    baseObjectVersion: preview.baseObjectVersion,
    previewToken: preview.previewToken,
    ...(preview.compileInputsDigest ? { compileInputsDigest: preview.compileInputsDigest } : {}),
    operationId
  });
  return { dry, write, operationId };
}

async function cmdRole() {
  const roleId = process.argv[3] ?? `${FIXTURE_ROLE_PREFIX}_big`;
  const tableCount = Number(process.argv[4] ?? TABLE_COUNT);
  await bootstrapAdminIfNeeded();
  const started = Date.now();
  const { dry, write } = await fixtureRole(roleId, tableCount);
  const ms = Date.now() - started;
  console.log(`[req0117-fixture] 角色 ${roleId}（${tableCount} 表）dryRun=${dry.status} write=${write.status} 耗时=${ms}ms`);
  if (write.status !== 200) {
    console.error(JSON.stringify(write.json)?.slice(0, 500));
    process.exit(1);
  }
  recordRole(roleId);
}

async function bootstrapAdminIfNeeded() {
  if (cookie) return;
  await bootstrapAdmin();
}

function recordRole(roleId) {
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  if (!state.roles.includes(roleId)) state.roles.push(roleId);
  state.rolesAt = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function cmdClean() {
  if (!existsSync(STATE_FILE)) die(2, `状态快照缺失：${STATE_FILE}（无夹具可清理）`);
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  await bootstrapAdminIfNeeded();
  for (const roleId of state.roles ?? []) {
    const del = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, "DELETE", {});
    console.log(`[req0117-fixture] 删除角色 ${roleId} → ${del.status}`);
  }
  const put = await api(`/api/connections/${CONNECTION}/enabled-tables`, "PUT", { enabledTables: state.previousEnabled ?? [], dryRun: false });
  console.log(`[req0117-fixture] 恢复启用表（${state.previousEnabled?.length ?? 0} 张）→ ${put.status}`);
  const removeSchema = await api(`/api/connections/${CONNECTION}/schemas/remove`, "POST", { schema: state.schema, dryRun: false, deleteManifest: true, deleteOverlays: true });
  console.log(`[req0117-fixture] 移除 schema 声明与 manifest → ${removeSchema.status}`);
  const reload = await api("/api/catalog/reload", "POST", {});
  console.log(`[req0117-fixture] catalog 重载 → ${reload.status}`);
  dockerExec([dbContainer(), "mysql", "-uroot", "-plucy_demo_root", "-e", `DROP DATABASE IF EXISTS ${state.schema};`]);
  console.log(`[req0117-fixture] MySQL schema ${state.schema} 已删除`);
}

async function main() {
  const command = process.argv[2] ?? "up";
  const health = await fetch(`${WEB}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  if (!health) die(2, `隔离栈未就绪：${WEB}`);
  await bootstrapAdmin();
  if (command === "up") return cmdUp();
  if (command === "role") return cmdRole();
  if (command === "clean") return cmdClean();
  die(2, `unknown command: ${command}`);
}

await main();
