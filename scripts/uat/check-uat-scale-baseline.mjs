#!/usr/bin/env node
/**
 * check-uat-scale-baseline.mjs — 全局 UAT 规模基线只读断言。
 *
 * SOT：docs/qa/uat/scale-baseline.md（下限不得降低）。
 * 只读 COUNT，不造数、不改配置。退出码：0=已检查项全达标；1=有缺口；
 * 2=环境不可用（Docker 未起、目标容器缺失或参数错误）。--strict 时 SKIPPED 也判 1。
 *
 * 默认档覆盖：MySQL/Hive 夹具表数与宽表、access.yaml 角色/Agent/凭据、
 * Wiki 页数、Skill 数、superstore 业务种子、审计调用行（WARN）。
 * 不带 --profile 时断言项、判定口径与退出码与既有版本一致。
 *
 * 专项档：`--profile mcp-perf`（或 `--profile=mcp-perf`）追加 §1.1 MCP-PERF
 * profile 断言（P1-78 前置，委托人 2026-11-26 授权测试基建）。除 COUNT 外还含
 * 运行时核验：50 压测身份真实 Public MCP 调用对账（不同 Token→不同 user_id、
 * 审计 role_ids∋配置角色、连接可见性）、wiki_search 真实命中合成标记、
 * lucy_skill_read 真实读到指定 Skill、lucy_admin 全局 Source 集合与跨连接
 * oracle 查询。全部为只读调用，不写库。§1.1 的「持续压力到达模型」与
 * 「长链实例」两行不是库内计数，按 SOT 约定由 P1-78 判定器读取，本脚本不断言。
 *
 * profile 身份口径：access.yaml 中 id 以 UAT_MCP_PERF_AGENT_PREFIX（默认
 * uat_perf_）开头的 Agent。运行时凭据从仓外 0600 JSON 文件注入
 * （UAT_MCP_PERF_TOKEN_FILE，形如 {"tokens":{"<agentId>":"<token>"}}；
 * 也接受顶层平铺 {agentId: token}），凭据只在内存使用，不打印、不落盘。
 * 缺身份／缺凭据／缺命中均判 FAIL——§1.1 未达标时 P1-78 相关套件凭非零
 * 退出码记 BLOCKED，不得缩规模开跑。
 *
 * 数据访问全部经 createRealDeps() 注入；单测用替身 deps 覆盖，不依赖真实栈。
 * 测试：scripts/uat/__tests__/check-uat-scale-baseline.test.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// ---- 参数与环境 -------------------------------------------------------------

const PROFILES = new Set(["mcp-perf"]);

const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const DB = process.env.UAT_DEMO_DB_CONTAINER || "compose-demo-db-1";
const HS2 = process.env.UAT_SCALE_HS2_CONTAINER || "lucy-uat-hs2";
const MYSQL_DB = process.env.UAT_MYSQL_DB || "uat_scale_mysql";
const HIVE_DB = process.env.UAT_HIVE_DB || "uat_scale_hive";
const MYSQL_ROOT_PW = process.env.UAT_DEMO_DB_ROOT_PASSWORD || "lucy_demo_root";

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function parseArgs(argv) {
  let strict = false;
  let profile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") strict = true;
    else if (a === "--profile") profile = argv[++i] ?? "";
    else if (a.startsWith("--profile=")) profile = a.slice("--profile=".length);
    else return { error: `未知参数：${a}（支持 --strict、--profile mcp-perf）` };
  }
  if (profile !== null && !PROFILES.has(profile)) {
    return { error: `未知 profile：${profile || "(空)"}（可选：mcp-perf）` };
  }
  return { strict, profile };
}

/** MCP-PERF profile 可调项（均有默认值；标识符类做白名单校验，拒绝 LIKE/路径注入）。 */
export function perfOptions(env) {
  const num = (v, d) => {
    if (v === undefined || v === "") return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`数值型环境变量非法：${v}`);
    return n;
  };
  const ident = (v, d, name) => {
    const s = v === undefined || v === "" ? d : String(v).trim();
    if (!ID_RE.test(s)) throw new Error(`${name} 含非法字符：${s}`);
    return s;
  };
  const identList = (v, d, name) => {
    const raw = v === undefined || v === "" ? d : String(v);
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of list) {
      if (!ID_RE.test(s)) throw new Error(`${name} 含非法字符：${s}`);
    }
    return list;
  };
  return {
    prefix: ident(env.UAT_MCP_PERF_AGENT_PREFIX, "uat_perf_", "UAT_MCP_PERF_AGENT_PREFIX"),
    wantIdentities: num(env.UAT_MCP_PERF_IDENTITIES, 50),
    adminMin: num(env.UAT_MCP_PERF_ADMIN_MIN, 2),
    tokenFile: env.UAT_MCP_PERF_TOKEN_FILE || "",
    mcpUrl: env.LUCY_MCP_URL ||
      `http://127.0.0.1:${env.LUCY_DEMO_PROXY_HOST_PORT || 57881}/mcp`,
    wikiMarker: ident(env.UAT_MCP_PERF_WIKI_MARKER, "uat-wiki-001", "UAT_MCP_PERF_WIKI_MARKER"),
    // KTX FTS 只分 ASCII 词：检索词用标记页正文的英文锚词，与文件名 marker 分离。
    wikiQuery: env.UAT_MCP_PERF_WIKI_QUERY || "uat wiki marker",
    skillName: ident(env.UAT_MCP_PERF_SKILL_NAME, "uat-skill-001", "UAT_MCP_PERF_SKILL_NAME"),
    skillMarker: env.UAT_MCP_PERF_SKILL_MARKER || "",
    reqPrefix: ident(env.UAT_MCP_PERF_REQ_PREFIX, "uat-scale-", "UAT_MCP_PERF_REQ_PREFIX"),
    noHistoryAgent: ident(env.UAT_MCP_PERF_NO_HISTORY_AGENT, "uat_agent_498", "UAT_MCP_PERF_NO_HISTORY_AGENT"),
    ninetyDayAgent: ident(env.UAT_MCP_PERF_NINETY_DAY_AGENT, "uat_agent_497", "UAT_MCP_PERF_NINETY_DAY_AGENT"),
    boundaryAgents: identList(
      env.UAT_MCP_PERF_BOUNDARY_AGENTS,
      "uat_agent_002,uat_agent_003,uat_agent_004",
      "UAT_MCP_PERF_BOUNDARY_AGENTS",
    ),
    queryConnections: identList(
      env.UAT_MCP_PERF_QUERY_CONNECTIONS,
      "demo-mysql,lucy-ops",
      "UAT_MCP_PERF_QUERY_CONNECTIONS",
    ),
    baselineJson: env.UAT_MCP_PERF_BASELINE_JSON ||
      new URL("../../examples/docker-demo/mysql/_baseline.json", import.meta.url),
    floorAuditTotal: num(env.UAT_MCP_PERF_AUDIT_TOTAL, 1000507),
    floorAuditWindow: num(env.UAT_MCP_PERF_AUDIT_WINDOW, 200498),
    floorActiveAgents: num(env.UAT_MCP_PERF_ACTIVE_AGENTS, 499),
    floorHottest: num(env.UAT_MCP_PERF_HOTTEST, 40100),
    floorTableTotal: num(env.UAT_MCP_PERF_TABLE_TOTAL, 2000),
    auditSettleMs: num(env.UAT_MCP_PERF_AUDIT_SETTLE_MS, 15000),
  };
}

// ---- 真实数据访问层（docker exec 只读；MCP 只读调用） -------------------------

function createRealDeps(env = process.env) {
  const dockerOut = (args, input) =>
    execFileSync("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      input,
      maxBuffer: 512 * 1024 * 1024,
    }).toString().trim();

  const lucyNode = (js) => dockerOut(["exec", LUCY, "node", "-e", js]);
  const lucySh = (sh) => dockerOut(["exec", LUCY, "sh", "-c", sh]);

  // 容器内只读 better-sqlite3；SQL 与参数经 stdin JSON 传入，避免转义问题。
  const auditQuery = (sql, params = []) => {
    const script = [
      'const D=require("/app/node_modules/better-sqlite3");',
      'const db=new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true,fileMustExist:true});',
      'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{',
      "const {sql,params}=JSON.parse(b);",
      "console.log(JSON.stringify(db.prepare(sql).all(...params)))});",
    ].join("");
    const out = dockerOut(["exec", "-i", LUCY, "node", "-e", script], JSON.stringify({ sql, params }));
    return JSON.parse(out);
  };

  // MCP JSON-RPC（SSE 信封兼容）；Bearer 只在内存使用。
  const parseRpc = (text) => {
    const trimmed = text.replace(/^event: message\ndata: /, "").trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: text.slice(0, 300) };
    }
  };
  // mcpUrl 惰性解析：默认档不因 UAT_MCP_PERF_* 环境变量非法而受影响
  const mcpUrl = () => {
    try {
      return perfOptions(env).mcpUrl;
    } catch {
      return `http://127.0.0.1:${env.LUCY_DEMO_PROXY_HOST_PORT || 57881}/mcp`;
    }
  };
  async function mcpRpc(token, body, session) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    };
    if (session) headers["mcp-session-id"] = session;
    const res = await fetch(mcpUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return { status: res.status, text, json: parseRpc(text), session: res.headers.get("mcp-session-id") };
  }
  async function mcpOpen(token) {
    const init = await mcpRpc(token, {
      jsonrpc: "2.0",
      id: `init-${Math.random().toString(36).slice(2, 8)}`,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "uat-scale-baseline", version: "0" } },
    });
    if (init.status === 200 && init.session) {
      await mcpRpc(token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
    }
    return init;
  }
  async function mcpCallTool(token, session, name, args) {
    const r = await mcpRpc(token, {
      jsonrpc: "2.0",
      id: `call-${Math.random().toString(36).slice(2, 8)}`,
      method: "tools/call",
      params: { name, arguments: args },
    }, session);
    const result = r.json?.result;
    return {
      status: r.status,
      json: r.json,
      text: result?.content?.[0]?.text ?? "",
      data: result?.data ?? result?.structuredContent,
      isError: result?.isError === true,
    };
  }

  return {
    env,
    dockerOk() {
      try {
        execFileSync("docker", ["info"], { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    },
    running(container) {
      try {
        const out = dockerOut(["inspect", "-f", "{{.State.Running}}", container]);
        return out === "true";
      } catch {
        return false;
      }
    },
    mysql(sql) {
      return dockerOut([
        "exec", DB,
        "mysql", `-uroot`, `-p${MYSQL_ROOT_PW}`, "-N", "-B", "-e", sql,
      ]);
    },
    hiveShowTablesRaw(dbName) {
      return dockerOut([
        "exec", HS2, "beeline",
        "-u", "jdbc:hive2://localhost:10000",
        "-e", `SHOW TABLES IN ${dbName};`,
        "--silent=true",
      ]);
    },
    lucySh,
    readAccessConfig() {
      const js = [
        'const y=require("/app/node_modules/yaml"),fs=require("fs");',
        'console.log(JSON.stringify(y.parse(fs.readFileSync("/data/lucy/webui/config/access.yaml","utf8"))));',
      ].join("");
      return JSON.parse(lucyNode(js));
    },
    readKtxConnectionIds() {
      const js = [
        'const y=require("/app/node_modules/yaml"),fs=require("fs");',
        'const c=y.parse(fs.readFileSync("/data/lucy/ktx.yaml","utf8"));',
        "console.log(JSON.stringify(Object.keys((c&&c.connections)||{})));",
      ].join("");
      return JSON.parse(lucyNode(js));
    },
    /** 读取 Wiki 页 frontmatter（如 global/uat-wiki-001.md）；不存在返回 null。 */
    readWikiPageFrontmatter(key) {
      const js = [
        'const y=require("/app/node_modules/yaml"),fs=require("fs");',
        "let out=null;",
        "try{",
        `const c=fs.readFileSync("/data/lucy/wiki/${key}","utf8").trimStart();`,
        "const m=/^---\\r?\\n([\\s\\S]*?)\\r?\\n---/.exec(c);",
        "if(m)out=y.parse(m[1]);",
        "}catch(e){}",
        "console.log(JSON.stringify(out));",
      ].join("");
      return JSON.parse(lucyNode(js));
    },
    countWikiFiles() {
      // global scope 口径（与 §4 seed／wiki 命中断言一致）：未就绪连接（如
      // lucy-ops）的 scope 页不随 KTX 索引，计入文件数会误报索引覆盖缺口。
      return Number(lucySh("find /data/lucy/wiki/global -type f -name '*.md' | wc -l"));
    },
    countSkillsLoader() {
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
      return Number(lucyNode(js));
    },
    /** KTX Wiki 索引（knowledge_pages）行数；库不存在返回 0（与 seed 复核同口径）。 */
    ktxWikiIndexedCount() {
      const js = [
        'const D=require("/app/node_modules/better-sqlite3");',
        "let n=0;",
        "try{",
        'const db=new D("/data/lucy/.ktx/db.sqlite",{readonly:true,fileMustExist:true});',
        'n=db.prepare("SELECT COUNT(*) c FROM knowledge_pages").get().c;',
        "db.close();}catch(e){}",
        "console.log(n);",
      ].join("");
      return Number(lucyNode(js));
    },
    /** 默认档 §5 既有口径：ops_calls 全历史／30 天窗／窗内活跃 Agent。 */
    baseAuditCounts() {
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
      return JSON.parse(lucyNode(js));
    },
    auditQuery,
    readBaselineJson() {
      // env 闭包：perfOptions 的 o 在 main 内才构造，deps 闭包里不可见。
      const p = env.UAT_MCP_PERF_BASELINE_JSON ||
        new URL("../../examples/docker-demo/mysql/_baseline.json", import.meta.url);
      return JSON.parse(readFileSync(p, "utf8"));
    },
    readTokenFile(path) {
      return JSON.parse(readFileSync(path, "utf8"));
    },
    mcpOpen,
    mcpCallTool,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

// ---- 默认档（§1–§5 既有断言，口径不变） --------------------------------------

export function collectBaseResults(deps) {
  const results = [];
  const ctx = {};
  const record = (dim, floor, actual, status, note) => {
    results.push({ dim, floor, actual, status, note: note || "" });
  };

  // ---- 1. MySQL 夹具库 ----
  {
    const n = Number(
      deps.mysql(
        `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DB}'`,
      ),
    );
    record("MySQL 夹具表数", ">=1200", n, n >= 1200 ? "PASS" : "FAIL", MYSQL_DB);
    ctx.mysqlTables = n;
  }
  {
    const n = Number(
      deps.mysql(
        `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${MYSQL_DB}' AND table_name='w_1000'`,
      ),
    );
    record("MySQL 宽表 w_1000 列数", ">=1000", n, n >= 1000 ? "PASS" : "FAIL");
  }
  {
    const seeds = [
      ["superstore_orders", 1000],
      ["superstore_returns", 60],
      ["superstore_people", 4],
    ];
    for (const [t, floor] of seeds) {
      const n = Number(deps.mysql(`SELECT COUNT(*) FROM dataforai.${t}`));
      record(`业务种子 ${t}`, `>=${floor}`, n, n >= floor ? "PASS" : "FAIL");
    }
  }

  // ---- 2. Hive 夹具库（未起记 SKIPPED） ----
  let hiveTables = null;
  if (!deps.running(HS2)) {
    record("Hive 夹具表数", ">=600", "-", "SKIPPED", `${HS2} 未运行`);
    record("Hive 宽表档", "1500/1999/2000/3000/5000 列", "-", "SKIPPED", "同上");
  } else {
    try {
      const out = deps.hiveShowTablesRaw(HIVE_DB);
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
      hiveTables = names.length;
    } catch (e) {
      record("Hive 夹具表数", ">=600", "-", "SKIPPED", `beeline 失败：${String(e).slice(0, 80)}`);
    }
  }
  ctx.hiveTables = hiveTables;

  // ---- 3. 角色 / Agent / 凭据（access.yaml，容器内解析） ----
  {
    const c = deps.readAccessConfig();
    const us = c.users || [];
    const tk = (u) => (u.tokens || []).length;
    const roles = Object.keys(c.roles || {}).length;
    const agents = us.length;
    record("正式角色数", ">=200", roles, roles >= 200 ? "PASS" : "FAIL",
      "access.yaml roles，模板另算");
    record("配置 Agent 人口", ">=500", agents, agents >= 500 ? "PASS" : "FAIL",
      "access.yaml users 全集，含未启用");
    // 每 Agent 凭据底线作用于「足凭据 Agent 数」而非全局 min：共享 demo 栈上
    // 其它套件的一次性夹具 Agent（如 UAT-CTX 的 ucda-*，1 个凭据）不应拉红基线
    const full = us.filter((u) => tk(u) >= 3).length;
    const total = us.reduce((s, u) => s + tk(u), 0);
    record("足凭据 Agent（≥3）", ">=500", full, full >= 500 ? "PASS" : "FAIL",
      `总凭据 ${total}`);
    record("凭据总量", ">=1500", total, total >= 1500 ? "PASS" : "FAIL");
    ctx.accessConfig = c;
    ctx.rolesCount = roles;
  }

  // ---- 4. Wiki / Skill ----
  {
    const n = deps.countWikiFiles();
    record("Wiki 页数", ">=300", n, n >= 300 ? "PASS" : "FAIL");
    ctx.wikiFiles = n;
  }
  {
    const n = deps.countSkillsLoader();
    record("Skill 数", ">=100", n, n >= 100 ? "PASS" : "FAIL",
      "frontmatter 含 name 的 .md/.markdown，递归口径同 loader");
    ctx.skillCount = n;
  }

  // ---- 5. 审计调用行（WARN，权威判定归 RACS 套件） ----
  {
    let r;
    try {
      r = deps.baseAuditCounts();
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

  return { results, ctx };
}

// ---- MCP-PERF profile（§1.1）：纯判定函数 ------------------------------------

const roleConnections = (roleDef) => {
  const c = roleDef?.allow?.connections;
  return Array.isArray(c) ? c : [];
};
const roleTools = (roleDef) => {
  const t = roleDef?.allow?.tools;
  return Array.isArray(t) ? t : [];
};
const isGlobalRole = (roleDef) => roleConnections(roleDef).includes("*");

/** §1.1 压测身份（配置层）：身份数／互异自有 Token／lucy_admin 绑定／受限分组／正式角色构成。 */
export function evaluatePerfIdentityConfig(config, o) {
  const results = [];
  const record = (dim, floor, actual, status, note) => {
    results.push({ dim, floor, actual, status, note: note || "" });
  };
  const users = config.users || [];
  const roles = config.roles || {};
  const named = users.filter((u) => typeof u.id === "string" && u.id.startsWith(o.prefix));
  const invalid = named.filter((u) =>
    typeof u.name !== "string" || u.name.trim() === "" ||
    u.enabled === false ||
    (u.tokens || []).length === 0 ||
    typeof u.role !== "string" || u.role === ""
  );
  const valid = named.filter((u) => !invalid.includes(u));

  record("MCP-PERF 压测 Agent 身份数", `>=${o.wantIdentities}`, valid.length,
    valid.length >= o.wantIdentities && invalid.length === 0 ? "PASS" : "FAIL",
    `前缀 ${o.prefix}*；具名+启用+自有凭据+绑定角色` +
      (invalid.length ? `；不合规 ${invalid.length}：${invalid.slice(0, 5).map((u) => u.id).join(",")}` : ""));

  // 身份互异：不同 Agent ID、各持自有 Token、跨身份凭据哈希两两不同——
  // 单个直连脚本轮换同一 Token 在这里无法冒充 50 身份。
  const dupIds = named.map((u) => u.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  const hashOwner = new Map();
  const shared = [];
  for (const u of valid) {
    for (const t of u.tokens || []) {
      const h = typeof t === "object" && t !== null ? String(t.hash || "") : String(t);
      if (!h) continue;
      if (hashOwner.has(h) && hashOwner.get(h) !== u.id) shared.push(`${h.slice(0, 19)}…(${hashOwner.get(h)}/${u.id})`);
      else hashOwner.set(h, u.id);
    }
  }
  const distinctTokens = hashOwner.size;
  record("MCP-PERF 身份互异（自有 Token）", `${o.wantIdentities} 身份凭据两两不同`,
    `${valid.length} 身份 / ${distinctTokens} 互异凭据`,
    dupIds.length === 0 && shared.length === 0 && distinctTokens >= valid.length && valid.length > 0 ? "PASS" : "FAIL",
    (dupIds.length ? `重复 Agent ID：${[...new Set(dupIds)].slice(0, 5).join(",")}；` : "") +
    (shared.length ? `跨身份共享凭据：${shared.slice(0, 3).join(",")}` : "不同身份不同 Token"));

  const admins = valid.filter((u) => u.role === "lucy_admin");
  const adminGlobal = isGlobalRole(roles.lucy_admin);
  record("MCP-PERF lucy_admin 绑定身份", `>=${o.adminMin}`, admins.length,
    admins.length >= o.adminMin && adminGlobal ? "PASS" : "FAIL",
    adminGlobal ? `绑定：${admins.slice(0, 5).map((u) => u.id).join(",")}` : "roles.lucy_admin 缺失或 connections 不含 \"*\"");

  const restricted = valid.filter((u) => u.role !== "lucy_admin");
  const badRole = restricted.filter((u) => !roles[u.role] || isGlobalRole(roles[u.role]));
  const groups = new Map();
  for (const u of restricted) {
    if (!roles[u.role] || isGlobalRole(roles[u.role])) continue;
    groups.set(u.role, (groups.get(u.role) || 0) + 1);
  }
  record("MCP-PERF 受限角色分组", ">=2 个受限角色组", groups.size,
    badRole.length === 0 && groups.size >= 2 ? "PASS" : "FAIL",
    (badRole.length ? `角色未定义或为全局：${badRole.slice(0, 5).map((u) => `${u.id}→${u.role}`).join(",")}；` : "") +
    [...groups.entries()].slice(0, 6).map(([r, n]) => `${r}×${n}`).join("，"));

  const roleCount = Object.keys(roles).length;
  const restrictedFormal = Object.entries(roles)
    .filter(([id, r]) => id !== "lucy_admin" && !isGlobalRole(r));
  record("MCP-PERF 正式角色构成", ">=200 含 lucy_admin 全局＋受限",
    `${roleCount} 角色 / lucy_admin ${adminGlobal ? "全局" : "非全局或缺失"} / 受限 ${restrictedFormal.length}`,
    roleCount >= 200 && adminGlobal && restrictedFormal.length >= 2 ? "PASS" : "FAIL",
    "access.yaml roles；运行时生效绑定见「运行时角色绑定」行");

  return { results, identities: valid, roles };
}

/** §1.1 审计行量与活跃（ops_calls 视图口径，FAIL 档）。 */
export function evaluateAuditFloors(c, o) {
  const results = [];
  const record = (dim, floor, actual, status, note) => {
    results.push({ dim, floor, actual, status, note: note || "" });
  };
  record("MCP-PERF 审计调用行（全历史）", `>=${o.floorAuditTotal}`, c.total,
    c.total >= o.floorAuditTotal ? "PASS" : "FAIL", "ops_calls 视图实测");
  record("MCP-PERF 审计调用行（30 天）", `>=${o.floorAuditWindow}`, c.win30,
    c.win30 >= o.floorAuditWindow ? "PASS" : "FAIL", "含边界行余量吸收切边漂移");
  record("MCP-PERF 30 天活跃 Agent", `>=${o.floorActiveAgents}`, c.active,
    c.active >= o.floorActiveAgents ? "PASS" : "FAIL",
    "ops_calls 视图 distinct agent_id（默认用量∧自追问排除口径）");
  const share = c.win30 > 0 ? ((c.hottestCount / c.win30) * 100).toFixed(1) : "0.0";
  record("MCP-PERF 最热单 Agent（窗内）", `>=${o.floorHottest}`,
    c.hottestCount,
    c.hottestCount >= o.floorHottest ? "PASS" : "FAIL",
    `${c.hottestAgent || "-"} 占窗内 ${share}%（按 agent_id 聚合窗内行数）`);
  return results;
}

/** 在按 ts 排序的边界行中找 t−1/t/t+1 三连毫秒组，且归属与期望 Agent 顺序一致。 */
export function findBoundaryTriple(rows, expectedAgents) {
  const pts = rows
    .map((r) => ({ id: r.request_id, user: r.user_id, ms: Date.parse(r.ts) }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  for (let i = 0; i + 2 < pts.length; i++) {
    if (pts[i + 1].ms === pts[i].ms + 1 && pts[i + 2].ms === pts[i].ms + 2) {
      const users = [pts[i].user, pts[i + 1].user, pts[i + 2].user];
      const attributionOk = expectedAgents.length === 0 ||
        (users.length === expectedAgents.length && users.every((u, k) => u === expectedAgents[k]));
      return { found: true, attributionOk, users, baseMs: pts[i].ms };
    }
  }
  return { found: false, attributionOk: false, users: [], baseMs: null };
}

/** §1.1 集中与边界形态（视图／独立 SQL 逐项核对存在且归属正确）。 */
export function evaluateBoundaryShapes(s, o) {
  const results = [];
  const record = (dim, floor, actual, status, note) => {
    results.push({ dim, floor, actual, status, note: note || "" });
  };

  const dist = [...(s.windowDist || [])].sort((a, b) => b.c - a.c);
  const total = dist.reduce((sum, r) => sum + r.c, 0);
  const topN = Math.max(1, Math.ceil(0.2 * dist.length));
  const topSum = dist.slice(0, topN).reduce((sum, r) => sum + r.c, 0);
  const share = total > 0 ? topSum / total : 0;
  record("MCP-PERF 80/20 集中", "top 20% Agent ≥80% 窗内行",
    total > 0 ? `${(share * 100).toFixed(1)}%` : "N/A",
    total > 0 && share >= 0.8 ? "PASS" : "FAIL",
    `top ${topN}/${dist.length} Agent 占 ${topSum}/${total} 行`);

  const triple = findBoundaryTriple(s.boundary || [], o.boundaryAgents);
  record("MCP-PERF 窗边界前后各一条", "t−1/t/t+1 三连＋归属",
    (s.boundary || []).length,
    triple.found && triple.attributionOk ? "PASS" : "FAIL",
    triple.found
      ? `三连归属 ${triple.users.join("/")}（期望 ${o.boundaryAgents.join("/")}）；切边漂移后绝对位置不属判定`
      : `未找到三连毫秒边界组（${(s.boundary || []).length} 行）`);

  const byMs = new Map();
  for (const r of s.samems || []) {
    const k = String(r.ts);
    if (!byMs.has(k)) byMs.set(k, new Set());
    byMs.get(k).add(r.request_id);
  }
  const maxSameMs = Math.max(0, ...[...byMs.values()].map((set) => set.size));
  record("MCP-PERF 同毫秒不同 id", "同 ts ≥2 行不同 request_id", maxSameMs,
    maxSameMs >= 2 ? "PASS" : "FAIL", `${(s.samems || []).length} 行候选`);

  const noHistConfigured = (s.configuredAgents || new Set()).has(o.noHistoryAgent);
  record("MCP-PERF 无历史 Agent", "在册且全历史 0 行",
    `${o.noHistoryAgent} ${s.noHistoryRows} 行`,
    noHistConfigured && s.noHistoryRows === 0 ? "PASS" : "FAIL",
    noHistConfigured ? "access.yaml 在册" : `${o.noHistoryAgent} 未在 access.yaml 在册`);

  const ninetyOldEnough = s.ninety && s.ninety.oldEnough === 1;
  record("MCP-PERF 仅 90 天前活跃 Agent", "窗内 0 行且历史 ≥1 行（最晚 ≤now−60d）",
    s.ninety ? `窗内 ${s.ninety.win || 0} / 全历史 ${s.ninety.c} / 最晚 ${s.ninety.m || "-"}` : "N/A",
    s.ninety && (s.ninety.win || 0) === 0 && s.ninety.c >= 1 && ninetyOldEnough ? "PASS" : "FAIL",
    `${o.ninetyDayAgent}；60d 阈值为「仅很久以前活跃」的稳定判据`);

  return results;
}

/** §1.1 Wiki：KTX 索引覆盖（文件数基线由默认档「Wiki 页数」行兜底）。 */
export function evaluateWikiSkillIndex(ctx) {
  const results = [];
  const files = ctx.wikiFiles;
  const indexed = ctx.ktxIndexed;
  const ok = Number.isFinite(files) && files >= 300 && Number.isFinite(indexed) && indexed >= files;
  results.push({
    dim: "MCP-PERF KTX Wiki 索引覆盖",
    floor: "knowledge_pages ≥ Wiki 文件数（≥300）",
    actual: `索引 ${indexed} / 文件 ${files}`,
    status: ok ? "PASS" : "FAIL",
    note: "/data/lucy/.ktx/db.sqlite knowledge_pages；global scope 口径（未就绪连接 scope 页不计，lucy-ops 未就绪属设计）",
  });
  return results;
}

/** lucy_query 响应的宽容行提取（data/structuredContent/文本 JSON 均可）。 */
export function extractQueryRows(resp) {
  let data = resp?.data;
  if (data === undefined || data === null) {
    try {
      data = JSON.parse(resp?.text ?? "");
    } catch {
      data = null;
    }
  }
  const rows = data?.rows ?? data?.data?.rows ??
    (Array.isArray(data?.data) ? data.data : null) ??
    (Array.isArray(data) ? data : null);
  return Array.isArray(rows) ? rows : null;
}

export function firstRowNumbers(row) {
  const vals = Array.isArray(row) ? row : Object.values(row ?? {});
  return vals.map(Number).filter((n) => Number.isFinite(n));
}

/** connection_list 响应的连接 ID 列表提取。 */
export function extractConnections(resp) {
  let data = resp?.data;
  if (data === undefined || data === null) {
    try {
      data = JSON.parse(resp?.text ?? "");
    } catch {
      data = null;
    }
  }
  if (Array.isArray(data?.connections)) return data.connections.filter((c) => typeof c === "string");
  if (Array.isArray(data?.items)) return data.items.map((i) => i?.connectionId ?? i?.id).filter(Boolean);
  return null;
}

export function normalizeTokenMap(raw) {
  const src = raw && typeof raw === "object"
    ? (raw.tokens && typeof raw.tokens === "object" ? raw.tokens : raw)
    : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

/** §1.1 运行时核验（真实 MCP 调用 + 审计对账）。 */
export function evaluateRuntime(probe, identities, roles, o) {
  const results = [];
  const record = (dim, floor, actual, status, note) => {
    results.push({ dim, floor, actual, status, note: note || "" });
  };
  const tokenNote = probe.tokenError ? `凭据文件不可用：${probe.tokenError}` : "";

  // wiki_search 真实命中合成标记（仅数文件或索引行不算）
  {
    const w = probe.wiki;
    record("MCP-PERF wiki_search 合成标记命中", `命中 global/${o.wikiMarker}.md`,
      w.hit ? "命中" : (w.detail || "未命中"),
      w.hit ? "PASS" : "FAIL",
      w.candidate ? `身份 ${w.candidate} 实查（allowed_roles×wiki_search 工具交集）` : tokenNote || "无可用身份");
  }

  // lucy_skill_read 真实读到指定 Skill
  {
    const k = probe.skill;
    record("MCP-PERF lucy_skill_read 实读", `读到 ${o.skillName} 且含标记`,
      k.ok ? "读到" : (k.detail || "未读到"),
      k.ok ? "PASS" : "FAIL",
      k.ok ? `标记 ${o.skillMarker || o.skillName} 在返回正文` : tokenNote || "lucy_admin 身份实读");
  }

  // 运行时身份核对：不同 Token → 服务端不同 user_id
  {
    const want = identities.map((u) => u.id);
    const seen = new Set(probe.auditSeen || []);
    const missing = want.filter((id) => !seen.has(id));
    const callsFailed = (probe.calls || []).filter((c) => !c.ok).map((c) => c.identity);
    const ok = !probe.tokenError &&
      probe.missingTokens.length === 0 &&
      identities.length >= o.wantIdentities &&
      probe.presentedDistinct >= o.wantIdentities &&
      callsFailed.length === 0 &&
      missing.length === 0;
    record("MCP-PERF 运行时身份核对", `${o.wantIdentities} Token→${o.wantIdentities} distinct user_id`,
      `${want.length - missing.length}/${want.length} 身份对账`,
      ok ? "PASS" : "FAIL",
      tokenNote ||
        (probe.missingTokens.length ? `缺凭据 ${probe.missingTokens.length}：${probe.missingTokens.slice(0, 5).join(",")}；` : "") +
        (probe.presentedDistinct < o.wantIdentities ? `呈递 Token 去重后仅 ${probe.presentedDistinct}（轮换同一 Token 不成立）；` : "") +
        (callsFailed.length ? `调用失败：${callsFailed.slice(0, 5).join(",")}；` : "") +
        (missing.length ? `审计无轨迹：${missing.slice(0, 5).join(",")}` : "审计 user_id 逐身份对账一致"));
  }

  // 运行时角色绑定：审计 role_ids ∋ 配置角色 ∧ 连接可见性与角色一致
  {
    const roleOf = new Map(identities.map((u) => [u.id, u.role]));
    const roleRowsByUser = new Map();
    for (const r of probe.roleRows || []) {
      if (!roleRowsByUser.has(r.user_id)) roleRowsByUser.set(r.user_id, []);
      roleRowsByUser.get(r.user_id).push(r);
    }
    const ktxConns = probe.ktxConnections || [];
    const expectedOf = (roleId) => {
      const conns = roleConnections(roles[roleId]);
      return conns.includes("*") ? [...ktxConns] : conns.filter((c) => ktxConns.includes(c));
    };
    const bad = [];
    for (const u of identities) {
      const rows = roleRowsByUser.get(u.id) || [];
      const roleOk = rows.some((r) => {
        try {
          const ids = JSON.parse(r.role_ids || "[]");
          return Array.isArray(ids) && ids.includes(u.role);
        } catch {
          return false;
        }
      });
      const call = (probe.calls || []).find((c) => c.identity === u.id);
      const visible = call?.connections;
      let visOk = false;
      if (Array.isArray(visible)) {
        const expected = expectedOf(u.role);
        const over = visible.filter((v) => !expected.includes(v));
        // lucy-ops 未就绪时 connection_list 按 Spec 149 §6 不列出，完整性方向放行
        const under = expected.filter((e) => e !== "lucy-ops" && !visible.includes(e));
        visOk = over.length === 0 && under.length === 0;
      }
      if (!roleOk || !visOk) bad.push(`${u.id}(${!roleOk ? "role_ids" : "可见性"})`);
    }
    record("MCP-PERF 运行时角色绑定", "审计 role_ids∋配置角色 ∧ 连接可见性一致",
      `${identities.length - bad.length}/${identities.length} 身份一致`,
      identities.length > 0 && bad.length === 0 && !probe.tokenError ? "PASS" : "FAIL",
      tokenNote || (bad.length ? `不符：${bad.slice(0, 5).join(",")}` : "lucy-ops 未就绪不列出属设计（Spec 149 §6）"));
  }

  // 全局 Source 集合：lucy_admin 可见 ⊇ ktx.yaml 连接集 ∪ 正式角色引用连接
  {
    const required = new Set([...(probe.ktxConnections || []), ...(probe.roleReferenced || [])]);
    required.delete("lucy-ops"); // 未就绪不列出属设计；lucy-ops 正确性由跨连接查询行兜底
    const visible = new Set(probe.adminVisible || []);
    const missing = [...required].filter((c) => !visible.has(c));
    const opsVisible = (probe.adminVisible || []).includes("lucy-ops");
    record("MCP-PERF 全局 Source 集合", "lucy_admin 可见 ⊇ 全局连接集",
      probe.adminVisible ? `${probe.adminVisible.length} 连接` : "N/A",
      probe.adminVisible && missing.length === 0 ? "PASS" : "FAIL",
      tokenNote ||
        (missing.length ? `缺：${missing.slice(0, 6).join(",")}` : "覆盖 ktx.yaml∪角色引用") +
        (opsVisible ? "；lucy-ops 可见" : "；lucy-ops 未列出（未就绪或缺失，见跨连接查询行）"));
  }

  // 跨连接正确查询：内置 oracle（demo-mysql 种子基线值／lucy-ops 直读对账）
  {
    const parts = [];
    let allOk = true;
    for (const conn of o.queryConnections) {
      const r = probe.queries?.[conn];
      if (!r) {
        parts.push(`${conn}：未执行`);
        allOk = false;
        continue;
      }
      if (r.ok) parts.push(`${conn} ✓`);
      else {
        parts.push(`${conn} ✗(${r.detail || "错误"})`);
        allOk = false;
      }
    }
    record("MCP-PERF 跨连接正确查询", "≥2 业务连接 oracle 值正确",
      parts.join("，") || "N/A",
      o.queryConnections.length >= 2 && allOk && !probe.tokenError ? "PASS" : "FAIL",
      tokenNote || "demo-mysql 对 _baseline.json；lucy-ops 对直读 COUNT 夹逼");
  }

  return results;
}

/** §1.1 表合计行：§2 既有 per-库下限已在默认档 FAIL 兜底，本行只做合计观察（WARN 不卡退出码）。 */
export function evaluateTableTotal(ctx, o) {
  const mysql = ctx.mysqlTables;
  const hive = ctx.hiveTables;
  const total = (Number.isFinite(mysql) ? mysql : 0) + (Number.isFinite(hive) ? hive : 0);
  const note = "§2 口径归 P1-34；两库下限合计 1800（+宽表），≥2000 需 MySQL XL 档（UAT_SCALE_MYSQL_XL_TABLES）";
  if (hive === null || hive === undefined) {
    return [{
      dim: "MCP-PERF 表合计（跨夹具）",
      floor: `>=${o.floorTableTotal}（§1.1）`,
      actual: `${mysql}+Hive SKIPPED`,
      status: "WARN",
      note: `Hive 未灌，合计不可得；${note}`,
    }];
  }
  return [{
    dim: "MCP-PERF 表合计（跨夹具）",
    floor: `>=${o.floorTableTotal}（§1.1）`,
    actual: total,
    status: total >= o.floorTableTotal ? "PASS" : "WARN",
    note,
  }];
}

// ---- MCP-PERF profile：采集编排 ----------------------------------------------

async function collectMcpPerfResults(deps, o, ctx) {
  const results = [];
  const config = ctx.accessConfig || deps.readAccessConfig();
  const roles = config.roles || {};

  // 1) 身份（配置层）
  const idEval = evaluatePerfIdentityConfig(config, o);
  results.push(...idEval.results);
  const identities = idEval.identities;

  // 2) 审计行量（先 COUNT 后探针：探针自身产生的真实调用行不参与本次行量判定）
  const win = `strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`;
  const counts = {
    total: deps.auditQuery("SELECT COUNT(*) c FROM ops_calls", [])[0]?.c ?? 0,
    win30: deps.auditQuery(`SELECT COUNT(*) c FROM ops_calls WHERE ts >= ${win}`, [])[0]?.c ?? 0,
    active: deps.auditQuery(`SELECT COUNT(DISTINCT agent_id) c FROM ops_calls WHERE ts >= ${win}`, [])[0]?.c ?? 0,
  };
  const hot = deps.auditQuery(
    `SELECT agent_id, COUNT(*) c FROM ops_calls WHERE ts >= ${win} GROUP BY agent_id ORDER BY c DESC LIMIT 1`, []);
  counts.hottestAgent = hot[0]?.agent_id ?? null;
  counts.hottestCount = hot[0]?.c ?? 0;
  results.push(...evaluateAuditFloors(counts, o));

  // 3) 集中与边界形态
  const shapes = {
    windowDist: deps.auditQuery(
      `SELECT agent_id, COUNT(*) c FROM ops_calls WHERE ts >= ${win} GROUP BY agent_id`, []),
    boundary: deps.auditQuery(
      "SELECT request_id, user_id, ts FROM access_log WHERE request_id LIKE ? ORDER BY ts ASC",
      [`${o.reqPrefix}boundary-%`]),
    samems: deps.auditQuery(
      "SELECT request_id, user_id, ts FROM access_log WHERE request_id LIKE ? ORDER BY ts ASC",
      [`${o.reqPrefix}samems-%`]),
    noHistoryRows: deps.auditQuery(
      "SELECT COUNT(*) c FROM access_log WHERE user_id = ?", [o.noHistoryAgent])[0]?.c ?? 0,
    ninety: deps.auditQuery(
      `SELECT COUNT(*) c, MAX(ts) m,
         SUM(CASE WHEN ts >= ${win} THEN 1 ELSE 0 END) win,
         MAX(CASE WHEN ts <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days') THEN 1 ELSE 0 END) oldEnough
       FROM access_log WHERE user_id = ?`, [o.ninetyDayAgent])[0] ?? null,
    configuredAgents: new Set((config.users || []).map((u) => u.id)),
  };
  results.push(...evaluateBoundaryShapes(shapes, o));

  // 4) Wiki KTX 索引覆盖
  results.push(...evaluateWikiSkillIndex({ wikiFiles: ctx.wikiFiles, ktxIndexed: deps.ktxWikiIndexedCount() }));

  // 5) 运行时探针（真实 Public MCP 只读调用）
  const probe = await collectRuntimeProbes(deps, o, identities, roles);
  results.push(...evaluateRuntime(probe, identities, roles, o));

  // 6) 表合计（§2 既有 per-库下限已在默认档兜底）
  results.push(...evaluateTableTotal(ctx, o));

  return results;
}

async function collectRuntimeProbes(deps, o, identities, roles) {
  const probe = {
    tokenError: null,
    missingTokens: [],
    presentedDistinct: 0,
    calls: [],
    auditSeen: [],
    roleRows: [],
    adminVisible: null,
    wiki: { hit: false, candidate: null, detail: "" },
    skill: { ok: false, detail: "" },
    queries: {},
    ktxConnections: [],
    roleReferenced: [],
  };
  try {
    probe.ktxConnections = deps.readKtxConnectionIds();
  } catch {
    probe.ktxConnections = [];
  }
  const referenced = new Set();
  for (const r of Object.values(roles)) {
    for (const c of roleConnections(r)) {
      if (c !== "*") referenced.add(c);
    }
  }
  probe.roleReferenced = [...referenced];

  let tokens = {};
  if (!o.tokenFile) {
    probe.tokenError = "未设置 UAT_MCP_PERF_TOKEN_FILE";
  } else {
    try {
      tokens = normalizeTokenMap(deps.readTokenFile(o.tokenFile));
    } catch (e) {
      probe.tokenError = String(e?.message || e).slice(0, 120);
    }
  }
  const tokenOf = (id) => tokens[id];
  probe.missingTokens = identities.map((u) => u.id).filter((id) => !tokenOf(id));
  probe.presentedDistinct = new Set(identities.map((u) => tokenOf(u.id)).filter(Boolean)).size;

  const callAs = async (token, name, args) => {
    const open = await deps.mcpOpen(token);
    if (open.status !== 200 || !open.session) {
      return { status: open.status, ok: false, connections: null, raw: open };
    }
    const r = await deps.mcpCallTool(token, open.session, name, args);
    return { status: r.status, ok: r.status === 200 && !r.isError, connections: extractConnections(r), raw: r };
  };

  // 50 身份逐一真实调用（connection_list 轻量只读）；随后与审计对账
  const snapshot = deps.auditQuery("SELECT COALESCE(MAX(id),0) m FROM access_log", [])[0]?.m ?? 0;
  for (const u of identities) {
    const token = tokenOf(u.id);
    if (!token) {
      probe.calls.push({ identity: u.id, ok: false, status: 0, connections: null });
      continue;
    }
    try {
      const r = await callAs(token, "connection_list", {});
      probe.calls.push({ identity: u.id, ok: r.ok, status: r.status, connections: r.connections });
    } catch (e) {
      probe.calls.push({ identity: u.id, ok: false, status: -1, connections: null, error: String(e?.message || e).slice(0, 80) });
    }
  }

  // 审计落库对账（有界等待异步审计写入）
  const wantIds = identities.map((u) => u.id);
  const deadline = Date.now() + o.auditSettleMs;
  for (;;) {
    const rows = deps.auditQuery("SELECT DISTINCT user_id FROM access_log WHERE id > ?", [snapshot]);
    probe.auditSeen = rows.map((r) => r.user_id);
    const seen = new Set(probe.auditSeen);
    if (wantIds.every((id) => seen.has(id)) || Date.now() >= deadline) break;
    await deps.sleep(1000);
  }
  probe.roleRows = deps.auditQuery(
    "SELECT user_id, role_ids FROM access_log WHERE id > ? AND role_ids IS NOT NULL", [snapshot]);

  // 管理面探针：第一个绑定 lucy_admin 且持凭据的身份
  const admin = identities.find((u) => u.role === "lucy_admin" && tokenOf(u.id));
  const adminToken = admin ? tokenOf(admin.id) : null;
  const adminCall = admin ? probe.calls.find((c) => c.identity === admin.id) : null;
  probe.adminVisible = adminCall?.connections ?? null;

  // wiki_search 真实命中：标记页 allowed_roles × 角色持 wiki_search 工具 × 有凭据
  if (!probe.tokenError) {
    const key = `global/${o.wikiMarker}.md`;
    let page = null;
    try {
      page = deps.readWikiPageFrontmatter(key);
    } catch {
      page = null;
    }
    if (!page) {
      probe.wiki.detail = `标记页 ${key} 不存在或 frontmatter 不可解析`;
    } else {
      const allowed = Array.isArray(page.allowed_roles) ? page.allowed_roles : [];
      const candidate = identities.find((u) => {
        if (!tokenOf(u.id)) return false;
        const match = allowed.includes("*") || allowed.includes(u.role);
        return match && roleTools(roles[u.role]).includes("wiki_search");
      });
      if (!candidate) {
        probe.wiki.detail = `无身份可同时满足 allowed_roles（${allowed.slice(0, 4).join(",") || "空"}）∧wiki_search 工具∧持凭据`;
      } else {
        probe.wiki.candidate = candidate.id;
        try {
          const r = await callAs(tokenOf(candidate.id), "wiki_search", { query: o.wikiQuery });
          let data = r.raw?.data;
          if (data === undefined || data === null) {
            try {
              data = JSON.parse(r.raw?.text ?? "");
            } catch {
              data = null;
            }
          }
          const hits = Array.isArray(data?.results) ? data.results : [];
          probe.wiki.hit = r.ok && hits.some((h) => h?.key === key);
          if (!probe.wiki.hit) probe.wiki.detail = r.ok ? `结果未含 ${key}（${hits.length} 条）` : `调用失败 status=${r.status}`;
        } catch (e) {
          probe.wiki.detail = String(e?.message || e).slice(0, 80);
        }
      }
    }
  }

  // lucy_skill_read 真实读到指定 Skill（lucy_admin 身份）
  if (!probe.tokenError && adminToken) {
    try {
      const r = await callAs(adminToken, "lucy_skill_read", { skill_name: o.skillName });
      const marker = o.skillMarker || o.skillName;
      probe.skill.ok = r.ok && typeof r.raw?.text === "string" && r.raw.text.includes(marker);
      if (!probe.skill.ok) {
        probe.skill.detail = r.ok ? `返回正文不含标记 ${marker}` : `调用失败 status=${r.status}（${String(r.raw?.text || "").slice(0, 60)}）`;
      }
    } catch (e) {
      probe.skill.detail = String(e?.message || e).slice(0, 80);
    }
  } else if (!probe.tokenError) {
    probe.skill.detail = "缺 lucy_admin 身份凭据";
  }

  // 跨连接正确查询（lucy_admin 身份；内置 oracle）
  if (!probe.tokenError && adminToken) {
    let baseline = null;
    try {
      baseline = deps.readBaselineJson();
    } catch {
      baseline = null;
    }
    for (const conn of o.queryConnections) {
      try {
        if (conn === "demo-mysql") {
          if (!baseline?.measures) {
            probe.queries[conn] = { ok: false, detail: "_baseline.json 缺 measures" };
            continue;
          }
          const sales = await callAs(adminToken, "lucy_query", {
            connectionId: conn, measures: ["superstore_orders.total_sales"],
          });
          const orders = await callAs(adminToken, "lucy_query", {
            connectionId: conn, measures: ["superstore_orders.order_count"],
          });
          const salesVal = sales.ok ? firstRowNumbers(extractQueryRows(sales.raw)?.[0])[0] : null;
          const ordersVal = orders.ok ? firstRowNumbers(extractQueryRows(orders.raw)?.[0])[0] : null;
          const salesOk = salesVal !== null && Math.abs(salesVal - Number(baseline.measures.total_sales)) <= 0.01;
          const ordersOk = ordersVal !== null && ordersVal === Number(baseline.measures.order_count);
          probe.queries[conn] = {
            ok: salesOk && ordersOk,
            detail: `total_sales=${salesVal}（期望 ${baseline.measures.total_sales}）order_count=${ordersVal}（期望 ${baseline.measures.order_count}）`,
          };
        } else if (conn === "lucy-ops") {
          // Spec 149 §6 — lucy-ops 不随 lucy_admin 通配生效，只认显式绑定的
          // lucy_ops_reader；用该角色的压测身份实读。
          const opsReader = identities.find((u) => u.role === "lucy_ops_reader" && tokenOf(u.id));
          if (!opsReader) {
            probe.queries[conn] = { ok: false, detail: "缺 lucy_ops_reader 身份凭据" };
            continue;
          }
          const before = deps.auditQuery("SELECT COUNT(*) c FROM ops_calls", [])[0]?.c ?? 0;
          const q = await callAs(tokenOf(opsReader.id), "lucy_query", {
            connectionId: conn, measures: ["ops_calls.call_count"],
          });
          const after = deps.auditQuery("SELECT COUNT(*) c FROM ops_calls", [])[0]?.c ?? 0;
          const val = q.ok ? firstRowNumbers(extractQueryRows(q.raw)?.[0])[0] : null;
          // 只增不减：查询时刻的真实计数必落在前后两次直读之间
          const ok = val !== null && val >= before && val <= after;
          probe.queries[conn] = {
            ok,
            detail: `call_count=${val}，直读夹逼 [${before}, ${after}]`,
          };
        } else {
          probe.queries[conn] = { ok: true, detail: "无内置 oracle，仅记录" };
        }
      } catch (e) {
        probe.queries[conn] = { ok: false, detail: String(e?.message || e).slice(0, 80) };
      }
    }
  } else if (!probe.tokenError) {
    for (const conn of o.queryConnections) {
      probe.queries[conn] = { ok: false, detail: "缺 lucy_admin 身份凭据" };
    }
  }

  return probe;
}

// ---- 汇总 --------------------------------------------------------------------

export function summarize(results, { strict }, io) {
  let fail = 0;
  let skip = 0;
  io.log("\n维度 | 下限 | 实测 | 判定 | 备注");
  io.log("--- | --- | --- | --- | ---");
  for (const r of results) {
    if (r.status === "FAIL") fail += 1;
    if (r.status === "SKIPPED") skip += 1;
    io.log(
      `${r.dim} | ${r.floor} | ${r.actual} | ${r.status}${r.note ? ` | ${r.note}` : " |"}`,
    );
  }
  io.log("");
  if (fail > 0) {
    io.log(`[scale-baseline] ${fail} 项低于基线 → FAIL（退出码 1）`);
    return 1;
  }
  if (skip > 0 && strict) {
    io.log(`[scale-baseline] ${skip} 项 SKIPPED（--strict）→ 退出码 1`);
    return 1;
  }
  io.log(`[scale-baseline] 已检查项全部达标${skip ? `（${skip} 项 SKIPPED）` : ""} → PASS`);
  return 0;
}

export async function main(argv, deps, io = { log: console.log, error: console.error }) {
  const args = parseArgs(argv);
  if (args.error) {
    io.error(`[scale-baseline] ${args.error}，退出码 2`);
    return 2;
  }

  if (!deps.dockerOk()) {
    io.error("[scale-baseline] Docker 不可用，退出码 2");
    return 2;
  }
  const haveLucy = deps.running(LUCY);
  const haveDb = deps.running(DB);
  if (!haveLucy || !haveDb) {
    io.error(
      `[scale-baseline] 容器缺失：lucy=${haveLucy} db=${haveDb}，退出码 2`,
    );
    return 2;
  }

  const { results, ctx } = collectBaseResults(deps);
  if (args.profile === "mcp-perf") {
    let o;
    try {
      o = perfOptions(deps.env || {});
    } catch (e) {
      io.error(`[scale-baseline] ${e.message}，退出码 2`);
      return 2;
    }
    results.push(...await collectMcpPerfResults(deps, o, ctx));
  }
  return summarize(results, { strict: args.strict }, io);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2), createRealDeps(process.env))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[scale-baseline] 执行异常：${err?.message || err}`);
      process.exit(1);
    });
}
