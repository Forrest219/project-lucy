#!/usr/bin/env node
/**
 * P1-36／P1-37 UAT 夹具：宽目录＋多身份的**隔离沙箱** Lucy（与 demo 同镜像、同 KTX，独立数据卷与端口）。
 *
 *   node scripts/uat/uat-wide-sandbox.mjs up      # 起容器、认领管理员、造 320 表库、建连接、上传 Schema Manifest、建角色与 20 个 Agent
 *   node scripts/uat/uat-wide-sandbox.mjs down    # 删容器、数据卷、夹具库、本机密钥目录
 *   node scripts/uat/uat-wide-sandbox.mjs status
 *
 * 为什么是沙箱而不是 demo：UAT-MCPX-06 全局 LRU 要 ≥ 17 个身份，UAT-MCPX-07 要 ≥ 300 个可见 Source，
 * 这些都要改 ACL／目录；沙箱让这些变更不碰 demo 的运行时状态。步骤全部走真实路径：
 *   WebUI 管理员认领（bootstrap）→ `POST /api/connections` → `PUT …/enabled-tables` →
 *   `POST /api/catalog/assets/upload`（schema_manifest）→ `POST /api/admin/roles|agents|…/tokens`。
 *
 * 产物（均在本机 `${TMPDIR}/lucy-uat-wide/`，目录 0700、文件 0600，**不入仓、不打印内容**）：
 *   bootstrap-token、admin-password、state.json（端口、管理员 id、各 Agent 的角色）、tokens.json（各 Agent 明文 token）。
 *
 * 夹具库口令是 demo compose 里公开的一次性实验口令，仅限本机。
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAME = process.env.UAT_WIDE_CONTAINER ?? "lucy-uat-wide";
const VOLUME = `${NAME}-data`;
const NETWORK = process.env.UAT_WIDE_NETWORK ?? "compose_default";
const IMAGE = process.env.UAT_WIDE_IMAGE ?? "project-lucy:demo";
const WEB_PORT = Number(process.env.UAT_WIDE_WEBUI_PORT ?? 55276);
const PROXY_PORT = Number(process.env.UAT_WIDE_PROXY_PORT ?? 57981);
const TABLES = Number(process.env.UAT_WIDE_SOURCES ?? 320);
const AGENTS = Number(process.env.UAT_WIDE_AGENTS ?? 20);
const DB = "uat_wide_mcp";
const CONNECTION = "uat-wide-catalog";
const DB_ROOT_PASSWORD = "lucy_demo_root";
const SECRETS = path.join(os.tmpdir(), "lucy-uat-wide");
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const docker = (args, options = {}) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (n) => String(n).padStart(4, "0");
const sourceName = (i) => `t_${pad(i)}`;

function secretPath(file) { return path.join(SECRETS, file); }
function writeSecret(file, content) {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  chmodSync(SECRETS, 0o700);
  writeFileSync(secretPath(file), content, { mode: 0o600 });
}

function demoDbContainer() {
  const id = docker(["ps", "--filter", "name=demo-db", "--format", "{{.Names}}"]).trim().split("\n")[0];
  if (!id) throw new Error("demo-db container not running (start the demo compose first)");
  return id;
}

function mysql(sql) {
  return docker(["exec", "-i", demoDbContainer(), "mysql", "-uroot", `-p${DB_ROOT_PASSWORD}`, "-N"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
}

async function api(method, route, body, cookie, headers = {}) {
  const res = await fetch(`${WEB}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}
function must(label, r) {
  if (r.status >= 300 || r.json?.ok === false) throw new Error(`${label} failed: status=${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
  return r;
}

async function waitHealthy(timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${WEB}/api/health`); if (r.ok) return; } catch { /* 还没起来 */ }
    await sleep(2000);
  }
  throw new Error("sandbox did not become healthy in time");
}

function startContainer() {
  docker(["volume", "create", VOLUME]);
  docker(["run", "--rm", "--user", "0", "--entrypoint", "/bin/sh", "-v", `${VOLUME}:/data/lucy`, IMAGE, "-ec",
    "mkdir -p /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui && chown 10001:10001 /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui"]);
  const env = {
    KTX_PROJECT_ROOT: "/data/lucy", LUCY_TEMPLATE_ROOT: "/app/examples/docker-demo/project-template",
    LUCY_WEBUI_HOST: "0.0.0.0", LUCY_WEBUI_PORT: "5174", LUCY_PROXY_HOST: "0.0.0.0", LUCY_PROXY_PORT: "7879",
    LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "7878", LUCY_CONTENT_ROOT: "/data/lucy/config",
    LUCY_PUBLIC_MCP_URL: `http://127.0.0.1:${PROXY_PORT}/mcp`, LUCY_DEPLOYMENT_MODE: "customer",
    LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: "/run/secrets/webui_bootstrap_token", LUCY_WEBUI_COOKIE_SECURE: "0",
    LUCY_WEBUI_TEST_PROFILE: "1", POSTHOG_DISABLED: "1"
  };
  docker(["run", "-d", "--name", NAME, "--network", NETWORK,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`,
    "-v", `${VOLUME}:/data/lucy`,
    "-v", `${ROOT}/examples/docker-demo/project-template/evals:/data/lucy/config/evals:ro`,
    "-v", `${secretPath("bootstrap-token")}:/run/secrets/webui_bootstrap_token:ro`,
    IMAGE]);
}

function seedDatabase() {
  const statements = [`CREATE DATABASE IF NOT EXISTS \`${DB}\`;`];
  for (let i = 1; i <= TABLES; i += 1) {
    statements.push(`CREATE TABLE IF NOT EXISTS \`${DB}\`.\`${sourceName(i)}\` (id INT PRIMARY KEY, biz_date DATE NULL, amount DECIMAL(18,2) NULL, owner_name VARCHAR(64) NULL, status VARCHAR(16) NULL, remark VARCHAR(128) NULL);`);
  }
  mysql(statements.join("\n"));
}

function schemaManifest() {
  const lines = ["tables:"];
  for (let i = 1; i <= TABLES; i += 1) {
    const name = sourceName(i);
    lines.push(`  ${name}:`, `    table: ${DB}.${name}`, "    columns:");
    const columns = [["id", "number", true], ["biz_date", "time", false], ["amount", "number", false], ["owner_name", "string", false], ["status", "string", false], ["remark", "string", false]];
    for (const [col, type, pk] of columns) {
      lines.push(`      - name: ${col}`, `        type: ${type}`, ...(pk ? ["        pk: true"] : []), `        nullable: ${pk ? "false" : "true"}`,
        "        descriptions:", `          db: ${col} of ${name}`, `          ai: Synthetic column ${col} used by the wide-catalog UAT fixture.`);
    }
  }
  return lines.join("\n") + "\n";
}

const TOOLS = ["lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query", "lucy_begin_question", "lucy_continue_question",
  "wiki_search", "wiki_read", "connection_list", "lucy_skill_read", "lucy_skill_search"];
const roleBody = (names, tools) => ({
  description: "UAT wide-catalog fixture role",
  allow: { connections: [CONNECTION], tableSelectors: [{ connection: CONNECTION, schema: DB, names }], tools }
});

async function up() {
  if (existsSync(secretPath("state.json"))) throw new Error("sandbox state already exists; run `down` first");
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const bootstrapToken = randomBytes(24).toString("hex");
  const adminPassword = `Uat-${randomBytes(12).toString("hex")}-9a`;
  writeSecret("bootstrap-token", bootstrapToken);
  writeSecret("admin-password", adminPassword);
  const names = Array.from({ length: TABLES }, (_, i) => sourceName(i + 1));

  console.log("==> starting sandbox container");
  startContainer();
  await waitHealthy();

  console.log("==> claiming sandbox admin (bootstrap)");
  const adminId = "uatadmin";
  const boot = must("bootstrap", await api("POST", "/api/auth/bootstrap", { adminId, displayName: "UAT Admin", password: adminPassword }, undefined, { "x-lucy-bootstrap-token": bootstrapToken }));
  const cookie = boot.setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("bootstrap did not set a session cookie");

  console.log(`==> seeding ${TABLES} tables in demo-db.${DB}`);
  seedDatabase();

  console.log("==> creating connection, uploading Schema Manifest, enabling tables");
  must("create connection", await api("POST", "/api/connections", {
    id: CONNECTION, driver: "mysql", host: "demo-db", port: 3306, database: DB, username: "root", password: DB_ROOT_PASSWORD,
    schemas: [DB], dryRun: false, acknowledgeSeparateConnection: true
  }, cookie));
  must("manifest upload", await api("POST", "/api/catalog/assets/upload", {
    connectionId: CONNECTION, schema: DB, assetKind: "schema_manifest", filename: `${DB}.yaml`, content: schemaManifest(), confirmOverwrite: true
  }, cookie));
  must("enabled-tables", await api("PUT", `/api/connections/${CONNECTION}/enabled-tables`, { enabledTables: names.map((n) => `${DB}.${n}`), dryRun: false }, cookie));

  console.log("==> creating roles");
  const roles = {
    uat_wide_full: roleBody(names, TOOLS),
    uat_wide_half: roleBody(names.slice(0, Math.floor(TABLES / 2)), TOOLS),
    uat_wide_noquery: roleBody(names, TOOLS.filter((t) => t !== "lucy_query" && t !== "lucy_explain_query"))
  };
  for (const [roleId, role] of Object.entries(roles)) must(`role ${roleId}`, await api("POST", "/api/admin/roles", { dryRun: false, roleId, role }, cookie));

  console.log(`==> creating ${AGENTS} agents and tokens`);
  const roleCycle = ["uat_wide_full", "uat_wide_noquery", "uat_wide_half"];
  const state = { webui: WEB, proxy: `http://127.0.0.1:${PROXY_PORT}/mcp`, container: NAME, adminId, connection: CONNECTION, db: DB, sources: TABLES, agents: [] };
  const tokens = {};
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  for (let i = 1; i <= AGENTS; i += 1) {
    const id = `uat_a${String(i).padStart(2, "0")}`;
    const role = roleCycle[(i - 1) % roleCycle.length];
    must(`agent ${id}`, await api("POST", "/api/admin/agents", { dryRun: false, agent: { id, name: `UAT agent ${i}`, roles: [role] } }, cookie));
    const t = must(`token ${id}`, await api("POST", `/api/admin/agents/${id}/tokens`, { label: "uat", expires_at: expires, dryRun: false }, cookie));
    const plaintext = t.json?.data?.token ?? t.json?.data?.plaintext ?? t.json?.token;
    if (typeof plaintext !== "string") throw new Error(`token response for ${id} had no plaintext token field`);
    tokens[id] = plaintext;
    state.agents.push({ id, role });
  }
  writeSecret("tokens.json", JSON.stringify(tokens));
  writeSecret("state.json", JSON.stringify(state, null, 2));
  console.log(`==> sandbox ready: WebUI ${WEB}  MCP ${state.proxy}  agents=${AGENTS}  sources=${TABLES}`);
}

function down() {
  try { docker(["rm", "-f", NAME]); } catch { /* 不存在 */ }
  try { docker(["volume", "rm", "-f", VOLUME]); } catch { /* 不存在 */ }
  try { mysql(`DROP DATABASE IF EXISTS \`${DB}\`;`); } catch { /* demo-db 不在 */ }
  rmSync(SECRETS, { recursive: true, force: true });
  console.log("==> sandbox removed");
}

/** 重新造库表并给每张表插 3 行（库被外部清理后用；`up` 已自带建表）。 */
function seedRows() {
  seedDatabase();
  const rows = [];
  for (let i = 1; i <= TABLES; i += 1) {
    rows.push(`INSERT IGNORE INTO \`${DB}\`.\`${sourceName(i)}\` VALUES (1,'2026-01-01',10.5,'a','open','r1'),(2,'2026-01-02',20.5,'b','closed','r2'),(3,'2026-01-03',30.5,'c','open','r3');`);
  }
  mysql(rows.join("\n"));
  console.log(`==> seeded ${TABLES} tables with 3 rows each`);
}

/** 换新镜像但保留卷（账号、令牌、目录、审计库都在卷里）。 */
async function restart() {
  if (!existsSync(secretPath("state.json"))) throw new Error("no sandbox state; run `up` first");
  try { docker(["rm", "-f", NAME]); } catch { /* 已不存在 */ }
  startContainer();
  await waitHealthy();
  console.log(`==> sandbox restarted on image ${IMAGE}`);
}

function status() {
  const state = existsSync(secretPath("state.json")) ? JSON.parse(readFileSync(secretPath("state.json"), "utf8")) : null;
  console.log(JSON.stringify({ stateDir: SECRETS, ready: state !== null, ...(state ? { webui: state.webui, proxy: state.proxy, agents: state.agents.length, sources: state.sources } : {}) }));
}

const mode = process.argv[2];
const modes = { up, down, restart, status, "seed-rows": seedRows };
if (!modes[mode]) { console.error("usage: up | down | restart | status | seed-rows"); process.exit(2); }
await modes[mode]();
