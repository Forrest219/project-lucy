#!/usr/bin/env node
/**
 * mcp-inquiry-performance-uat.mjs — P1-78 Task 5：隔离 Docker baseline-seed 测程入口。
 *
 * 步骤（Plan Task 5）：
 *   1. 启动独立 compose 项目（专用网络／卷，端口经 env 覆盖隔离）；
 *   2. 按全局规模基线灌夹具：大 Schema（P1-34）→ access → MCP-PERF 50 身份
 *      → Wiki／Skill → 审计行（全部幂等、固定 seed，本套件不造第二套数）；
 *   3. 规模断言：默认档＋ `--profile mcp-perf`（未达标即失败，不缩规模开跑）；
 *   4. R0 测程自检：已知正常请求通过＋已知错误被检出（2× 延迟与受控慢请求
 *      归完整 R0 跑次执行）；
 *   5. baseline-seed 跑次：调用 `run-mcp-inquiry-performance.mjs --trigger <t>`，
 *      判定为 SEED_ONLY（首次基线未具名接受，永远不是 PASS）。
 *
 * 用法：node scripts/uat/mcp-inquiry-performance-uat.mjs seed --trigger nightly [--down] [--skip-runner]
 * 覆盖：MIP_STACK_PROJECT／MIP_STACK_WEBUI_PORT／MIP_STACK_PROXY_PORT／MIP_STACK_MYSQL_PORT、
 *       UAT_MCP_PERF_TOKEN_FILE（隔离栈 Token 文件，默认 <repo>/../.lucy-secrets/mcp-perf-tokens-uat.json）
 */
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STACK,
  dbContainer,
  lucyContainer,
  seedEnv,
  stackRunning,
  startStack,
  stopStack,
  waitHealthy,
} from "./lib/mcp-inquiry-performance-docker.mjs";
import { startSoakSentinel } from "./lib/soak-sentinel-companion.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const options = { command: null, trigger: "nightly", down: false, skipRunner: false, lite: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "seed") options.command = "seed";
    else if (a === "--trigger") options.trigger = argv[++i] ?? "";
    else if (a === "--down") options.down = true;
    else if (a === "--skip-runner") options.skipRunner = true;
    else if (a === "--lite") options.lite = true;
    else if (a === "--help" || a === "-h") options.command = "help";
    else {
      console.error(`[mip-uat] 未知参数：${a}`);
      options.command = "help";
    }
  }
  return options;
}

function stackFromEnv() {
  return {
    project: process.env.MIP_STACK_PROJECT || DEFAULT_STACK.project,
    webuiPort: Number(process.env.MIP_STACK_WEBUI_PORT || DEFAULT_STACK.webuiPort),
    proxyPort: Number(process.env.MIP_STACK_PROXY_PORT || DEFAULT_STACK.proxyPort),
    mysqlPort: Number(process.env.MIP_STACK_MYSQL_PORT || DEFAULT_STACK.mysqlPort),
  };
}

/** 读取仓外 token 文件（{"NAME":"plain",...}）为环境变量映射。 */
function readJsonTokens(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    console.warn(`[mip-uat] 警告：token 文件不可读 ${file}（相关场景将 TOKEN_MISSING）`);
    return {};
  }
}

function runStep(name, cmd, args, env, { optional = false } = {}) {
  console.log(`\n[mip-uat] ▶ ${name}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env, cwd: REPO_ROOT });
  if (r.status !== 0) {
    if (optional) {
      console.log(`[mip-uat] ⚠ ${name} 未通过（可选步骤，继续）`);
      return false;
    }
    throw new Error(`${name} 失败（exit=${r.status}）`);
  }
  return true;
}

/** R0 测程自检：已知正常请求通过＋已知错误被检出。 */
async function r0SelfCheck(stack, tokenFile) {
  console.log("\n[mip-uat] ▶ R0 测程自检");
  const mcpUrl = `http://127.0.0.1:${stack.proxyPort}/mcp`;
  const tokens = JSON.parse((await import("node:fs")).readFileSync(tokenFile, "utf8")).tokens;
  const results = [];

  async function callAs(token, name, args) {
    const open = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mip-r0", version: "0" } } }),
    });
    const session = open.headers.get("mcp-session-id");
    await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-session-id": session },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const r = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-session-id": session },
      body: JSON.stringify({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name, arguments: args } }),
    });
    const j = await r.json();
    const res = j.result;
    return { isError: res?.isError === true, text: res?.content?.[0]?.text ?? "", status: r.status };
  }

  // ① 已知正常请求通过：superstore total_sales 对 _baseline.json
  const adminToken = tokens["uat_perf_001"];
  const baseline = JSON.parse((await import("node:fs")).readFileSync(
    new URL("../../examples/docker-demo/mysql/_baseline.json", import.meta.url), "utf8"));
  const ok = await callAs(adminToken, "lucy_query", { connectionId: "demo-mysql", measures: ["superstore_orders.total_sales"] });
  let salesVal = null;
  try {
    const parsed = JSON.parse(ok.text);
    const rows = parsed?.data?.rows ?? parsed?.rows ?? (Array.isArray(parsed?.data) ? parsed.data : null) ?? [];
    const first = Array.isArray(rows) ? rows[0] : null;
    if (first && typeof first === "object") {
      salesVal = Object.values(first).map((v) => Number(v)).find((n) => Number.isFinite(n)) ?? null;
    }
  } catch { salesVal = null; }
  const normalOk = !ok.isError && salesVal !== null &&
    Math.abs(Number(salesVal) - Number(baseline.measures.total_sales)) <= 0.01;
  results.push({ check: "已知正常请求通过（total_sales 对基线）", ok: normalOk, detail: `total_sales=${salesVal ?? "n/a"}` });

  // ② 已知错误被检出：未知连接必须被拒绝
  const deny = await callAs(adminToken, "lucy_query", { connectionId: "no-such-conn-perf", measures: ["x.y"] });
  const denyOk = deny.isError || /forbidden|denied|unknown/i.test(deny.text);
  results.push({ check: "已知错误被检出（未知连接拒绝）", ok: denyOk, detail: deny.text.slice(0, 80) });

  let failed = 0;
  for (const r of results) {
    console.log(`[mip-uat] R0 ${r.ok ? "PASS" : "FAIL"}｜${r.check}｜${r.detail}`);
    if (!r.ok) failed++;
  }
  if (failed > 0) throw new Error(`R0 自检 ${failed} 项未通过`);
  console.log("[mip-uat] R0 自检通过");
}

async function seed(options) {
  const stack = stackFromEnv();
  const tokenFile = process.env.UAT_MCP_PERF_TOKEN_FILE ||
    path.resolve(REPO_ROOT, "..", ".lucy-secrets", "mcp-perf-tokens-uat.json");
  const compatTokenFile = process.env.UAT_COMPAT_TOKEN_FILE ||
    path.resolve(REPO_ROOT, "..", ".lucy-secrets", "mcp-compat-tokens-uat.json");
  const lucy = lucyContainer(stack);
  const db = dbContainer(stack);
  const env = seedEnv(stack, { UAT_MCP_PERF_TOKEN_FILE: tokenFile });

  console.log(`[mip-uat] 隔离栈 project=${stack.project} lucy=${lucy} db=${db}`);
  if (!stackRunning(stack)) {
    startStack(stack, console.log);
  } else {
    console.log("[mip-uat] 隔离栈已在运行，复用");
  }
  await waitHealthy(stack, { log: console.log });

  // 2) 夹具装载。--lite（PR 档）：PR 家族不含 WIDE／SOAK／LONG_FOLLOW，无规模档
  // 前置——只造 compat 专用身份，跳过大 Schema／access 规模人口／MCP-PERF 身份／
  // Wiki／Skill／审计行与两档断言（不缩正式档规模：正式档仍走全量 seed）。
  if (options.lite) {
    runStep("compat 专用身份（lite）",
      "node", ["scripts/uat/seed-scale-compat-identities.mjs"], seedEnv(stack, {
        UAT_COMPAT_TOKEN_FILE: compatTokenFile,
      }));
  } else {
    runStep("大 Schema 夹具（P1-34，mysql 档）",
      "bash", ["scripts/uat/seed-large-schema-fixtures.sh", "mysql"], env);
    runStep("access.yaml（200 角色／500 Agent）",
      "node", ["scripts/uat/seed-scale-access.mjs"], env);
    runStep("MCP-PERF 50 压测身份＋Token 文件",
      "node", ["scripts/uat/seed-scale-mcp-perf-identities.mjs"], env);
    runStep("P1-54 题库 compat 专用身份＋Token 文件",
      "node", ["scripts/uat/seed-scale-compat-identities.mjs"], seedEnv(stack, {
        UAT_COMPAT_TOKEN_FILE: compatTokenFile,
      }));
    runStep("Wiki 300 页＋Skill 100 个",
      "node", ["scripts/uat/seed-scale-wiki-skills.mjs"], env);
    runStep("审计行（窗内 20 万＋全历史 100 万）",
      "node", ["scripts/uat/seed-scale-audit-rows.mjs"], env);
    // audit seed 在宿主侧长事务灌库后，WAL 可能滞留导致后续审计读取/写入
    // 漂移（实测：TRUNCATE checkpoint 后 Lucy 审计写入恢复）。灌库收尾固定
    // checkpoint 一次（PASSIVE，不要求独占）。
    runStep("审计库 WAL checkpoint",
      "docker", ["exec", lucy, "node", "-e",
        "const D=require('/app/node_modules/better-sqlite3');" +
        "const db=new D('/data/lucy/.ktx-ui/audit.sqlite',{fileMustExist:true});" +
        "console.log('checkpoint:',JSON.stringify(db.pragma('wal_checkpoint',{simple:true})));" +
        "db.close();"], env);

    // 3) 规模断言（默认档＋MCP-PERF profile）
    runStep("规模断言（默认档）", "node", ["scripts/uat/check-uat-scale-baseline.mjs"], env);
    runStep("规模断言（MCP-PERF profile）",
      "node", ["scripts/uat/check-uat-scale-baseline.mjs", "--profile", "mcp-perf"], env);
  }

  // 4) R0 自检
  await r0SelfCheck(stack, tokenFile);

  // 5) baseline-seed 跑次
  if (!options.skipRunner) {
    console.log(`\n[mip-uat] ▶ baseline-seed 跑次（trigger=${options.trigger}）`);
    // 并发档身份池：fixtures §5 要求 20／50 路各自独立 Token。排除绑定
    // lucy_ops_reader 的 uat_perf_050（该角色无 demo-mysql 表权限，查询被拒
    // 是按角色设计的正确拒绝，不进并发池）。
    const poolFile = path.resolve(path.dirname(tokenFile), "mcp-perf-pool-uat.json");
    try {
      const perfTokens = JSON.parse(readFileSync(tokenFile, "utf8")).tokens ?? {};
      const pool = Object.entries(perfTokens)
        .filter(([id]) => id !== "uat_perf_050")
        .map(([, plain]) => plain);
      writeFileSync(poolFile, JSON.stringify(pool, null, 2) + "\n", { mode: 0o600 });
      chmodSync(poolFile, 0o600);
      console.log(`[mip-uat] 并发身份池已写 ${poolFile}（${pool.length} token，0600）`);
    } catch (e) {
      console.warn(`[mip-uat] 警告：并发池生成失败（${e?.message || e}），并发档将退回单 token`);
    }
    const runnerEnv = seedEnv(stack, {
      UAT_MCP_PERF_TOKEN_FILE: tokenFile,
      LUCY_WEBUI_URL: `http://127.0.0.1:${stack.webuiPort}`,
      LUCY_MCP_URL: `http://127.0.0.1:${stack.proxyPort}/mcp`,
      MIP_SCALE_PROFILE_SATISFIED: "1",
      MIP_CONCURRENCY_TOKEN_FILE: poolFile,
      // 题库 tokenRef（env:COMPAT_TOKEN_*）从仓外 0600 文件展开注入，
      // 不把明文写进 argv／证据。
      ...readJsonTokens(compatTokenFile),
    });
    const sentinelDir = path.join(REPO_ROOT, "inbox", `mip-sentinel-${Date.now()}`);
    const sentinelAdminId = (process.env.LUCY_SENTINEL_ADMIN_ID || "").trim();
    const sentinelPasswordFile = (process.env.LUCY_SENTINEL_PASSWORD_FILE || "").trim();
    if (!sentinelAdminId || !sentinelPasswordFile) {
      console.warn("[mip-uat] 提示：未设置 LUCY_SENTINEL_ADMIN_ID/LUCY_SENTINEL_PASSWORD_FILE，伴随哨兵本次跳过 /api/auth/login 探活");
    }
    const sentinel = startSoakSentinel({
      baseUrl: `http://127.0.0.1:${stack.webuiPort}`,
      mcpUrl: `http://127.0.0.1:${stack.proxyPort}/mcp`,
      intervalMs: 15_000,
      adminId: sentinelAdminId,
      passwordFile: sentinelPasswordFile,
      outPath: path.join(sentinelDir, "stability-sentinel-summary.json"),
      logPath: path.join(sentinelDir, "stability-sentinel.jsonl"),
    });
    console.log(`[mip-uat] 伴随稳定性哨兵已启动 pid=${sentinel.pid} out=${sentinelDir}`);
    // N3: 捕获 Ctrl+C / SIGTERM，确保退出前收尾伴随哨兵，不留孤儿进程。
    const onAbortSignal = (sig) => {
      console.warn(`[mip-uat] 收到 ${sig}，正在停止伴随稳定性哨兵…`);
      void sentinel.stop().finally(() => process.exit(130));
    };
    process.once("SIGINT", onAbortSignal);
    process.once("SIGTERM", onAbortSignal);
    let r;
    let sentinelResult;
    try {
      r = spawnSync("node", ["scripts/e2e/run-mcp-inquiry-performance.mjs", "--trigger", options.trigger], {
        stdio: "inherit", env: runnerEnv, cwd: REPO_ROOT,
      });
    } finally {
      process.off("SIGINT", onAbortSignal);
      process.off("SIGTERM", onAbortSignal);
      sentinelResult = await sentinel.stop();
    }
    console.log(
      `[mip-uat] 伴随稳定性哨兵 verdict=${sentinelResult.summary?.verdict ?? "UNKNOWN"} ` +
      `samples=${sentinelResult.summary?.sampleCount ?? 0} violations=${sentinelResult.summary?.violations?.length ?? "-"} ` +
      `out=${sentinelResult.outPath}`
    );
    // runner 退出码非 0 不必然是失败：SEED_ONLY／BLOCKED 也可能非 0。输出证据已落盘，
    // 由 verifier／人工读证据判定；此处不吞掉退出码。
    console.log(`[mip-uat] runner exit=${r.status}`);
    if (r.status !== 0) console.log("[mip-uat] 注意：runner 非 0 退出——读 evidence/ 与 stdout 判定（SEED_ONLY 预期不是 PASS）");
    if (!sentinelResult.passed) {
      throw new Error(`伴随稳定性哨兵门禁 FAIL（详见 ${sentinelResult.outPath}）`);
    }
  } else {
    console.log("[mip-uat] --skip-runner：跳过 baseline-seed 跑次");
  }

  if (options.down) {
    stopStack(stack, console.log);
  } else {
    console.log("[mip-uat] 隔离栈保留（--down 可清理）");
  }
}

const options = parseArgs(process.argv.slice(2));
if (options.command === "help" || !options.command) {
  console.log("用法：node scripts/uat/mcp-inquiry-performance-uat.mjs seed --trigger <pr|nightly|release> [--down] [--skip-runner]");
  process.exit(options.command ? 0 : 2);
} else {
  seed(options).catch((err) => {
    console.error(`[mip-uat] 执行失败：${err?.message || err}`);
    process.exit(1);
  });
}
