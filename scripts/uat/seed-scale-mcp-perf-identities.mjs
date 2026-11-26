#!/usr/bin/env node
/**
 * seed-scale-mcp-perf-identities.mjs — UAT 规模基线造数 ④：MCP-PERF profile 的
 * 50 个压测身份（uat_perf_001..050）与仓外 Token 文件。
 *
 * SOT：docs/qa/uat/scale-baseline.md §1.1 MCP-PERF。幂等：重跑先剥离既有
 * uat_perf_role_*／uat_perf_* 块再重新生成；既有 demo／基座 uat_* 对象原样保留。
 * 凭据为一次性实验口令（sha256 哈希入 access.yaml；明文只写仓外 0600 Token
 * 文件），仅限本机，不得复用到任何真实环境。
 *
 * 机制：改 access.yaml 需重启生效（ensurePolicyRuntime 仅在启动/降级时重编译，
 * 见 webui/server/proxy/acl.ts）。脚本 stop → 备份 → 写入 → start → 健康等待
 * → 计数复核 → 写 Token 文件。重启同时触发 KTX 知识库索引重建。
 *
 * 用法：node scripts/uat/seed-scale-mcp-perf-identities.mjs
 * 覆盖：UAT_LUCY_CONTAINER（默认 compose-lucy-1）、UAT_MCP_PERF_IDENTITIES（50）、
 *       UAT_MCP_PERF_ADMIN_MIN（2）、UAT_MCP_PERF_TOKEN_FILE（默认
 *       <repo>/../.lucy-secrets/mcp-perf-tokens.json）、LUCY_DEMO_WEBUI_HOST_PORT（55176）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const ACCESS_YAML = "/data/lucy/webui/config/access.yaml";
const WANT_IDENTITIES = Number(process.env.UAT_MCP_PERF_IDENTITIES || 50);
const ADMIN_MIN = Number(process.env.UAT_MCP_PERF_ADMIN_MIN || 2);
const HEALTH_URL = `http://127.0.0.1:${process.env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}/api/health`;
const SEED = 20261123;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOKEN_FILE = process.env.UAT_MCP_PERF_TOKEN_FILE ||
  path.resolve(REPO_ROOT, "..", ".lucy-secrets", "mcp-perf-tokens.json");

const BASE_TOOLS = [
  "lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query",
  "lucy_freshness", "lucy_begin_question", "lucy_continue_question",
  "wiki_search", "wiki_read", "connection_list", "entity_details",
  "dictionary_search", "discover_data", "lucy_skill_search", "lucy_skill_read",
];
const RESTRICTED_ROLES = ["uat_perf_role_a", "uat_perf_role_b"];

function tokenHash(agentId, label) {
  return "sha256:" + createHash("sha256")
    .update(`uat-scale-token|${agentId}|${label}|${SEED}`)
    .digest("hex");
}

function tokenPlain(agentId, label) {
  return `uat-scale-token|${agentId}|${label}|${SEED}`;
}

function docker(...args) {
  return execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

function stopLucy() {
  docker("stop", LUCY);
  console.log(`[seed-mcp-perf] 已停止 ${LUCY}`);
}

function startLucyAndWaitHealth() {
  docker("start", LUCY);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync("curl", ["-sf", HEALTH_URL], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      if (out.includes("\"ok\"") || out.includes("gitSha")) {
        console.log("[seed-mcp-perf] 健康检查通过 " + HEALTH_URL);
        return;
      }
    } catch {
      // retry
    }
    execFileSync("sleep", ["3"]);
  }
  throw new Error("健康检查超时：" + HEALTH_URL);
}

/** 剥离既有 uat_perf_role_* 角色块与 uat_perf_* 用户块（幂等）。 */
function stripPerfBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  let skipKind = null;
  for (const line of lines) {
    if (skipKind === "role") {
      // 角色块终止于下一个 2 空格缩进键或顶层键
      if (/^  [A-Za-z_][A-Za-z0-9_]*:\s*(#.*)?$/.test(line) || /^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
        skipping = false;
        skipKind = null;
      } else {
        continue;
      }
    }
    if (skipKind === "user") {
      // 用户块终止于下一个列表项或顶层键
      if (/^  - id: /.test(line) || /^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
        skipping = false;
        skipKind = null;
      } else {
        continue;
      }
    }
    if (/^  uat_perf_role_[A-Za-z0-9_]*:\s*(#.*)?$/.test(line)) {
      skipping = true;
      skipKind = "role";
      continue;
    }
    if (/^  - id: uat_perf_[A-Za-z0-9_]*\s*(#.*)?$/.test(line)) {
      skipping = true;
      skipKind = "user";
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function genPerfRoleYaml(roleId) {
  const lines = [];
  lines.push(`  ${roleId}:`);
  lines.push(`    description: UAT MCP-PERF 压测受限角色（基线夹具，勿用于生产；同组身份可见范围一致）`);
  lines.push(`    allow:`);
  lines.push(`      connections:`);
  lines.push(`        - demo-mysql`);
  lines.push(`        - lucy-ops`);
  if (roleId === "uat_perf_role_a" || roleId === "uat_perf_role_b") {
    // 受限组共享 demo-mysql 三业务表；受限 A 额外独占 lucy-ops 调用流水
    // （Spec 149 §6：lucy-ops 只认显式 tableSelectors 的角色）——
    // MULTI_DB／DENIAL_CROSS_CONN 的 dual_conn 身份由受限 A 承载。
    lines.push(`      tableSelectors:`);
    lines.push(`        - connection: demo-mysql`);
    lines.push(`          schema: dataforai`);
    lines.push(`          names:`);
    lines.push(`            - superstore_orders`);
    lines.push(`            - superstore_returns`);
    lines.push(`            - superstore_people`);
  }
  if (roleId === "uat_perf_role_a") {
    lines.push(`        - connection: lucy-ops`);
    lines.push(`          schema: main`);
    lines.push(`          names:`);
    lines.push(`            - ops_calls`);
  }
  lines.push(`      tools:`);
  for (const t of BASE_TOOLS) lines.push(`        - ${t}`);
  return lines.join("\n");
}

function genPerfAgentYaml(n) {
  const id = String(n).padStart(3, "0");
  const agentId = `uat_perf_${id}`;
  // 001..ADMIN_MIN → lucy_admin（全局对账）；最后一个 → lucy_ops_reader
  // （Spec 149 §6：lucy-ops 只认显式角色，admin 通配不含它，跨连接查询用本身份）；
  // 其余 → 受限角色组交替。
  const role = n <= ADMIN_MIN
    ? "lucy_admin"
    : n === WANT_IDENTITIES
      ? "lucy_ops_reader"
      : RESTRICTED_ROLES[(n - ADMIN_MIN - 1) % RESTRICTED_ROLES.length];
  const lines = [];
  lines.push(`  - id: ${agentId}`);
  lines.push(`    name: UAT MCP-PERF Agent ${id}`);
  lines.push(`    enabled: true`);
  lines.push(`    note: UAT MCP-PERF 压测夹具，请勿用于生产。`);
  lines.push(`    tokens:`);
  lines.push(`      - hash: ${tokenHash(agentId, "perf1")}`);
  lines.push(`        label: perf1`);
  lines.push(`        created: 2026-11-26`);
  lines.push(`    role: ${role}`);
  return lines.join("\n");
}

function writeTokenFile() {
  const tokens = {};
  for (let n = 1; n <= WANT_IDENTITIES; n++) {
    const agentId = `uat_perf_${String(n).padStart(3, "0")}`;
    tokens[agentId] = tokenPlain(agentId, "perf1");
  }
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify({ tokens }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
  console.log(`[seed-mcp-perf] Token 文件已写入 ${TOKEN_FILE}（0600，${Object.keys(tokens).length} 条）`);
}

function main() {
  console.log(`[seed-mcp-perf] 目标：压测身份 ${WANT_IDENTITIES}（lucy_admin ≥${ADMIN_MIN}，受限组 ${RESTRICTED_ROLES.join("／")}）`);
  const tmp = mkdtempSync(path.join(tmpdir(), "uat-seed-mcp-perf-"));

  stopLucy();

  const localYaml = path.join(tmp, "access.yaml");
  docker("cp", `${LUCY}:${ACCESS_YAML}`, localYaml);
  const original = readFileSync(localYaml, "utf8");

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const bakLocal = path.join(tmp, "access.yaml.bak");
  writeFileSync(bakLocal, original);
  docker("cp", bakLocal, `${LUCY}:${ACCESS_YAML}.bak-${stamp}`);
  console.log(`[seed-mcp-perf] 已备份 ${ACCESS_YAML}.bak-${stamp}`);

  const stripped = stripPerfBlocks(original).replace(/\s+$/, "");
  const roleBlock = RESTRICTED_ROLES.map(genPerfRoleYaml).join("\n");
  const userBlock = Array.from({ length: WANT_IDENTITIES }, (_, i) => genPerfAgentYaml(i + 1)).join("\n");

  let out = stripped;
  out = out.replace(/^users:/m, roleBlock + "\nusers:");
  out = out.replace(/^defaults:/m, userBlock + "\ndefaults:");
  const finalYaml = out + "\n";
  writeFileSync(localYaml, finalYaml);
  docker("cp", localYaml, `${LUCY}:${ACCESS_YAML}`);
  console.log(`[seed-mcp-perf] 已写入 ${ACCESS_YAML}（${finalYaml.split("\n").length} 行）`);

  startLucyAndWaitHealth();

  // 复核计数（容器内 yaml 解析）
  const verifyJs = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    `const c=y.parse(fs.readFileSync("${ACCESS_YAML}","utf8"));`,
    'const us=(c.users||[]).filter(u=>String(u.id).startsWith("uat_perf_"));',
    'const tk=u=>(u.tokens||[]).length;',
    'const admins=us.filter(u=>u.role==="lucy_admin").length;',
    'const groups=new Set(us.filter(u=>u.role!=="lucy_admin").map(u=>u.role));',
    'const bad=us.filter(u=>u.enabled===false||tk(u)===0||!u.role||!String(u.name||"").trim()).length;',
    "console.log(JSON.stringify({perf:us.length,admins,groups:[...groups],bad," +
      "distinctTokens:new Set(us.flatMap(u=>(u.tokens||[]).map(t=>t.hash))).size}));",
  ].join("");
  const r = JSON.parse(
    execFileSync("docker", ["exec", LUCY, "node", "-e", verifyJs], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  console.log(`[seed-mcp-perf] 复核：身份 ${r.perf}／lucy_admin ${r.admins}／受限组 ${r.groups.join("，")}／互异凭据 ${r.distinctTokens}／不合规 ${r.bad}`);
  const ok = r.perf >= WANT_IDENTITIES && r.admins >= ADMIN_MIN &&
    r.groups.length >= 2 && r.distinctTokens >= r.perf && r.bad === 0;
  if (!ok) {
    console.error("[seed-mcp-perf] 复核未达标，请检查");
    process.exit(1);
  }

  writeTokenFile();
  console.log("[seed-mcp-perf] 完成，MCP-PERF 身份夹具就绪");
}

main();
