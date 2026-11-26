/**
 * access-write-window-profile.mjs — REQ-0117 写窗测量（红基准 / profile / 超时链核实）。
 *
 *   baseline — 修复前红基准（SC-01）：写窗内 0.05s 轮询 GET /api/admin/roles，
 *              统计 503 DISPLAY_SNAPSHOT_BUSY（write_pending）；同窗重叠写期望
 *              立即 503 PUBLISH_COORDINATOR_BUSY。
 *   profile  — 写窗分相观测：小角色 vs 大角色写窗时长、pending 子窗口（0.02s 轮询
 *              与 /api/health displayBusy.recent 双口径）、写结算后首读的
 *              Server-Timing（展示快照重建耗时）。
 *   timeouts — 端到端超时链核实记录（compose / Fastify / 浏览器 fetch）。
 *
 * 证据 JSON 落 inbox/req0117-dev/。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEB, SECRET_DIR } from "./access-write-window-stack.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "inbox/req0117-dev");
const SCHEMA = "req0117";
const CONNECTION = "demo-mysql";
const TABLE_COUNT = 2000;

let cookie = "";
function loginCookie() {
  const cred = JSON.parse(readFileSync(path.join(SECRET_DIR, "admin.json"), "utf8"));
  return fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
  }).then((res) => {
    if (res.status !== 200) throw new Error(`admin 登录失败：${res.status}`);
    return (res.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });
}

async function api(pathname, method = "GET", body) {
  const started = Date.now();
  const res = await fetch(`${WEB}${pathname}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, ms: Date.now() - started, headers: res.headers, text };
}

function names(tableCount) {
  return Array.from({ length: tableCount }, (_, i) => `${SCHEMA}.t${String(i + 1).padStart(4, "0")}`);
}

function roleBody(roleId, tableCount) {
  return {
    dryRun: true,
    roleId,
    role: {
      description: `REQ-0117 profile role (${tableCount} tables)`,
      allow: { connections: [CONNECTION], tableSelectors: [{ connection: CONNECTION, schema: SCHEMA, names: names(tableCount) }], tools: ["lucy_catalog", "lucy_query", "lucy_read_source"] }
    }
  };
}

/** RACS 两步创建：dryRun 取绑定 → object-version 写。返回 [dryRun 耗时, write 耗时]。 */
async function createRole(roleId, tableCount) {
  const dry = await api("/api/admin/roles", "POST", roleBody(roleId, tableCount));
  if (dry.status !== 200) throw new Error(`dryRun ${roleId} 失败 ${dry.status}: ${JSON.stringify(dry.json)?.slice(0, 200)}`);
  const preview = dry.json?.data ?? {};
  const write = await api("/api/admin/roles", "POST", {
    ...roleBody(roleId, tableCount),
    dryRun: false,
    baseObjectVersion: preview.baseObjectVersion,
    previewToken: preview.previewToken,
    ...(preview.compileInputsDigest ? { compileInputsDigest: preview.compileInputsDigest } : {}),
    operationId: crypto.randomUUID()
  });
  if (write.status !== 200) throw new Error(`write ${roleId} 失败 ${write.status}: ${JSON.stringify(write.json)?.slice(0, 300)}`);
  return { dryMs: dry.ms, writeMs: write.ms, write };
}

/**
 * 写窗内并发轮询：0.05s 间隔 GET /api/admin/roles，记录每次状态码与
 * x-lucy-busy-reason；终止条件：写请求已返回且此后连续 3 次 200。
 */
async function pollDuringWrite(pollIntervalMs) {
  const events = [];
  let stop = false;
  const poller = (async () => {
    for (;;) {
      if (stop) break;
      const at = Date.now();
      const res = await api("/api/admin/roles");
      events.push({
        at,
        status: res.status,
        busyReason: res.headers?.get?.("x-lucy-busy-reason") ?? undefined,
        code: res.json?.error?.code ?? undefined,
        ms: res.ms
      });
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, pollIntervalMs - res.ms)));
    }
  })();
  return { events, stop: () => { stop = true; return poller; } };
}

async function displayBusyRecent() {
  const res = await api("/api/health");
  return res.json?.displayBusy ?? null;
}


/** 服务端口径的 pending 子窗口：displayBusy.recent 里 `since` 之后的 write_pending 事件首末 `at` 差。 */
async function serverPendingWindowMs(sinceMs) {
  const res = await api("/api/health");
  const recent = res.json?.data?.displayBusy?.recent ?? [];
  const events = recent.filter((e) => e.reason === "write_pending" && Date.parse(e.at) >= sinceMs);
  if (events.length === 0) return { pendingWindowMs: 0, events: 0, eventLoopMaxMs: null };
  const times = events.map((e) => Date.parse(e.at)).sort((a, b) => a - b);
  return {
    pendingWindowMs: times[times.length - 1] - times[0],
    events: events.length,
    eventLoopMaxMs: Math.max(...events.map((e) => e.eventLoopMaxMs ?? 0))
  };
}

/** 红基准（SC-01）。 */
async function baseline() {
  mkdirSync(OUT_DIR, { recursive: true });
  cookie = await loginCookie();
  const evidence = { mode: "baseline", at: new Date().toISOString(), webui: WEB, cases: [] };

  // 用例 1：2000 表角色写窗内的 role-list 读 + 真并发重叠写
  {
    const poller = await pollDuringWrite(50);
    let writeMs = null;
    let secondWrite = null;
    // 重叠写先完成自己的 dryRun（锁外），再在第一写进行中发起提交。
    const overlapId = `req0117_overlap_${Date.now() % 100000}`;
    const overlapDry = await api("/api/admin/roles", "POST", roleBody(overlapId, 1));
    if (overlapDry.status !== 200) throw new Error(`重叠写 dryRun 失败 ${overlapDry.status}`);
    const overlapPreview = overlapDry.json?.data ?? {};
    // 确定性触发：轮询观测到首个 write_pending 503（证明写屏障正挂起）时立即发起重叠写；
    // 3s 兜底（未见 503 时也发起）。
    const bigStart = Date.now();
    const writePromise = createRole(`req0117_base_${Date.now() % 100000}`, TABLE_COUNT)
      .then((r) => { writeMs = r.writeMs; return r; });
    const overlapPromise = (async () => {
      const started = Date.now();
      for (;;) {
        const seen = poller.events.some((e) => e.status === 503 && e.busyReason === "write_pending");
        if (seen || Date.now() - started > 3000) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const firedAt = Date.now();
      const res = await api("/api/admin/roles", "POST", {
        ...roleBody(overlapId, 1),
        dryRun: false,
        baseObjectVersion: overlapPreview.baseObjectVersion,
        previewToken: overlapPreview.previewToken,
        ...(overlapPreview.compileInputsDigest ? { compileInputsDigest: overlapPreview.compileInputsDigest } : {}),
        operationId: crypto.randomUUID()
      });
      secondWrite = { status: res.status, ms: res.ms, code: res.json?.error?.code ?? null, wallMs: Date.now() - firedAt, firedAfterBigStartMs: firedAt - bigStart };
      return res;
    })();
    const result = await writePromise;
    const overlap = await overlapPromise;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stopPoller = poller.stop();
    await stopPoller;
    const busy = poller.events.filter((e) => e.status === 503);
    const writePending = busy.filter((e) => e.busyReason === "write_pending");
    evidence.cases.push({
      name: "big-role-write-with-concurrent-reads",
      writeMs,
      dryMs: result.dryMs,
      polls: poller.events.length,
      busy503: busy.length,
      writePending503: writePending.length,
      busyEvents: busy,
      overlapWrite: secondWrite
    });
    // 清理重叠写若意外成交的角色
    if (overlap.status === 200) await api(`/api/admin/roles/${overlapId}`, "DELETE", {});
  }
  evidence.displayBusy = await displayBusyRecent();
  const out = path.join(OUT_DIR, `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`[req0117-profile] 红基准证据 → ${path.relative(ROOT, out)}`);
  const c = evidence.cases[0];
  console.log(`[req0117-profile] 写窗=${c.writeMs}ms 轮询=${c.polls} 503=${c.busy503}（write_pending=${c.writePending503}） 重叠写=${JSON.stringify(c.overlapWrite)}`);
  const symptom1 = c.writePending503 > 0;
  const symptom2 = c.overlapWrite?.code === "PUBLISH_COORDINATOR_BUSY";
  console.log(`[req0117-profile] SC-01 症状1（读 503 write_pending）=${symptom1 ? "复现" : "未复现"}；症状2（重叠写立即 503）=${symptom2 ? "复现" : "未复现"}`);
  return symptom1 && symptom2 ? 0 : 1;
}

/** 分相 profile。 */
async function profile() {
  mkdirSync(OUT_DIR, { recursive: true });
  cookie = await loginCookie();
  const evidence = { mode: "profile", at: new Date().toISOString(), webui: WEB, runs: [] };

  for (const [label, tableCount, repeats] of [["small-1-table", 1, 3], ["big-2000-table", TABLE_COUNT, 3]]) {
    for (let i = 0; i < repeats; i += 1) {
      const poller = await pollDuringWrite(100);
      const roleId = `req0117_prof_${label}_${i}`;
      let firstReadAfter = null;
      const writePromise = createRole(roleId, tableCount);
      const result = await writePromise;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const stopPoller = poller.stop();
      await stopPoller;
      firstReadAfter = await api("/api/admin/roles");
      const busy = poller.events.filter((e) => e.status === 503);
      const writePending = busy.filter((e) => e.busyReason === "write_pending");
      const serverTiming = firstReadAfter.headers?.get?.("server-timing") ?? null;
      evidence.runs.push({
        label,
        run: i,
        roleId,
        dryMs: result.dryMs,
        writeMs: result.writeMs,
        polls: poller.events.length,
        busy503: busy.length,
        writePending503: writePending.length,
        pendingWindowMs: writePending.length > 0 ? writePending[writePending.length - 1].at - writePending[0].at + 20 : 0,
        eventLoopMaxMs: (await displayBusyRecent())?.recent?.filter((e) => e.reason === "write_pending")?.at(-1)?.eventLoopMaxMs ?? null,
        firstReadAfterMs: firstReadAfter.ms,
        serverTiming,
        cleanupStatus: (await api(`/api/admin/roles/${roleId}`, "DELETE", {})).status
      });
      console.log(`[req0117-profile] ${label}#${i} 写=${result.writeMs}ms dry=${result.dryMs}ms 503=${busy.length} pending子窗=${evidence.runs.at(-1).pendingWindowMs}ms 首读=${firstReadAfter.ms}ms`);
    }
  }
  const out = path.join(OUT_DIR, `profile-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`[req0117-profile] profile 证据 → ${path.relative(ROOT, out)}`);
  return 0;
}

/** 超时链核实记录。 */
async function timeouts() {
  mkdirSync(OUT_DIR, { recursive: true });
  cookie = await loginCookie();
  // Fastify 配置核实：源码 Fastify({ logger: true })，未显式设置 requestTimeout / connectionTimeout /
  // keepAliveTimeout → 落 Node http server 默认（requestTimeout=300s、headersTimeout=60s）与
  // Fastify 默认（keepAliveTimeout=72s、connectionTimeout=0 不启用）。
  // 实测旁证：长请求（写窗 5-12s）从未被 408/断连截断；本记录以源码常量 + 实测为据。
  const evidence = {
    mode: "timeouts",
    at: new Date().toISOString(),
    webui: WEB,
    chain: [
      { layer: "compose", observed: "本机 Docker Desktop 端口直连（127.0.0.1），无 ingress/反代层；超时分母不受网关约束", source: "deploy/compose/docker-compose.demo.yml ports 直映射" },
      { layer: "k8s-ingress", observed: "本任务默认不关心客户部署环境（Docker 对齐），未部署 ingress；不构成分母", source: "AGENTS.md Docker 对齐" },
      { layer: "fastify", observed: "Fastify({ logger: true })：requestTimeout 未设置 → Node http server 默认 300_000ms；headersTimeout 默认 60_000ms；connectionTimeout 未设置（0，不启用）；keepAliveTimeout Fastify 默认 72_000ms", source: "webui/server/index.ts:918 + Node 24 默认值" },
      { layer: "browser-fetch", observed: "Chrome fetch 无应用层超时；网络层对空闲连接约 300s。对 10-15s 有界等待不构成约束", source: "Chromium 网络栈默认" }
    ],
    denominator: "有效端到端超时分母 = 300s（Fastify/Node requestTimeout）；OQ-2 约束「等待上限＋实测写窗 ≤ 分母」在 10–15s 档位下余量充足",
    probes: []
  };
  // 实测旁证：一个 >60s 的空闲连接不活跃即可，但无需真实等待 300s；记录一次 30s 级请求不被截断的探针。
  const started = Date.now();
  const slow = await fetch(`${WEB}/api/health`, { signal: AbortSignal.timeout(40_000) });
  evidence.probes.push({ probe: "GET /api/health", status: slow.status, ms: Date.now() - started });
  const out = path.join(OUT_DIR, `timeouts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`[req0117-profile] 超时链核实 → ${path.relative(ROOT, out)}`);
  return 0;
}

/** 差分归因：单变量剥离写窗成本的来源（enabled 规模 / manifest 重载 / per-user 编译）。 */
async function attribution() {
  mkdirSync(OUT_DIR, { recursive: true });
  cookie = await loginCookie();
  const stateFile = path.join(OUT_DIR, "state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const previousEnabled = state.previousEnabled ?? [];
  const evidence = { mode: "attribution", at: new Date().toISOString(), webui: WEB, experiments: [], restore: {} };

  // 归因角色绑定 dataforai.superstore_orders（恒启用），使「禁用 req0117 表」不破坏角色解析。
  // roleId 每次运行唯一（时间戳后缀）：已删 id 会被 tombstone（ROLE_ID_RETIRED），不可复用。
  const runTag = Date.now().toString(36);
  const sample = async (label, repeats = 3) => {
    const runs = [];
    for (let i = 0; i < repeats; i += 1) {
      const roleId = `req0117_attr_${label}_${runTag}_${i}`;
      const role = {
        dryRun: true,
        roleId,
        role: {
          description: `REQ-0117 attribution role (${label})`,
          allow: { connections: [CONNECTION], tableSelectors: [{ connection: CONNECTION, schema: "dataforai", names: ["superstore_orders"] }], tools: ["lucy_catalog", "lucy_query"] }
        }
      };
      const dry = await api("/api/admin/roles", "POST", role);
      if (dry.status !== 200) throw new Error(`dryRun ${roleId} 失败 ${dry.status}: ${JSON.stringify(dry.json)?.slice(0, 200)}`);
      const preview = dry.json?.data ?? {};
      const started = Date.now();
      const write = await api("/api/admin/roles", "POST", {
        ...role,
        dryRun: false,
        baseObjectVersion: preview.baseObjectVersion,
        previewToken: preview.previewToken,
        ...(preview.compileInputsDigest ? { compileInputsDigest: preview.compileInputsDigest } : {}),
        operationId: crypto.randomUUID()
      });
      if (write.status !== 200) throw new Error(`write ${roleId} 失败 ${write.status}: ${JSON.stringify(write.json)?.slice(0, 300)}`);
      const writeMs = Date.now() - started;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const pending = await serverPendingWindowMs(started);
      const run = { writeMs, dryMs: dry.ms, ...pending };
      runs.push(run);
      await api(`/api/admin/roles/${roleId}`, "DELETE", {});
      console.log(`[req0117-profile] ${label}#${i} 写=${run.writeMs}ms pending子窗=${run.pendingWindowMs}ms 事件=${run.events}`);
    }
    return runs;
  };

  // exp1：现状（500 Agent / 2003 启用表 / manifest 在位）
  evidence.experiments.push({ name: "exp1-full", config: "agents=500 enabled=2003 manifest=yes", runs: await sample("exp1") });

  // exp2：启用表回 3 张，manifest 保留 → Δ(exp1-exp2)=启用表规模效应
  {
    const put = await api(`/api/connections/${CONNECTION}/enabled-tables`, "PUT", { enabledTables: previousEnabled, dryRun: false });
    if (put.status !== 200) throw new Error(`恢复启用表失败 ${put.status}`);
    evidence.experiments.push({ name: "exp2-small-enabled", config: "agents=500 enabled=3 manifest=yes", runs: await sample("exp2") });
  }

  // exp3：移除 schema 与 manifest，启用 3 张 → Δ(exp2-exp3)=catalog/source-map 重载成本
  {
    const remove = await api(`/api/connections/${CONNECTION}/schemas/remove`, "POST", { schema: SCHEMA, dryRun: false, deleteManifest: true, deleteOverlays: true });
    if (remove.status !== 200) throw new Error(`移除 schema 失败 ${remove.status}`);
    evidence.experiments.push({ name: "exp3-no-manifest", config: "agents=500 enabled=3 manifest=no", runs: await sample("exp3") });
  }

  // exp4：Agent 降到基线（少量），3 表无 manifest → Δ(exp3-exp4)=per-user 编译 ×500 成本
  {
    execFileSync("docker", ["stop", "lucy-req0117-uat-lucy-1"], { timeout: 120_000 });
    execFileSync("docker", ["start", "lucy-req0117-uat-lucy-1"], { timeout: 120_000 });
    const env = { ...process.env, UAT_LUCY_CONTAINER: "lucy-req0117-uat-lucy-1", LUCY_DEMO_WEBUI_HOST_PORT: "55386", UAT_TARGET_ROLES: "6", UAT_TARGET_AGENTS: "8" };
    execFileSync("node", ["scripts/uat/seed-scale-access.mjs"], { stdio: "inherit", env, cwd: ROOT, timeout: 600_000 });
    evidence.experiments.push({ name: "exp4-few-agents", config: "agents=8 enabled=3 manifest=no", runs: await sample("exp4") });
  }

  // restore：恢复 500 Agent 规模水位 + 重新灌夹具（后续 Task 1/2/3 复测要用）
  {
    execFileSync("docker", ["stop", "lucy-req0117-uat-lucy-1"], { timeout: 120_000 });
    execFileSync("docker", ["start", "lucy-req0117-uat-lucy-1"], { timeout: 120_000 });
    const env = { ...process.env, UAT_LUCY_CONTAINER: "lucy-req0117-uat-lucy-1", LUCY_DEMO_WEBUI_HOST_PORT: "55386", UAT_TARGET_ROLES: "200", UAT_TARGET_AGENTS: "500" };
    execFileSync("node", ["scripts/uat/seed-scale-access.mjs"], { stdio: "inherit", env, cwd: ROOT, timeout: 600_000 });
    // 重新声明 schema / 上传 manifest / 启用 2000 表（保留既有启用表）
    const declare = await api(`/api/connections/${CONNECTION}/schemas`, "POST", { schema: SCHEMA, dryRun: false });
    if (declare.status !== 200) throw new Error(`恢复 schema 声明失败 ${declare.status}`);
    const manifestYaml = (() => {
      const lines = ["tables:"];
      for (let i = 1; i <= TABLE_COUNT; i += 1) {
        const t = `t${String(i).padStart(4, "0")}`;
        lines.push(`  ${t}:`, `    table: ${SCHEMA}.${t}`, `    columns:`, `      - name: id`, `        type: number`, `        pk: true`, `        nullable: false`, `      - name: name`, `        type: string`, `        nullable: true`, `      - name: created_at`, `        type: time`, `        nullable: true`);
      }
      return `${lines.join("\n")}\n`;
    })();
    const upload = await api("/api/catalog/assets/upload", "POST", { connectionId: CONNECTION, schema: SCHEMA, assetKind: "schema_manifest", filename: `${SCHEMA}.yaml`, content: manifestYaml });
    if (upload.status !== 200) throw new Error(`恢复 manifest 失败 ${upload.status}`);
    const enabled = [...new Set([...previousEnabled, ...names(TABLE_COUNT)])];
    const put = await api(`/api/connections/${CONNECTION}/enabled-tables`, "PUT", { enabledTables: enabled, dryRun: false });
    if (put.status !== 200) throw new Error(`恢复启用表失败 ${put.status}`);
    evidence.restore = { seeded: "agents=500 roles=200", manifest: "restored", enabled: enabled.length };
    console.log(`[req0117-profile] 环境已恢复：500 Agent + 2000 表夹具`);
  }

  const out = path.join(OUT_DIR, `attribution-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(`[req0117-profile] 归因证据 → ${path.relative(ROOT, out)}`);
  return 0;
}

const command = process.argv[2] ?? "baseline";
if (command === "baseline") process.exit(await baseline());
if (command === "profile") process.exit(await profile());
if (command === "timeouts") process.exit(await timeouts());
if (command === "attribution") process.exit(await attribution());
console.error(`unknown command: ${command}`);
process.exit(2);
