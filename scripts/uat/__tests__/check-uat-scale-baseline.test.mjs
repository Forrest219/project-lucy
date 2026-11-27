#!/usr/bin/env node
/**
 * check-uat-scale-baseline 单测：全部经替身 deps 驱动，不依赖真实 Docker/MCP 栈。
 * 覆盖：默认档回归（不受 MCP-PERF 影响）、profile 达标→exit 0、
 * §1.1 每一行未达标→exit 1 且输出指明缺项、WARN/SKIPPED/退出码 2 口径。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBoundaryShapes,
  evaluatePerfIdentityConfig,
  extractConnections,
  extractQueryRows,
  findBoundaryTriple,
  firstRowNumbers,
  main,
  normalizeTokenMap,
  parseArgs,
  perfOptions,
} from "../check-uat-scale-baseline.mjs";

// ---- 夹具：全绿 access.yaml（200 角色 / 550 Agent / 50 压测身份） -------------

const PERF_IDS = Array.from({ length: 50 }, (_, i) => `uat_perf_${String(i + 1).padStart(3, "0")}`);

function greenConfig() {
  const roles = {
    lucy_admin: {
      description: "平台运维数据面",
      allow: { connections: ["*"], tools: ["lucy_catalog", "lucy_query", "connection_list", "wiki_search", "wiki_read", "lucy_skill_read"] },
    },
    demo_readonly: { allow: { connections: ["demo-mysql"], tools: ["lucy_query"] } },
    lucy_ops_reader: { allow: { connections: ["lucy-ops"], tools: ["lucy_query"] } },
  };
  for (let i = 1; i <= 197; i++) {
    const id = `uat_role_${String(i).padStart(3, "0")}`;
    roles[id] = {
      allow: {
        connections: i === 2 ? ["demo-mysql", "lucy-ops"] : ["demo-mysql"],
        tools: ["lucy_catalog", "lucy_query", "connection_list", "wiki_search", "wiki_read", "lucy_skill_read"],
      },
    };
  }
  const users = [
    { id: "demo_agent", name: "Demo Agent", enabled: true, tokens: [{ hash: "sha256:demo1" }, { hash: "sha256:demo2" }, { hash: "sha256:demo3" }], role: "demo_readonly" },
    { id: "demo_ops", name: "Demo Ops", enabled: true, tokens: [{ hash: "sha256:ops1" }, { hash: "sha256:ops2" }, { hash: "sha256:ops3" }], role: "lucy_ops_reader" },
  ];
  for (let i = 1; i <= 498; i++) {
    const id = `uat_agent_${String(i).padStart(3, "0")}`;
    users.push({
      id,
      name: `UAT Agent ${i}`,
      enabled: true,
      tokens: [{ hash: `sha256:a${i}1` }, { hash: `sha256:a${i}2` }, { hash: `sha256:a${i}3` }],
      role: `uat_role_${String(((i - 1) % 197) + 1).padStart(3, "0")}`,
    });
  }
  for (let i = 1; i <= 50; i++) {
    const id = `uat_perf_${String(i).padStart(3, "0")}`;
    // 与 seed-scale-mcp-perf-identities 一致：2×admin + 24/23 受限组 + 末位 lucy_ops_reader
    const role = i <= 2
      ? "lucy_admin"
      : i <= 26
        ? "uat_role_001"
        : i < 50
          ? "uat_role_002"
          : "lucy_ops_reader";
    users.push({
      id,
      name: `UAT Perf ${i}`,
      enabled: true,
      tokens: [{ hash: `sha256:perf${i}` }],
      role,
    });
  }
  return { roles, users, defaults: {} };
}

const roleOfPerf = (id) => {
  const n = Number(id.slice("uat_perf_".length));
  return n <= 2
    ? "lucy_admin"
    : n <= 26
      ? "uat_role_001"
      : n < 50
        ? "uat_role_002"
        : "lucy_ops_reader";
};

function greenWindowDist() {
  const dist = [{ agent_id: "uat_agent_001", c: 40200 }];
  for (let i = 2; i <= 100; i++) dist.push({ agent_id: `uat_agent_${String(i).padStart(3, "0")}`, c: 1500 });
  for (let i = 101; i <= 500; i++) dist.push({ agent_id: `warm_${i}`, c: 30 });
  return dist;
}

const T0 = Date.parse("2026-11-20T00:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

/**
 * 全绿替身 deps。overrides 可替换任意方法；env 默认带凭据文件路径。
 * mcpAuditTrail=false 时模拟「调用未落审计」（运行时身份核对失败场景）。
 */
function greenDeps(overrides = {}) {
  const config = greenConfig();
  const calls = { mcpOpen: 0, mcpCallTool: 0, readTokenFile: 0 };
  const deps = {
    env: { UAT_MCP_PERF_TOKEN_FILE: "/fake/tokens.json", UAT_MCP_PERF_AUDIT_SETTLE_MS: "300" },
    calls,
    dockerOk: () => true,
    running: (name) => name !== "lucy-uat-hive-hs2",
    mysql: (sql) => {
      if (sql.includes("information_schema.tables")) return "1200";
      if (sql.includes("information_schema.columns")) return "1000";
      if (sql.includes("dataforai.superstore_orders")) return "1000";
      if (sql.includes("dataforai.superstore_returns")) return "60";
      if (sql.includes("dataforai.superstore_people")) return "4";
      throw new Error(`unexpected mysql: ${sql}`);
    },
    hiveShowTablesRaw: () => {
      const lines = ["| tab_name |"];
      for (let i = 1; i <= 600; i++) lines.push(`| t_${String(i).padStart(4, "0")} |`);
      for (const w of ["w_1500", "w_1999", "w_2000", "w_3000", "w_5000"]) lines.push(`| ${w} |`);
      return lines.join("\n");
    },
    lucySh: () => "300",
    readAccessConfig: () => config,
    readKtxConnectionIds: () => ["demo-mysql", "lucy-ops"],
    readWikiPageFrontmatter: (key) =>
      key === "global/uat-wiki-001.md" ? { summary: "夹具", allowed_roles: ["uat_role_001"] } : null,
    countWikiFiles: () => 300,
    countSkillsLoader: () => 100,
    ktxWikiIndexedCount: () => 300,
    baseAuditCounts: () => ({ total: 1000600, win30: 200600, active: 500 }),
    auditQuery: (sql, params = []) => {
      if (sql.includes("COALESCE(MAX(id)")) return [{ m: 5000 }];
      if (sql.includes("DISTINCT user_id")) return PERF_IDS.map((id) => ({ user_id: id }));
      if (sql.includes("role_ids IS NOT NULL")) {
        return PERF_IDS.map((id) => ({ user_id: id, role_ids: JSON.stringify([roleOfPerf(id)]) }));
      }
      if (sql.includes("oldEnough")) return [{ c: 2, m: "2026-08-28T00:00:00.000Z", win: 0, oldEnough: 1 }];
      if (sql.includes("WHERE user_id = ?")) {
        return params[0] === "uat_agent_498" ? [{ c: 0 }] : [{ c: 0 }];
      }
      if (sql.includes("LIKE ?")) {
        if (String(params[0]).includes("boundary")) {
          return [
            { request_id: "uat-scale-boundary-1", user_id: "uat_agent_002", ts: iso(T0) },
            { request_id: "uat-scale-boundary-2", user_id: "uat_agent_003", ts: iso(T0 + 1) },
            { request_id: "uat-scale-boundary-3", user_id: "uat_agent_004", ts: iso(T0 + 2) },
          ];
        }
        return [
          { request_id: "uat-scale-samems-1", user_id: "uat_agent_005", ts: iso(T0) },
          { request_id: "uat-scale-samems-2", user_id: "uat_agent_005", ts: iso(T0) },
        ];
      }
      if (sql.includes("LIMIT 1")) return [{ agent_id: "uat_agent_001", c: 40200 }];
      if (sql.includes("GROUP BY agent_id")) return greenWindowDist();
      if (sql.includes("COUNT(DISTINCT agent_id)")) return [{ c: 500 }];
      if (sql.includes("WHERE ts >=")) return [{ c: 200600 }];
      if (sql === "SELECT COUNT(*) c FROM ops_calls") return [{ c: 1000600 }];
      throw new Error(`unexpected auditQuery: ${sql}`);
    },
    readBaselineJson: () => ({ measures: { total_sales: 1459476.0953, order_count: 1000 } }),
    readTokenFile: () => {
      calls.readTokenFile += 1;
      const tokens = {};
      for (const id of PERF_IDS) tokens[id] = `tok-${id}`;
      return { tokens };
    },
    mcpOpen: async (token) => {
      calls.mcpOpen += 1;
      return { status: 200, session: `sess-${token}` };
    },
    mcpCallTool: async (token, session, name, args) => {
      calls.mcpCallTool += 1;
      const id = String(token).replace(/^tok-/, "");
      if (name === "connection_list") {
        const role = roleOfPerf(id);
        const connections = role === "lucy_admin"
          ? ["demo-mysql", "lucy-ops"]
          : role === "uat_role_002"
            ? ["demo-mysql", "lucy-ops"]
            : role === "lucy_ops_reader"
              ? ["lucy-ops"]
              : ["demo-mysql"];
        return { status: 200, isError: false, data: { connections }, text: JSON.stringify({ connections }) };
      }
      if (name === "wiki_search") {
        return { status: 200, isError: false, data: { results: [{ key: "global/uat-wiki-001.md" }] }, text: "" };
      }
      if (name === "lucy_skill_read") {
        return { status: 200, isError: false, text: "---\nname: uat-skill-001\n---\n\n# UAT Skill 001\n" };
      }
      if (name === "lucy_query") {
        const m = args.measures[0];
        const rows = m.includes("total_sales") ? [[1459476.0953]]
          : m.includes("order_count") ? [[1000]]
            : [[1000600]];
        return { status: 200, isError: false, data: { rows }, text: "" };
      }
      throw new Error(`unexpected tool: ${name}`);
    },
    sleep: async () => {},
  };
  return Object.assign(deps, overrides);
}

function makeIo() {
  const lines = [];
  const errors = [];
  return {
    lines,
    errors,
    io: {
      log: (...a) => lines.push(a.join(" ")),
      error: (...a) => errors.push(a.join(" ")),
    },
  };
}

const runMain = async (argv, deps) => {
  const { lines, errors, io } = makeIo();
  const code = await main(argv, deps, io);
  return { code, out: lines.join("\n"), err: errors.join("\n") };
};

const rowOf = (out, dim) => out.split("\n").find((l) => l.startsWith(`${dim} |`)) || "";

// ---- 参数解析 ----------------------------------------------------------------

test("parseArgs：默认／strict／两种 profile 写法／未知参数与未知 profile", () => {
  assert.deepEqual(parseArgs([]), { strict: false, profile: null });
  assert.deepEqual(parseArgs(["--strict"]), { strict: true, profile: null });
  assert.deepEqual(parseArgs(["--profile", "mcp-perf"]), { strict: false, profile: "mcp-perf" });
  assert.deepEqual(parseArgs(["--profile=mcp-perf"]), { strict: false, profile: "mcp-perf" });
  assert.deepEqual(parseArgs(["--profile", "customer-stability"]), { strict: false, profile: "customer-stability" });
  assert.deepEqual(parseArgs(["--profile=customer-stability"]), { strict: false, profile: "customer-stability" });
  assert.ok(parseArgs(["--profile", "bogus"]).error);
  assert.ok(parseArgs(["--bogus"]).error);
  assert.ok(parseArgs(["--profile"]).error);
});

test("perfOptions：默认值与非法标识符拒绝", () => {
  const o = perfOptions({});
  assert.equal(o.prefix, "uat_perf_");
  assert.equal(o.wantIdentities, 50);
  assert.equal(o.adminMin, 2);
  assert.equal(o.floorAuditTotal, 1000507);
  assert.equal(o.floorAuditWindow, 200498);
  assert.equal(o.floorActiveAgents, 499);
  assert.equal(o.floorHottest, 40100);
  assert.deepEqual(o.queryConnections, ["demo-mysql", "lucy-ops"]);
  assert.throws(() => perfOptions({ UAT_MCP_PERF_AGENT_PREFIX: "bad%" }));
  assert.throws(() => perfOptions({ UAT_MCP_PERF_IDENTITIES: "abc" }));
});

// ---- 纯判定函数 ---------------------------------------------------------------

test("evaluatePerfIdentityConfig：全绿通过；共享凭据／缺 admin／单分组被点名", () => {
  const o = perfOptions({});
  const green = evaluatePerfIdentityConfig(greenConfig(), o);
  assert.ok(green.results.every((r) => r.status === "PASS"), JSON.stringify(green.results, null, 2));
  assert.equal(green.identities.length, 50);

  const shared = greenConfig();
  shared.users.find((u) => u.id === "uat_perf_004").tokens = [{ hash: "sha256:perf3" }];
  const r2 = evaluatePerfIdentityConfig(shared, o).results
    .find((r) => r.dim === "MCP-PERF 身份互异（自有 Token）");
  assert.equal(r2.status, "FAIL");

  const oneAdmin = greenConfig();
  oneAdmin.users.find((u) => u.id === "uat_perf_002").role = "uat_role_003";
  const r3 = evaluatePerfIdentityConfig(oneAdmin, o).results.find((r) => r.dim === "MCP-PERF lucy_admin 绑定身份");
  assert.equal(r3.status, "FAIL");

  const oneGroup = greenConfig();
  for (const u of oneGroup.users) {
    if (u.id.startsWith("uat_perf_") && u.role !== "lucy_admin") u.role = "uat_role_001";
  }
  const r4 = evaluatePerfIdentityConfig(oneGroup, o).results.find((r) => r.dim === "MCP-PERF 受限角色分组");
  assert.equal(r4.status, "FAIL");
});

test("findBoundaryTriple：三连毫秒＋归属；缺行与错归属均识别", () => {
  const rows = [
    { request_id: "b1", user_id: "uat_agent_002", ts: iso(T0) },
    { request_id: "b2", user_id: "uat_agent_003", ts: iso(T0 + 1) },
    { request_id: "b3", user_id: "uat_agent_004", ts: iso(T0 + 2) },
  ];
  const want = ["uat_agent_002", "uat_agent_003", "uat_agent_004"];
  assert.equal(findBoundaryTriple(rows, want).attributionOk, true);
  assert.equal(findBoundaryTriple(rows.slice(0, 2), want).found, false);
  const wrongUser = [
    { request_id: "b1", user_id: "uat_agent_009", ts: iso(T0) },
    { request_id: "b2", user_id: "uat_agent_003", ts: iso(T0 + 1) },
    { request_id: "b3", user_id: "uat_agent_004", ts: iso(T0 + 2) },
  ];
  const t = findBoundaryTriple(wrongUser, want);
  assert.equal(t.found, true);
  assert.equal(t.attributionOk, false);
});

test("evaluateBoundaryShapes：80/20  share 不足判 FAIL", () => {
  const o = perfOptions({});
  const uniform = Array.from({ length: 500 }, (_, i) => ({ agent_id: `a${i}`, c: 400 }));
  const results = evaluateBoundaryShapes({
    windowDist: uniform,
    boundary: [],
    samems: [],
    noHistoryRows: 0,
    ninety: { c: 2, m: "2026-08-28T00:00:00.000Z", win: 0, oldEnough: 1 },
    configuredAgents: new Set(["uat_agent_498"]),
  }, o);
  const r = results.find((x) => x.dim === "MCP-PERF 80/20 集中");
  assert.equal(r.status, "FAIL");
});

test("响应提取器：rows/connections/tokenMap 的宽容形态", () => {
  assert.deepEqual(extractQueryRows({ data: { rows: [[1]] } }), [[1]]);
  assert.deepEqual(extractQueryRows({ text: JSON.stringify({ data: { rows: [{ a: 2 }] } }) }), [{ a: 2 }]);
  assert.equal(extractQueryRows({ text: "not json" }), null);
  assert.deepEqual(firstRowNumbers({ total_sales: "1459476.0953", region: "East" }), [1459476.0953]);
  assert.deepEqual(extractConnections({ data: { connections: ["a", "b"] } }), ["a", "b"]);
  assert.deepEqual(extractConnections({ text: JSON.stringify({ items: [{ connectionId: "x" }] }) }), ["x"]);
  assert.deepEqual(normalizeTokenMap({ tokens: { a: "t1", b: "" } }), { a: "t1" });
  assert.deepEqual(normalizeTokenMap({ a: "t2" }), { a: "t2" });
  assert.deepEqual(normalizeTokenMap(null), {});
});

// ---- 默认档回归 ---------------------------------------------------------------

test("默认档：全绿 exit 0，输出无 MCP-PERF 行，且不触碰 MCP/凭据文件", async () => {
  const deps = greenDeps({
    env: {},
    mcpOpen: async () => {
      throw new Error("默认档不得发起 MCP 调用");
    },
    readTokenFile: () => {
      throw new Error("默认档不得读凭据文件");
    },
  });
  const { code, out } = await runMain([], deps);
  assert.equal(code, 0, out);
  assert.ok(!out.includes("MCP-PERF"), out);
  assert.ok(out.includes("已检查项全部达标"), out);
  assert.equal(deps.calls.mcpOpen, 0);
  assert.equal(deps.calls.readTokenFile, 0);
});

test("默认档：审计行量低于旧下限走 WARN 不卡退出码（§4 既有约定）", async () => {
  const deps = greenDeps({
    env: {},
    baseAuditCounts: () => ({ total: 500, win30: 100, active: 150 }),
  });
  const { code, out } = await runMain([], deps);
  assert.equal(code, 0, out);
  assert.match(rowOf(out, "审计调用行（全历史）"), /\| WARN/);
  assert.match(rowOf(out, "审计调用行（30 天）"), /\| WARN/);
});

test("默认档：审计查询异常回退 N/A，活跃 Agent 缺失判 FAIL（既有口径）", async () => {
  const deps = greenDeps({
    env: {},
    baseAuditCounts: () => {
      throw new Error("audit db missing");
    },
  });
  const { code, out } = await runMain([], deps);
  assert.equal(code, 1, out);
  assert.match(rowOf(out, "30 天活跃 Agent"), /\| FAIL/);
});

test("默认档：Hive SKIPPED 不卡退出码，--strict 时判 1（既有口径）", async () => {
  const deps = greenDeps({ env: {} });
  const relaxed = await runMain([], deps);
  assert.equal(relaxed.code, 0, relaxed.out);
  assert.match(rowOf(relaxed.out, "Hive 夹具表数"), /\| SKIPPED/);
  const strict = await runMain(["--strict"], greenDeps({ env: {} }));
  assert.equal(strict.code, 1, strict.out);
});

test("环境不可用：Docker 未起／容器缺失 → exit 2（含 profile 档）", async () => {
  const down = await runMain([], greenDeps({ dockerOk: () => false }));
  assert.equal(down.code, 2);
  const noLucy = await runMain([], greenDeps({ running: () => false }));
  assert.equal(noLucy.code, 2);
  const profDown = await runMain(["--profile", "mcp-perf"], greenDeps({ dockerOk: () => false }));
  assert.equal(profDown.code, 2);
});

test("未知参数／未知 profile → exit 2", async () => {
  assert.equal((await runMain(["--profile", "nope"], greenDeps())).code, 2);
  assert.equal((await runMain(["--nope"], greenDeps())).code, 2);
});

// ---- MCP-PERF profile：达标 → exit 0 ------------------------------------------

test("profile 全绿：exit 0，22 个 MCP-PERF 行齐全且仅表合计为 WARN", async () => {
  const { code, out } = await runMain(["--profile", "mcp-perf"], greenDeps());
  assert.equal(code, 0, out);
  const perfRows = out.split("\n").filter((l) => l.startsWith("MCP-PERF "));
  assert.equal(perfRows.length, 22, out);
  const fails = perfRows.filter((l) => l.includes("| FAIL"));
  assert.deepEqual(fails, [], out);
  const warns = perfRows.filter((l) => l.includes("| WARN"));
  assert.equal(warns.length, 1, out);
  assert.match(warns[0], /表合计/);
  // `--profile=mcp-perf` 等价写法
  const eq = await runMain(["--profile=mcp-perf"], greenDeps());
  assert.equal(eq.code, 0, eq.out);
});

test("profile：Hive 起来但合计 1805 <2000 → 表合计 WARN 不卡退出码", async () => {
  const deps = greenDeps({ running: () => true });
  const { code, out } = await runMain(["--profile", "mcp-perf"], deps);
  assert.equal(code, 0, out);
  assert.match(rowOf(out, "MCP-PERF 表合计（跨夹具）"), /\| WARN/);
});

// ---- MCP-PERF profile：逐行未达标 → exit 1 且指明缺项 ---------------------------

const failCases = [
  {
    name: "压测身份 49 → 身份数 FAIL",
    dim: "MCP-PERF 压测 Agent 身份数",
    mutate: (d) => {
      const c = d.readAccessConfig();
      c.users = c.users.filter((u) => u.id !== "uat_perf_050");
    },
  },
  {
    name: "跨身份共享凭据 → 身份互异 FAIL",
    dim: "MCP-PERF 身份互异（自有 Token）",
    mutate: (d) => {
      const c = d.readAccessConfig();
      c.users.find((u) => u.id === "uat_perf_004").tokens = [{ hash: "sha256:perf3" }];
    },
  },
  {
    name: "仅 1 个 lucy_admin → 绑定身份 FAIL",
    dim: "MCP-PERF lucy_admin 绑定身份",
    mutate: (d) => {
      const c = d.readAccessConfig();
      c.users.find((u) => u.id === "uat_perf_002").role = "uat_role_003";
    },
  },
  {
    name: "非 admin 身份挤在单一受限角色 → 分组 FAIL",
    dim: "MCP-PERF 受限角色分组",
    mutate: (d) => {
      const c = d.readAccessConfig();
      for (const u of c.users) {
        if (u.id.startsWith("uat_perf_") && u.role !== "lucy_admin") u.role = "uat_role_001";
      }
    },
  },
  {
    name: "正式角色 199 → 默认档与 profile 构成双 FAIL",
    dim: "MCP-PERF 正式角色构成",
    alsoDim: "正式角色数",
    mutate: (d) => {
      const c = d.readAccessConfig();
      delete c.roles.uat_role_197;
    },
  },
  {
    name: "全历史 1,000,506 → FAIL",
    dim: "MCP-PERF 审计调用行（全历史）",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql === "SELECT COUNT(*) c FROM ops_calls" ? [{ c: 1000506 }] : q(sql, p);
    },
  },
  {
    name: "窗内 200,497 → FAIL",
    dim: "MCP-PERF 审计调用行（30 天）",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("WHERE ts >=") && !sql.includes("GROUP BY") ? [{ c: 200497 }] : q(sql, p);
    },
  },
  {
    name: "30 天活跃 498 → FAIL",
    dim: "MCP-PERF 30 天活跃 Agent",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("COUNT(DISTINCT agent_id)") ? [{ c: 498 }] : q(sql, p);
    },
  },
  {
    name: "最热单 Agent 40,099 → FAIL",
    dim: "MCP-PERF 最热单 Agent（窗内）",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("LIMIT 1") ? [{ agent_id: "uat_agent_001", c: 40099 }] : q(sql, p);
    },
  },
  {
    name: "80/20 share 不足 → FAIL",
    dim: "MCP-PERF 80/20 集中",
    mutate: (d) => {
      const q = d.auditQuery;
      const uniform = Array.from({ length: 500 }, (_, i) => ({ agent_id: `a${i}`, c: 400 }));
      d.auditQuery = (sql, p) => sql.includes("GROUP BY agent_id") && !sql.includes("LIMIT 1") ? uniform : q(sql, p);
    },
  },
  {
    name: "窗边界缺一条 → FAIL",
    dim: "MCP-PERF 窗边界前后各一条",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("LIKE ?") && String(p[0]).includes("boundary")
        ? [{ request_id: "b1", user_id: "uat_agent_002", ts: iso(T0) }]
        : q(sql, p);
    },
  },
  {
    name: "窗边界归属错误 → FAIL",
    dim: "MCP-PERF 窗边界前后各一条",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("LIKE ?") && String(p[0]).includes("boundary")
        ? [
            { request_id: "b1", user_id: "uat_agent_009", ts: iso(T0) },
            { request_id: "b2", user_id: "uat_agent_003", ts: iso(T0 + 1) },
            { request_id: "b3", user_id: "uat_agent_004", ts: iso(T0 + 2) },
          ]
        : q(sql, p);
    },
  },
  {
    name: "同毫秒同 id → FAIL",
    dim: "MCP-PERF 同毫秒不同 id",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("LIKE ?") && String(p[0]).includes("samems")
        ? [
            { request_id: "s1", user_id: "uat_agent_005", ts: iso(T0) },
            { request_id: "s1", user_id: "uat_agent_005", ts: iso(T0) },
          ]
        : q(sql, p);
    },
  },
  {
    name: "无历史 Agent 有行 → FAIL",
    dim: "MCP-PERF 无历史 Agent",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("WHERE user_id = ?") && p[0] === "uat_agent_498" ? [{ c: 3 }] : q(sql, p);
    },
  },
  {
    name: "90 天 Agent 窗内有行 → FAIL",
    dim: "MCP-PERF 仅 90 天前活跃 Agent",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("oldEnough") ? [{ c: 4, m: "2026-11-25T00:00:00.000Z", win: 2, oldEnough: 0 }] : q(sql, p);
    },
  },
  {
    name: "KTX 索引 250 < 300 文件 → FAIL",
    dim: "MCP-PERF KTX Wiki 索引覆盖",
    mutate: (d) => {
      d.ktxWikiIndexedCount = () => 250;
    },
  },
  {
    name: "wiki_search 未命中标记 key → FAIL",
    dim: "MCP-PERF wiki_search 合成标记命中",
    mutate: (d) => {
      const call = d.mcpCallTool;
      d.mcpCallTool = async (t, s, name, args) => name === "wiki_search"
        ? { status: 200, isError: false, data: { results: [{ key: "global/other.md" }] }, text: "" }
        : call(t, s, name, args);
    },
  },
  {
    name: "lucy_skill_read 返回 ACL 拒绝 → FAIL",
    dim: "MCP-PERF lucy_skill_read 实读",
    mutate: (d) => {
      const call = d.mcpCallTool;
      d.mcpCallTool = async (t, s, name, args) => name === "lucy_skill_read"
        ? { status: 200, isError: true, text: "context_not_available" }
        : call(t, s, name, args);
    },
  },
  {
    name: "缺凭据文件 → 运行时各行 FAIL 且点名",
    dim: "MCP-PERF 运行时身份核对",
    alsoDim: "MCP-PERF wiki_search 合成标记命中",
    mutate: (d) => {
      d.env = {};
    },
  },
  {
    name: "审计只见 49 身份 → 运行时身份核对 FAIL",
    dim: "MCP-PERF 运行时身份核对",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("DISTINCT user_id")
        ? PERF_IDS.slice(1).map((id) => ({ user_id: id }))
        : q(sql, p);
    },
  },
  {
    name: "role_ids 不含配置角色 → 运行时角色绑定 FAIL",
    dim: "MCP-PERF 运行时角色绑定",
    mutate: (d) => {
      const q = d.auditQuery;
      d.auditQuery = (sql, p) => sql.includes("role_ids IS NOT NULL")
        ? PERF_IDS.map((id) => ({
            user_id: id,
            role_ids: JSON.stringify([id === "uat_perf_007" ? "uat_role_999" : roleOfPerf(id)]),
          }))
        : q(sql, p);
    },
  },
  {
    name: "连接可见性越权（看到角色外连接）→ 运行时角色绑定 FAIL",
    dim: "MCP-PERF 运行时角色绑定",
    mutate: (d) => {
      const call = d.mcpCallTool;
      d.mcpCallTool = async (t, s, name, args) => {
        if (name === "connection_list" && String(t) === "tok-uat_perf_010") {
          return { status: 200, isError: false, data: { connections: ["demo-mysql", "lucy-ops"] }, text: "" };
        }
        return call(t, s, name, args);
      };
    },
  },
  {
    name: "lucy_admin 全局 Source 缺连接 → FAIL",
    dim: "MCP-PERF 全局 Source 集合",
    mutate: (d) => {
      d.readKtxConnectionIds = () => ["demo-mysql", "lucy-ops", "extra-conn"];
    },
  },
  {
    name: "demo-mysql total_sales 与基线不符 → 跨连接查询 FAIL",
    dim: "MCP-PERF 跨连接正确查询",
    mutate: (d) => {
      const call = d.mcpCallTool;
      d.mcpCallTool = async (t, s, name, args) => {
        if (name === "lucy_query" && args.measures[0].includes("total_sales")) {
          return { status: 200, isError: false, data: { rows: [[1459400.0]] }, text: "" };
        }
        return call(t, s, name, args);
      };
    },
  },
];

for (const tc of failCases) {
  test(`profile 未达标：${tc.name}`, async () => {
    const deps = greenDeps();
    tc.mutate(deps);
    const { code, out } = await runMain(["--profile", "mcp-perf"], deps);
    assert.equal(code, 1, out);
    const row = rowOf(out, tc.dim);
    assert.ok(row, `输出行缺失：${tc.dim}\n${out}`);
    assert.match(row, /\| FAIL/, `${tc.dim} 应为 FAIL：${row}`);
    if (tc.alsoDim) {
      assert.match(rowOf(out, tc.alsoDim), /\| FAIL/, `${tc.alsoDim} 应为 FAIL`);
    }
  });
}

test("profile：默认档不受 profile 失败项影响——去掉 perf 身份后默认档仍 exit 0", async () => {
  const deps = greenDeps({ env: {} });
  const c = deps.readAccessConfig();
  c.users = c.users.filter((u) => !u.id.startsWith("uat_perf_"));
  const { code, out } = await runMain([], deps);
  assert.equal(code, 0, out);
  assert.ok(!out.includes("MCP-PERF"), out);
});

// ---- customer-stability profile（§1.2 客户超标稳定性基线档） -------------------

test("customer-stability profile：满足 >=10 连接 / >=30 Schema / >=3500 表 / <=2C 2Gi 时 exit 0", async () => {
  const deps = greenDeps({
    env: {},
    running: () => true,
    mysql: (sql) => {
      if (sql.includes("information_schema.tables")) return "2900";
      if (sql.includes("information_schema.columns")) return "1000";
      if (sql.includes("dataforai.superstore_orders")) return "1000";
      if (sql.includes("dataforai.superstore_returns")) return "60";
      if (sql.includes("dataforai.superstore_people")) return "4";
      throw new Error(`unexpected mysql: ${sql}`);
    },
    readKtxConnectionIds: () => Array.from({ length: 10 }, (_, i) => `conn-${i + 1}`),
    countConfiguredSchemas: () => 30,
    containerResourceLimits: () => ({ memoryBytes: 2 * 1024 * 1024 * 1024, nanoCpus: 2 * 1e9 }),
  });
  const { code, out } = await runMain(["--profile", "customer-stability"], deps);
  assert.equal(code, 0, out);
  assert.match(rowOf(out, "CUST-STAB 数据连接数"), /\| PASS/);
  assert.match(rowOf(out, "CUST-STAB Schema 数"), /\| PASS/);
  assert.match(rowOf(out, "CUST-STAB 跨源表合计"), /\| PASS/);
  assert.match(rowOf(out, "CUST-STAB 容器内存上限"), /\| PASS/);
  assert.match(rowOf(out, "CUST-STAB 容器 CPU 上限"), /\| PASS/);
});

test("customer-stability profile：连接/Schema/表数不足或未限制容器内存 CPU 时 exit 1", async () => {
  const deps = greenDeps({
    env: {},
    readKtxConnectionIds: () => ["conn-1", "conn-2"],
    countConfiguredSchemas: () => 25,
    containerResourceLimits: () => ({ memoryBytes: 0, nanoCpus: 0 }),
  });
  const { code, out } = await runMain(["--profile=customer-stability"], deps);
  assert.equal(code, 1, out);
  assert.match(rowOf(out, "CUST-STAB 数据连接数"), /\| FAIL/);
  assert.match(rowOf(out, "CUST-STAB Schema 数"), /\| FAIL/);
  assert.match(rowOf(out, "CUST-STAB 跨源表合计"), /\| FAIL/);
  assert.match(rowOf(out, "CUST-STAB 容器内存上限"), /\| FAIL/);
  assert.match(rowOf(out, "CUST-STAB 容器 CPU 上限"), /\| FAIL/);
});
