#!/usr/bin/env node
/**
 * seed-scale-access.mjs — UAT 规模基线造数 ①：access.yaml（200 正式角色／500 Agent×3 凭据）。
 *
 * SOT：docs/qa/uat/scale-baseline.md。幂等：重跑先剥离既有 uat_role_*／uat_agent_*
 * 再重新生成；既有 demo 角色／Agent／defaults 原样保留。凭据为一次性实验口令
 * （sha256 哈希，不可逆推演示明文约定），仅限本机，不得复用到任何真实环境。
 *
 * 机制：改 access.yaml 需重启生效（ensurePolicyRuntime 仅在启动/降级时重编译，
 * 见 webui/server/proxy/acl.ts）。脚本 stop → 备份 → 写入 → start → 健康等待 → 计数复核。
 *
 * 用法：node scripts/uat/seed-scale-access.mjs
 * 覆盖：UAT_LUCY_CONTAINER（默认 compose-lucy-1）、UAT_TARGET_ROLES（200）、
 *       UAT_TARGET_AGENTS（500）、UAT_TOKENS_PER_AGENT（3）、LUCY_DEMO_WEBUI_HOST_PORT（55176）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const ACCESS_YAML = "/data/lucy/webui/config/access.yaml";
const TARGET_ROLES = Number(process.env.UAT_TARGET_ROLES || 200);
const TARGET_AGENTS = Number(process.env.UAT_TARGET_AGENTS || 500);
const TOKENS_PER_AGENT = Number(process.env.UAT_TOKENS_PER_AGENT || 3);
const HEALTH_URL = `http://127.0.0.1:${process.env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}/api/health`;
const SEED = 20261123;

// ---- 确定性 PRNG（mulberry32） -------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- docker 助手 ---------------------------------------------------------

function docker(...args) {
  return execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

function stopLucy() {
  try {
    docker("stop", LUCY);
    console.log("[seed-access] 已停止 " + LUCY);
  } catch {
    console.log("[seed-access] " + LUCY + " 未在运行，继续");
  }
}

function startLucyAndWaitHealth() {
  docker("start", LUCY);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync("curl", ["-sf", HEALTH_URL], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      if (out.includes("\"ok\"") || out.includes("gitSha")) {
        console.log("[seed-access] 健康检查通过 " + HEALTH_URL);
        return;
      }
    } catch {
      // retry
    }
    execFileSync("sleep", ["3"]);
  }
  throw new Error("健康检查超时：" + HEALTH_URL);
}

// ---- access.yaml 生成 -----------------------------------------------------

const BASE_TOOLS = [
  "lucy_catalog", "lucy_query", "lucy_read_source", "lucy_explain_query",
  "lucy_freshness", "lucy_begin_question", "lucy_continue_question",
  "wiki_search", "wiki_read", "connection_list", "entity_details",
  "dictionary_search", "discover_data", "lucy_skill_search", "lucy_skill_read",
];
const CONNECTION_SHAPES = [
  ["demo-mysql"], ["demo-mysql"], ["lucy-ops"], ["demo-mysql", "lucy-ops"], ["*"],
];

function genRoleYaml(n) {
  const id = String(n).padStart(3, "0");
  const connections = pick(CONNECTION_SHAPES);
  const toolCount = int(5, BASE_TOOLS.length);
  const tools = [...BASE_TOOLS].sort(() => rand() - 0.5).slice(0, toolCount);
  const lines = [];
  lines.push(`  uat_role_${id}:`);
  lines.push(`    description: UAT scale role ${id}（基线夹具，勿用于生产）`);
  lines.push(`    allow:`);
  lines.push(`      connections:`);
  for (const c of connections) {
    lines.push(c === "*" ? `        - "*"` : `        - ${c}`);
  }
  if (connections.includes("demo-mysql") && rand() < 0.5) {
    const tables = ["superstore_orders", "superstore_returns", "superstore_people"]
      .filter(() => rand() < 0.8);
    if (tables.length > 0) {
      lines.push(`      tableSelectors:`);
      lines.push(`        - connection: demo-mysql`);
      lines.push(`          schema: dataforai`);
      lines.push(`          names:`);
      for (const t of tables) lines.push(`            - ${t}`);
    }
  }
  lines.push(`      tools:`);
  for (const t of tools) lines.push(`        - ${t}`);
  return lines.join("\n");
}

function tokenHash(agentId, label) {
  return "sha256:" + createHash("sha256")
    .update(`uat-scale-token|${agentId}|${label}|${SEED}`)
    .digest("hex");
}

function genAgentYaml(n) {
  const id = String(n).padStart(3, "0");
  const agentId = `uat_agent_${id}`;
  const roleN = ((n - 1) % (TARGET_ROLES - 3)) + 1; // 分布在 197 个 UAT 角色上
  const roleId = `uat_role_${String(roleN).padStart(3, "0")}`;
  const lines = [];
  lines.push(`  - id: ${agentId}`);
  lines.push(`    name: UAT Agent ${id}`);
  lines.push(`    enabled: true`);
  lines.push(`    note: UAT 规模基线夹具，请勿用于生产。`);
  lines.push(`    tokens:`);
  for (let k = 1; k <= TOKENS_PER_AGENT; k++) {
    lines.push(`      - hash: ${tokenHash(agentId, "tk" + k)}`);
    lines.push(`        label: tk${k}`);
    lines.push(`        created: 2026-11-23`);
  }
  lines.push(`    role: ${roleId}`);
  return lines.join("\n");
}

/** 基座 Agent 凭据补齐到 TOKENS_PER_AGENT（追加 tkN，不动既有 token；幂等） */
function topUpBaseTokens(text) {
  const lines = text.split("\n");
  const out = [];
  let curUser = null;
  let curTokens = 0;
  for (const line of lines) {
    const m = /^  - id: (\S+)\s*$/.exec(line);
    if (m) {
      curUser = m[1];
      curTokens = 0;
    }
    if (curUser && /^      - hash: /.test(line)) curTokens++;
    if (curUser && /^    role: /.test(line)) {
      while (curTokens < TOKENS_PER_AGENT) {
        curTokens++;
        out.push(`      - hash: ${tokenHash(curUser, "tk" + curTokens)}`);
        out.push(`        label: tk${curTokens}`);
        out.push(`        created: 2026-11-23`);
      }
      curUser = null;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** 行级剥离既有生成物，保留 demo 基座与 defaults */
function stripGenerated(text) {
  const lines = text.split("\n");
  const kept = [];
  let skippingRole = false;
  let skippingUser = false;
  for (const line of lines) {
    const isRole = /^  uat_role_\d+:/.test(line);
    const isUser = /^  - id: uat_agent_\d+\s*$/.test(line);
    const isTop = /^[a-z_]+:/.test(line); // roles:/users:/defaults:
    if (isTop) {
      skippingRole = false;
      skippingUser = false;
    }
    if (isRole) skippingRole = true;
    if (isUser) skippingUser = true;
    if (skippingRole || skippingUser) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function main() {
  console.log(`[seed-access] 目标：角色 ${TARGET_ROLES}／Agent ${TARGET_AGENTS}／每 Agent ${TOKENS_PER_AGENT} 凭据`);
  const tmp = mkdtempSync(path.join(tmpdir(), "uat-seed-access-"));

  stopLucy();

  // 取出当前 access.yaml
  const localYaml = path.join(tmp, "access.yaml");
  docker("cp", `${LUCY}:${ACCESS_YAML}`, localYaml);
  const original = readFileSync(localYaml, "utf8");

  // 备份（卷内时间戳副本）
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const bakLocal = path.join(tmp, "access.yaml.bak");
  writeFileSync(bakLocal, original);
  docker("cp", bakLocal, `${LUCY}:${ACCESS_YAML}.bak-${stamp}`);
  console.log(`[seed-access] 已备份 ${ACCESS_YAML}.bak-${stamp}`);

  // 计数既有基座（只在 roles:..users: 区域数角色，避免误计 defaults: 下的 2 空格键）
  const rolesRegion = original.split(/^users:/m)[0];
  const baseRoleCount = (rolesRegion.match(/^  [a-z_][a-z0-9_]*:\s*$/gm) || [])
    .filter((l) => !/^  uat_role_/.test(l)).length;
  const baseAgentCount = (original.match(/^  - id: /gm) || [])
    .filter((_, i, arr) => true).length -
    (original.match(/^  - id: uat_agent_\d+/gm) || []).length;
  const needRoles = TARGET_ROLES - baseRoleCount;
  const needAgents = TARGET_AGENTS - baseAgentCount;
  console.log(`[seed-access] 基座：角色 ${baseRoleCount}／Agent ${baseAgentCount} → 新增角色 ${needRoles}／Agent ${needAgents}`);
  if (needRoles < 0 || needAgents < 0) {
    throw new Error("基座数量已超过目标，拒绝生成");
  }

  const stripped = stripGenerated(original).replace(/\s+$/, "");
  const head = [
    "# UAT 规模基线夹具（seed-scale-access.mjs 生成，seed=20261123）。",
    "# uat_role_*／uat_agent_* 为一次性实验对象，勿用于生产；重跑先剥离再生成。",
  ].join("\n");
  const roleBlock = Array.from({ length: needRoles }, (_, i) => genRoleYaml(i + 1)).join("\n");
  const userBlock = Array.from({ length: needAgents }, (_, i) => genAgentYaml(i + 1)).join("\n");

  // 插入位置：新角色加在 roles: 块内第一个 demo 角色之前无必要，直接追加在 defaults: 之前的 users 段尾部
  let out = topUpBaseTokens(stripped);
  if (needRoles > 0) {
    // 在 "users:" 行之前插入新角色
    out = out.replace(/^users:/m, roleBlock + "\nusers:");
  }
  if (needAgents > 0) {
    // 在 "defaults:" 行之前插入新用户
    out = out.replace(/^defaults:/m, userBlock + "\ndefaults:");
  }
  const finalYaml = head + "\n" + out + "\n";
  writeFileSync(localYaml, finalYaml);
  docker("cp", localYaml, `${LUCY}:${ACCESS_YAML}`);
  console.log(`[seed-access] 已写入 ${ACCESS_YAML}（${finalYaml.split("\n").length} 行）`);

  startLucyAndWaitHealth();

  // 复核计数
  const verifyJs = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    `const c=y.parse(fs.readFileSync("${ACCESS_YAML}","utf8"));`,
    'const us=c.users||[];const tk=u=>(u.tokens||[]).length;',
    "console.log(JSON.stringify({roles:Object.keys(c.roles||{}).length,agents:us.length,",
    "minTokens:us.length?Math.min.apply(null,us.map(tk)):0,",
    "totalTokens:us.reduce((s,u)=>s+tk(u),0)}));",
  ].join("");
  const r = JSON.parse(
    execFileSync("docker", ["exec", LUCY, "node", "-e", verifyJs], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  const verifyJs2 = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    `const c=y.parse(fs.readFileSync("${ACCESS_YAML}","utf8"));`,
    'const us=c.users||[];',
    "console.log(JSON.stringify({full:us.filter(u=>(u.tokens||[]).length>=" + TOKENS_PER_AGENT + ").length,",
    "total:us.reduce((s,u)=>s+(u.tokens||[]).length,0)}));",
  ].join("");
  const r2 = JSON.parse(
    execFileSync("docker", ["exec", LUCY, "node", "-e", verifyJs2], { stdio: ["pipe", "pipe", "pipe"] }).toString(),
  );
  console.log(`[seed-access] 复核：角色 ${r.roles}／Agent ${r.agents}／足凭据 Agent ${r2.full}／总凭据 ${r2.total}`);
  const ok = r.roles >= TARGET_ROLES && r.agents >= TARGET_AGENTS &&
    r2.full >= TARGET_AGENTS && r2.total >= TARGET_AGENTS * TOKENS_PER_AGENT;
  console.log(ok ? "[seed-access] 完成，基线达标" : "[seed-access] 复核未达标，请检查");
  process.exit(ok ? 0 : 1);
}

main();
