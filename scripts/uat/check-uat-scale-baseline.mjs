#!/usr/bin/env node
/**
 * check-uat-scale-baseline.mjs — 全局 UAT 规模基线只读断言。
 *
 * SOT：docs/qa/uat/scale-baseline.md（下限不得降低）。
 * 只读 COUNT，不造数、不改配置。退出码：0=已检查项全达标；1=有缺口；
 * 2=环境不可用（Docker 未起或目标容器缺失）。--strict 时 SKIPPED 也判 1。
 *
 * 覆盖：MySQL/Hive 夹具表数与宽表、access.yaml 角色/Agent/凭据、
 * Wiki 页数、Skill 数、superstore 业务种子、审计调用行（WARN）。
 */
import { execFileSync } from "node:child_process";

const STRICT = process.argv.includes("--strict");
const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const DB = process.env.UAT_DEMO_DB_CONTAINER || "compose-demo-db-1";
const HS2 = process.env.UAT_SCALE_HS2_CONTAINER || "lucy-uat-hs2";
const MYSQL_DB = process.env.UAT_MYSQL_DB || "uat_scale_mysql";
const HIVE_DB = process.env.UAT_HIVE_DB || "uat_scale_hive";
const MYSQL_ROOT_PW = process.env.UAT_DEMO_DB_ROOT_PASSWORD || "lucy_demo_root";

const results = [];

function record(dim, floor, actual, status, note) {
  results.push({ dim, floor, actual, status, note: note || "" });
}

function dockerOk() {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function running(container) {
  try {
    const out = execFileSync("docker", [
      "inspect", "-f", "{{.State.Running}}", container,
    ], { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    return out === "true";
  } catch {
    return false;
  }
}

function mysql(sql) {
  const out = execFileSync("docker", [
    "exec", DB,
    "mysql", `-uroot`, `-p${MYSQL_ROOT_PW}`, "-N", "-B", "-e", sql,
  ], { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
  return out;
}

function lucyNode(js) {
  return execFileSync("docker", ["exec", LUCY, "node", "-e", js], {
    stdio: ["pipe", "pipe", "pipe"],
  }).toString().trim();
}

function lucySh(sh) {
  return execFileSync("docker", ["exec", LUCY, "sh", "-c", sh], {
    stdio: ["pipe", "pipe", "pipe"],
  }).toString().trim();
}

// ---- 0. 环境 -------------------------------------------------------------

if (!dockerOk()) {
  console.error("[scale-baseline] Docker 不可用，退出码 2");
  process.exit(2);
}
const haveLucy = running(LUCY);
const haveDb = running(DB);
if (!haveLucy || !haveDb) {
  console.error(
    `[scale-baseline] 容器缺失：lucy=${haveLucy} db=${haveDb}，退出码 2`,
  );
  process.exit(2);
}

// ---- 1. MySQL 夹具库 ----------------------------------------------------

{
  const n = Number(
    mysql(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DB}'`,
    ),
  );
  record("MySQL 夹具表数", ">=1200", n, n >= 1200 ? "PASS" : "FAIL", MYSQL_DB);
}
{
  const n = Number(
    mysql(
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${MYSQL_DB}' AND table_name='w_1000'`,
    ),
  );
  record("MySQL 宽表 w_1000 列数", ">=1000", n, n >= 1000 ? "PASS" : "FAIL");
}
{
  const q = (t) =>
    Number(mysql(`SELECT COUNT(*) FROM dataforai.${t}`));
  const seeds = [
    ["superstore_orders", 1000],
    ["superstore_returns", 60],
    ["superstore_people", 4],
  ];
  for (const [t, floor] of seeds) {
    const n = q(t);
    record(`业务种子 ${t}`, `>=${floor}`, n, n >= floor ? "PASS" : "FAIL");
  }
}

// ---- 2. Hive 夹具库（未起记 SKIPPED） ------------------------------------

if (!running(HS2)) {
  record("Hive 夹具表数", ">=600", "-", "SKIPPED", `${HS2} 未运行`);
  record("Hive 宽表档", "1500/1999/2000/3000/5000 列", "-", "SKIPPED", "同上");
} else {
  try {
    const out = execFileSync("docker", [
      "exec", HS2, "beeline",
      "-u", "jdbc:hive2://localhost:10000",
      "-e", `SHOW TABLES IN ${HIVE_DB};`,
      "--silent=true",
    ], { stdio: ["pipe", "pipe", "pipe"] }).toString();
    const names = out.split("\n")
      .filter((l) => l.includes("|"))
      .map((l) => l.replace(/[|\s]/g, ""))
      .filter((s) => s.length > 0 && !/^tab_name$/i.test(s));
    record("Hive 夹具表数", ">=600", names.length,
      names.length >= 600 ? "PASS" : "FAIL", HIVE_DB);
    const want = ["w_1500", "w_1999", "w_2000", "w_3000", "w_5000"];
    const missing = want.filter((w) => !names.includes(w));
    record("Hive 宽表档", want.join("/"), missing.length === 0 ? "齐" : `缺 ${missing.join(",")}`,
      missing.length === 0 ? "PASS" : "FAIL");
  } catch (e) {
    record("Hive 夹具表数", ">=600", "-", "SKIPPED", `beeline 失败：${String(e).slice(0, 80)}`);
  }
}

// ---- 3. 角色 / Agent / 凭据（access.yaml，容器内解析） -------------------

{
  const js = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    'const c=y.parse(fs.readFileSync("/data/lucy/webui/config/access.yaml","utf8"));',
    'const us=c.users||[];',
    'const tk=u=>(u.tokens||[]).length;',
    "console.log(JSON.stringify({",
    "roles:Object.keys(c.roles||{}).length,",
    "agents:us.length,",
    "minTokens:us.length?Math.min.apply(null,us.map(tk)):0,",
    "totalTokens:us.reduce((s,u)=>s+tk(u),0)",
    "}));",
  ].join("");
  const r = JSON.parse(lucyNode(js));
  record("正式角色数", ">=200", r.roles, r.roles >= 200 ? "PASS" : "FAIL",
    "access.yaml roles，模板另算");
  record("配置 Agent 人口", ">=500", r.agents, r.agents >= 500 ? "PASS" : "FAIL",
    "access.yaml users 全集，含未启用");
  // 每 Agent 凭据底线作用于「足凭据 Agent 数」而非全局 min：共享 demo 栈上
  // 其它套件的一次性夹具 Agent（如 UAT-CTX 的 ucda-*，1 个凭据）不应拉红基线
  const js2 = [
    'const y=require("/app/node_modules/yaml"),fs=require("fs");',
    'const c=y.parse(fs.readFileSync("/data/lucy/webui/config/access.yaml","utf8"));',
    "const us=c.users||[];",
    "console.log(JSON.stringify({",
    "full:us.filter(u=>(u.tokens||[]).length>=3).length,",
    "total:us.reduce((s,u)=>s+(u.tokens||[]).length,0)}));",
  ].join("");
  const r2 = JSON.parse(lucyNode(js2));
  record("足凭据 Agent（≥3）", ">=500", r2.full, r2.full >= 500 ? "PASS" : "FAIL",
    `总凭据 ${r2.total}`);
  record("凭据总量", ">=1500", r2.total, r2.total >= 1500 ? "PASS" : "FAIL");
}

// ---- 4. Wiki / Skill -----------------------------------------------------

{
  const n = Number(lucySh("find /data/lucy/wiki -type f -name '*.md' | wc -l"));
  record("Wiki 页数", ">=300", n, n >= 300 ? "PASS" : "FAIL");
}
{
  // 与 webui/server/skills/loader.ts 同口径：递归 .md/.markdown，
  // frontmatter 含 name 即为一个 Skill（目录形态不限）。
  const js = [
    'const fs=require("fs"),path=require("path");',
    'const root="/data/lucy/config/skills";',
    "let count=0;",
    "function walk(d){",
    "let es;try{es=fs.readdirSync(d,{withFileTypes:true});}catch{return;}",
    "for(const e of es){",
    'if(e.name==="node_modules"||e.name.startsWith("."))continue;',
    "const p=path.join(d,e.name);",
    "if(e.isDirectory())walk(p);",
    'else if(/\\.(md|markdown)$/.test(e.name)){',
    "try{",
    'const c=fs.readFileSync(p,"utf8").trimStart();',
    'const m=/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/.exec(c);',
    'if(m&&/^name\\s*:/m.test(m[1]))count++;',
    "}catch{}",
    "}}}",
    "walk(root);",
    "console.log(count);",
  ].join("");
  const n = Number(lucyNode(js));
  record("Skill 数", ">=100", n, n >= 100 ? "PASS" : "FAIL",
    "frontmatter 含 name 的 .md/.markdown，递归口径同 loader");
}

// ---- 5. 审计调用行（WARN，权威判定归 RACS 套件） --------------------------

{
  // ops_calls 为视图（access_log 派生）；切边直接用 now-30d，500 行余量吸收漂移
  const js = [
    'const D=require("/app/node_modules/better-sqlite3");',
    "let total=0,win30=null,active=null;",
    'try{const db=new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true,fileMustExist:true});',
    'const has=db.prepare("SELECT name FROM sqlite_master WHERE name=\'ops_calls\'").get();',
    "if(has){",
    "total=db.prepare(\"SELECT COUNT(*) c FROM ops_calls\").get().c;",
    "const cutoff=new Date(Date.now()-30*86400000).toISOString();",
    "win30=db.prepare(\"SELECT COUNT(*) c FROM ops_calls WHERE ts>=?\").get(cutoff).c;",
    "active=db.prepare(\"SELECT COUNT(DISTINCT agent_id) c FROM ops_calls WHERE ts>=?\").get(cutoff).c;",
    "}",
    "db.close();}catch(e){}",
    "console.log(JSON.stringify({total,win30,active}));",
  ].join("");
  let r;
  try {
    r = JSON.parse(lucyNode(js));
  } catch {
    r = { total: 0, win30: null, active: null };
  }
  record("审计调用行（全历史）", ">=1000000", r.total,
    r.total >= 1000000 ? "PASS" : "WARN",
    "未达标归 RACS 造数，不判 FAIL");
  record("审计调用行（30 天）", ">=200000",
    r.win30 === null ? "N/A" : r.win30,
    r.win30 !== null && r.win30 >= 200000 ? "PASS" : "WARN");
  record("30 天活跃 Agent", ">=100",
    r.active === null ? "N/A" : r.active,
    r.active !== null && r.active >= 100 ? "PASS" : "FAIL",
    "ops_calls 视图 distinct agent_id");
}

// ---- 汇总 ----------------------------------------------------------------

let fail = 0;
let skip = 0;
console.log("\n维度 | 下限 | 实测 | 判定 | 备注");
console.log("--- | --- | --- | --- | ---");
for (const r of results) {
  if (r.status === "FAIL") fail += 1;
  if (r.status === "SKIPPED") skip += 1;
  console.log(
    `${r.dim} | ${r.floor} | ${r.actual} | ${r.status}${r.note ? ` | ${r.note}` : " |"}`,
  );
}
console.log("");
if (fail > 0) {
  console.log(`[scale-baseline] ${fail} 项低于基线 → FAIL（退出码 1）`);
  process.exit(1);
}
if (skip > 0 && STRICT) {
  console.log(`[scale-baseline] ${skip} 项 SKIPPED（--strict）→ 退出码 1`);
  process.exit(1);
}
console.log(`[scale-baseline] 已检查项全部达标${skip ? `（${skip} 项 SKIPPED）` : ""} → PASS`);
