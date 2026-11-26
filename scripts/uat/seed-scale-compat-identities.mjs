#!/usr/bin/env node
/**
 * seed-scale-compat-identities.mjs — MCP-PERF 隔离栈的 P1-54 题库专用身份造数。
 *
 * SOT：scripts/e2e/contracts/mcp-upgrade-journeys.yaml（identities/roles）与
 * scripts/e2e/contracts/mcp-compat-config-profile.yaml（fixtureRoles 合同）。
 * 本脚本只落台：① 应用 compat profile 的 fixtureRoles（复用
 * applyCompatConfigProfile，merge 进 access.yaml roles）；② 为题库 identities
 * 引用的每个 tokenRef 造启用身份＋自有凭据（sha256 哈希入 access.yaml，
 * 明文写仓外 0600 JSON 供 COMPAT_TOKEN_* 环境变量消费）。不新增题目、
 * 不改角色合同语义。
 *
 * 幂等：重跑先剥离本脚本前缀（uat_compat_）身份再重建；compat_fixture_*
 * 角色由 applyCompatConfigProfile 幂等 merge。
 *
 * 用法：node scripts/uat/seed-scale-compat-identities.mjs
 * 覆盖：UAT_LUCY_CONTAINER（默认 compose-lucy-1）、UAT_COMPAT_TOKEN_FILE
 *       （默认 <repo>/../.lucy-secrets/mcp-compat-tokens-uat.json）、
 *       LUCY_DEMO_WEBUI_HOST_PORT（55176）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const ACCESS_YAML = "/data/lucy/webui/config/access.yaml";
const HEALTH_URL = `http://127.0.0.1:${process.env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}/api/health`;
const TOKEN_FILE = process.env.UAT_COMPAT_TOKEN_FILE ||
  path.resolve(REPO_ROOT, "..", ".lucy-secrets", "mcp-compat-tokens-uat.json");
const SEED = 20261123;

/** 题库 identities → 落台身份（id／绑定角色）。 */
const IDENTITIES = [
  { id: "uat_compat_demo_readonly", role: "uat_compat_readonly_mysql", uses: "demo_readonly（只读 demo-mysql；deny_readonly_ops 复用）" },
  { id: "uat_compat_demo_ops", role: "lucy_ops_reader", uses: "allow_ops_w0／deny_ops_superstore" },
  { id: "uat_compat_dual_conn", role: "uat_perf_role_a", uses: "dual_conn_readonly（demo-mysql＋lucy-ops 双连接）" },
  { id: "uat_compat_no_query", role: "compat_fixture_no_lucy_query", uses: "deny_no_query" },
  { id: "uat_compat_frozen_w0", role: "compat_fixture_frozen_w0_only", uses: "deny_frozen_w0" },
  { id: "uat_compat_table_a", role: "compat_fixture_table_a_only", uses: "table_a_only" },
  { id: "uat_compat_table_ab", role: "compat_fixture_table_ab", uses: "table_a_allow／table_ab_allow" },
  { id: "uat_compat_fields_masked", role: "compat_fixture_fields_masked", uses: "field_restricted" },
  { id: "uat_compat_fields_full", role: "compat_fixture_fields_full", uses: "field_full" },
  { id: "uat_compat_ops_w1w2", role: "compat_fixture_ops_w1w2", uses: "allow_ops_w1w2" },
  { id: "uat_compat_row_scoped", role: "compat_fixture_row_policy_unproven_gate", uses: "row_scoped_deal" },
];

/** 本脚本新增的辅助角色（测试基建夹具；不改 compat profile 合同语义）。 */
const EXTRA_ROLE_YAML = `  uat_compat_readonly_mysql:
    description: UAT MCP-PERF 只读 demo-mysql 角色（基线夹具，勿用于生产）
    allow:
      connections:
        - demo-mysql
      tableSelectors:
        - connection: demo-mysql
          schema: dataforai
          names:
            - superstore_orders
            - superstore_returns
            - superstore_people
      tools:
        - lucy_catalog
        - connection_list
        - lucy_query
        - lucy_begin_question
        - lucy_continue_question`;

/** token 明文 → 环境变量名（与题库 tokenRef 对齐）。 */
const TOKEN_ENV = new Map([
  ["uat_compat_demo_readonly", "COMPAT_TOKEN_READONLY"],
  ["uat_compat_demo_ops", "COMPAT_TOKEN_DEMO_OPS"],
  ["uat_compat_dual_conn", "COMPAT_TOKEN_DUAL_CONN"],
  ["uat_compat_no_query", "COMPAT_TOKEN_NO_QUERY"],
  ["uat_compat_frozen_w0", "COMPAT_TOKEN_FROZEN_W0"],
  ["uat_compat_table_a", "COMPAT_TOKEN_TABLE_A"],
  ["uat_compat_table_ab", "COMPAT_TOKEN_TABLE_AB"],
  ["uat_compat_fields_masked", "COMPAT_TOKEN_FIELD_RESTRICTED"],
  ["uat_compat_fields_full", "COMPAT_TOKEN_FIELD_FULL"],
  ["uat_compat_ops_w1w2", "COMPAT_TOKEN_OPS_W1W2"],
  ["uat_compat_row_scoped", "COMPAT_TOKEN_ROW_SCOPED"],
]);

function tokenPlain(agentId) {
  return `uat-scale-token|${agentId}|compat1|${SEED}`;
}

function tokenHash(agentId) {
  return "sha256:" + createHash("sha256").update(tokenPlain(agentId)).digest("hex");
}

function docker(...args) {
  return execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

function stopLucy() {
  docker("stop", LUCY);
  console.log(`[seed-compat] 已停止 ${LUCY}`);
}

function startLucyAndWaitHealth() {
  docker("start", LUCY);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync("curl", ["-sf", HEALTH_URL], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      if (out.includes("\"ok\"") || out.includes("gitSha")) {
        console.log("[seed-compat] 健康检查通过 " + HEALTH_URL);
        return;
      }
    } catch { /* retry */ }
    execFileSync("sleep", ["3"]);
  }
  throw new Error("健康检查超时：" + HEALTH_URL);
}

/** 剥离既有 uat_compat_* 用户块（幂等）。 */
function stripCompatUsers(text) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (/^  - id: /.test(line) || /^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
        skipping = false;
      } else {
        continue;
      }
    }
    if (/^  - id: uat_compat_[A-Za-z0-9_]*\s*(#.*)?$/.test(line)) {
      skipping = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function genUserYaml(identity) {
  const lines = [];
  lines.push(`  - id: ${identity.id}`);
  lines.push(`    name: UAT Compat ${identity.id.replace("uat_compat_", "")}`);
  lines.push(`    enabled: true`);
  lines.push(`    note: UAT MCP-PERF 兼容夹具身份（${identity.uses}），请勿用于生产。`);
  lines.push(`    tokens:`);
  lines.push(`      - hash: ${tokenHash(identity.id)}`);
  lines.push(`        label: compat1`);
  lines.push(`        created: 2026-11-26`);
  if (identity.role) lines.push(`    role: ${identity.role}`);
  return lines.join("\n");
}

function writeTokenFile() {
  const tokens = {};
  for (const [id, envName] of TOKEN_ENV) tokens[envName] = tokenPlain(id);
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
  console.log(`[seed-compat] Token 文件已写入 ${TOKEN_FILE}（0600，${Object.keys(tokens).length} 条）`);
}

function main() {
  console.log(`[seed-compat] 目标：compat 专用身份 ${IDENTITIES.length}（角色合同=compat-config-profile.yaml）`);
  const tmp = mkdtempSync(path.join(tmpdir(), "uat-seed-compat-"));

  stopLucy();

  const localYaml = path.join(tmp, "access.yaml");
  docker("cp", `${LUCY}:${ACCESS_YAML}`, localYaml);
  const original = readFileSync(localYaml, "utf8");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const bakLocal = path.join(tmp, "access.yaml.bak");
  writeFileSync(bakLocal, original);
  docker("cp", bakLocal, `${LUCY}:${ACCESS_YAML}.bak-${stamp}`);
  console.log(`[seed-compat] 已备份 ${ACCESS_YAML}.bak-${stamp}`);

  // ① fixtureRoles merge（applyCompatConfigProfile 以 --project-root 方式不可用：
  // 它操作宿主路径；这里直接在容器内以同合同 merge——用其 yaml 的 fixtureRoles 段）。
  const profileYaml = readFileSync(path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-compat-config-profile.yaml"), "utf8");
  const fixtureRolesYaml = profileYaml
    .split(/^fixtureRoles:\s*$/m)[1]
    .split(/^\S/m)[0]
    .replace(/^  /gm, "  ");
  // indent: profile 段键为 2 空格缩进（与 access.yaml roles 同层），直接插到 roles: 后。
  let out = original.replace(/^(roles:\s*)$/m, `$1\n${EXTRA_ROLE_YAML}\n${fixtureRolesYaml.trimEnd()}`);

  // ② 用户块：剥离旧块后插入到 defaults: 之前
  out = stripCompatUsers(out).replace(/\s+$/, "");
  const userBlock = IDENTITIES.map(genUserYaml).join("\n");
  out = out.replace(/^defaults:/m, `${userBlock}\ndefaults:`);
  const finalYaml = out + "\n";
  writeFileSync(localYaml, finalYaml);
  docker("cp", localYaml, `${LUCY}:${ACCESS_YAML}`);
  console.log(`[seed-compat] 已写入 ${ACCESS_YAML}（${finalYaml.split("\n").length} 行）`);

  startLucyAndWaitHealth();

  const verifyJs = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    `const c=y.parse(fs.readFileSync("${ACCESS_YAML}","utf8"));`,
    'const us=(c.users||[]).filter(u=>String(u.id).startsWith("uat_compat_"));',
    'const roles=Object.keys(c.roles||{}).filter(r=>r.startsWith("compat_fixture_"));',
    'const bad=us.filter(u=>u.enabled===false||(u.tokens||[]).length===0||!u.role).length;',
    "console.log(JSON.stringify({users:us.length,fixtureRoles:roles.length,bad}));",
  ].join("");
  const r = JSON.parse(docker("exec", LUCY, "node", "-e", verifyJs).toString());
  console.log(`[seed-compat] 复核：身份 ${r.users}／fixture 角色 ${r.fixtureRoles}／不合规 ${r.bad}`);
  if (r.users < IDENTITIES.length || r.fixtureRoles < 8 || r.bad > 0) {
    console.error("[seed-compat] 复核未达标");
    process.exit(1);
  }

  writeTokenFile();
  console.log("[seed-compat] 完成，compat 专用身份就绪");
}

main();
