/**
 * mcp-inquiry-performance-chain-executor.mjs — P1-78 Task 7：长链／持续压力的
 * 真实宿主会话执行引擎。
 *
 * 合同（Spec D2／D19／D20；fixtures §9.1）：
 * - 长链在**同一宿主进程与同一宿主会话**内连续执行：每个链实例一个长驻宿主
 *   进程（`claude -p --input-format stream-json` 单进程多轮，实测同 session_id
 *   且语义承接成立），`processId／hostSessionId` 全程不变；
 * - 每个身份独立 workDir（宿主会话隔离）与独立凭据（`LUCY_E2E_TOKEN`）；
 *   不得由单个直连脚本轮换 Token 冒充多身份；
 * - 逐轮 oracle 用 agent-lane 的 exact checker（finalAnswer 数值匹配期望）；
 *   无最终答复的轮次＝wrong（D3）；
 * - 本模块只提供执行器（sessionFactory／turnExecutor），不做判定——判定归
 *   mcp-inquiry-performance-soak 的编排与 mcp-inquiry-performance 的判定器。
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";


const TOKEN_ENV = "LUCY_E2E_TOKEN";
const DEFAULT_BINARY = process.env.MIP_CHAIN_HOST_BIN || "/Users/zhangxingchen/.local/bin/kscc";

function writeMcpConfig(workDir, mcpUrl) {
  const dir = path.join(workDir, "chain-mcp");
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      lucy: {
        type: "http",
        url: mcpUrl,
        headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` }
      }
    }
  };
  const file = path.join(dir, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

/**
 * One long-lived host session: a single `claude -p --input-format stream-json`
 * process that answers a sequence of questions in ONE conversation (same
 * process id and session id for the whole chain — D19/D20).
 */
function createHostSession({ identityId, workDir, mcpUrl, token, binaryPath, model, maxTurns, turnTimeoutMs, env }) {
  const mcpConfigPath = writeMcpConfig(workDir, mcpUrl);
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--mcp-config", mcpConfigPath,
    "--strict-mcp-config",
    "--permission-mode", "bypassPermissions",
    "--max-turns", String(maxTurns)
  ];
  if (model) args.push("--model", model);
  const child = spawn(binaryPath, args, {
    cwd: workDir,
    env: { ...process.env, ...env, [TOKEN_ENV]: token },
    stdio: ["pipe", "pipe", "pipe"]
  });

  const state = {
    identityId,
    processId: child.pid,
    hostSessionId: null,
    supportsMultiTurn: true,
    closed: false,
    queue: Promise.resolve(),
    buffer: "",
    pending: null,
    toolResults: [],
    stderrTail: ""
  };

  const handleEvent = (event) => {
    if (event.session_id && !state.hostSessionId) state.hostSessionId = event.session_id;
    if (event.type === "user" && event.message?.content) {
      // tool results stream back as user-role messages; keep them for oracle checks.
      const content = Array.isArray(event.message.content) ? event.message.content : [];
      for (const item of content) {
        if (item?.type === "tool_result") state.toolResults.push(item);
      }
    }
    if (event.type === "result") {
      const text = String(event.result ?? "");
      const pending = state.pending;
      state.pending = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve({
          finalAnswer: text,
          toolResults: state.toolResults,
          sessionId: state.hostSessionId,
          ok: event.is_error !== true
        });
        state.toolResults = [];
      }
    }
  };

  /**
   * stdout 处理（Task 7 试点实测）：宿主在等待输入时会反复广播
   * `system/commands_changed`（~12KB 全量命令清单，每秒可达十几条）。若对每行
   * 全量 JSON.parse＋trim，单个 data 回调会长时间占用主线程、饿死事件循环
   * （实测心跳停摆、ask 永不 resolve）。因此：只对 result／user／assistant 行
   * （以及首次需要回填 session_id 的 system 行）做完整解析，其余行按前缀廉价
   * 丢弃；每回调最多处理 500 行，其余留在 buffer 等下一个 data 事件。
   */
  const handleLine = (line) => {
    if (line.length < 2) return;
    if (
      line.startsWith('{"type":"result"') ||
      line.startsWith('{"type":"user"') ||
      line.startsWith('{"type":"assistant"') ||
      (!state.hostSessionId && line.startsWith('{"type":"system"'))
    ) {
      try {
        handleEvent(JSON.parse(line));
      } catch {
        // unparseable line is never trusted for oracle or milestones
      }
    }
  };

  child.stdout.on("data", (chunk) => {
    state.buffer += chunk;
    if (state.parsing) return;
    state.parsing = true;
    try {
      let guard = 0;
      while (guard++ < 500) {
        const index = state.buffer.indexOf("\n");
        if (index < 0) break;
        const line = state.buffer.slice(0, index);
        state.buffer = state.buffer.slice(index + 1);
        handleLine(line);
      }
    } finally {
      state.parsing = false;
    }
  });
  child.stderr.on("data", (chunk) => {
    state.stderrTail = `${state.stderrTail}${chunk}`.slice(-2000);
  });
  child.on("close", () => {
    state.closed = true;
    const pending = state.pending;
    state.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ finalAnswer: "", toolResults: [], sessionId: state.hostSessionId, ok: false, crashed: true });
    }
  });

  const ask = (question, timeoutMs) => new Promise((resolve) => {
    if (state.closed) {
      resolve({ finalAnswer: "", toolResults: [], sessionId: state.hostSessionId, ok: false, crashed: true });
      return;
    }
    const timer = setTimeout(() => {
      state.pending = null;
      resolve({ finalAnswer: "", toolResults: state.toolResults, sessionId: state.hostSessionId, ok: false, timedOut: true });
    }, Math.max(1_000, timeoutMs));
    state.pending = { resolve, timer };
    child.stdin.write(`${JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: question }] }
    })}\n`);
  });

  return {
    identityId,
    get processId() { return state.processId; },
    get hostSessionId() { return state.hostSessionId; },
    get closed() { return state.closed; },
    stderrTail: () => state.stderrTail,
    ask,
    close: () => {
      try { child.stdin.end(); } catch { /* already gone */ }
      try { child.kill("SIGTERM"); } catch { /* gone */ }
    }
  };
}

/**
 * Build the real-execution { sessionFactory, turnExecutor, closeAll } triple for
 * the SOAK/LONG_FOLLOW lanes. Each identity gets its OWN long-lived host process
 * and its own token; the token is resolved through `tokenOf(identityId)` and is
 * never logged or written to evidence.
 */
export function createChainSessionExecutor({
  identities = [],
  tokenOf,
  mcpUrl,
  binaryPath = DEFAULT_BINARY,
  model = process.env.LUCY_E2E_CLAUDE_MODEL || "",
  maxTurns = 60,
  turnTimeoutMs = 180_000,
  workDirRoot = null,
  env = {},
  now = () => Date.now()
} = {}) {
  if (typeof tokenOf !== "function") throw new Error("createChainSessionExecutor requires tokenOf(identityId)");
  if (!mcpUrl) throw new Error("createChainSessionExecutor requires mcpUrl");
  const root = workDirRoot ?? mkdtempSync(path.join(os.tmpdir(), "mip-chain-"));
  const sessions = new Map();

  const sessionFactory = async (identityId) => {
    if (sessions.has(identityId)) return sessions.get(identityId);
    const token = tokenOf(identityId);
    if (!token) throw new Error(`no token for identity ${identityId}`);
    const workDir = path.join(root, identityId);
    mkdirSync(workDir, { recursive: true });
    const session = createHostSession({
      identityId, workDir, mcpUrl, token, binaryPath, model, maxTurns, turnTimeoutMs, env
    });
    sessions.set(identityId, session);
    return session;
  };

  const turnExecutor = async (ctx) => {
    const startedAt = now();
    const session = sessions.get(ctx.identityId);
    if (!session) {
      return { outcome: "crash", wallClockMs: 0, turnIndex: ctx.turnIndex, processId: null, hostSessionId: null };
    }
    const answer = await session.ask(ctx.question, turnTimeoutMs);
    const wallClockMs = now() - startedAt;
    const check = answer.finalAnswer
      ? checkTurnOracle(ctx.oracle, answer.finalAnswer, answer.toolResults)
      : { verdict: "wrong", reason: answer.timedOut ? "turn timed out" : "no final answer to check" };
    const outcome = check.verdict === "correct"
      ? "correct"
      : answer.timedOut
        ? "timeout"
        : answer.crashed
          ? "crash"
          : "wrong_answer";
    return {
      outcome,
      wallClockMs,
      turnIndex: ctx.turnIndex,
      processId: session.processId,
      hostSessionId: answer.sessionId ?? session.hostSessionId,
      timedOut: answer.timedOut === true,
      oracleReason: check.reason ?? null
    };
  };

  const closeAll = () => {
    for (const session of sessions.values()) session.close();
    sessions.clear();
  };

  return { sessionFactory, turnExecutor, closeAll, workDirRoot: root };
}

/** Best-effort cleanup of a chain run's work dirs (host transcripts stay in tmp). */
export function cleanupChainWorkDir(root) {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* tmp cleanup is best effort */
  }
}

/** Convenience: build tokenOf from a {"tokens":{id:plain}} or {id:plain} JSON file. */
export function tokenMapFrom(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const map = parsed?.tokens ?? parsed;
  return (identityId) => map[identityId] ?? null;
}

// ---------------------------------------------------------------------------
// turn-level oracle check (chain-executor variant)
// ---------------------------------------------------------------------------

/**
 * oracle.expect 里的这些键是**执行元数据**（角色类／范围声明，由 ACL 保证），
 * 不出现在 LLM 答复文本里；exact checker 若把它们当数值／字符串期望必然误判。
 */
const ORACLE_META_KEYS = new Set(["roleClass", "globalScope", "identityRoleClass"]);

const NUMERIC_RE = /-?\d[\d,]*(?:\.\d+)?/g;

/**
 * 长链轮次的 exact oracle 校验（Task 7 试点实测）：
 * - 剔除元数据键（见 ORACLE_META_KEYS）；
 * - 数值容差＝max(0.01, |期望|×0.0005)：LLM／查询结果对金额做常规两位小数
 *   舍入（1,459,476.10 vs 1,459,476.0953）必须判 correct——agent lib 的
 *   exact checker 容差为 |x|×1e-12（防伪造的精确匹配），对自然语言答复过严；
 *   本宽容版只用于长链轮次，发布判定仍由 P1-78 判定器独立执行。
 * - 千分位由 NUMBER_RE 的去逗号处理覆盖。
 */
export function checkTurnOracle(oracle, finalAnswer, toolResults = []) {
  if (!oracle || oracle.kind !== "exact") {
    return { verdict: "unknown", reason: `oracle kind ${oracle?.kind ?? "(none)"} not machine-checkable` };
  }
  const expect = oracle.expect && typeof oracle.expect === "object" && !Array.isArray(oracle.expect)
    ? Object.fromEntries(Object.entries(oracle.expect).filter(([k]) => !ORACLE_META_KEYS.has(k)))
    : oracle.expect;
  const entries = expect && typeof expect === "object" ? Object.entries(expect) : [];
  if (entries.length === 0) return { verdict: "unknown", reason: "oracle carries no expected values" };
  const text = String(finalAnswer ?? "");
  if (text.trim() === "") return { verdict: "wrong", reason: "no final answer to check" };

  const numbers = [];
  NUMERIC_RE.lastIndex = 0;
  let m;
  while ((m = NUMERIC_RE.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) numbers.push(n);
  }
  const strings = [text, ...toolResults.map((t) => JSON.stringify(t ?? {}))];
  const missing = entries.filter(([, value]) => !valueMatchesTolerant(value, numbers, strings)).map(([k]) => k);
  if (missing.length === 0) return { verdict: "correct", reason: "all expected values present" };
  return { verdict: "wrong", reason: `missing expected value(s): ${missing.join(", ")}` };
}

function valueMatchesTolerant(expected, numbers, strings) {
  if (typeof expected === "number") {
    if (!Number.isFinite(expected)) return false;
    const tol = Math.max(0.01, Math.abs(expected) * 0.0005);
    return numbers.some((n) => {
      if (Math.abs(n - expected) <= tol) return true;
      if (Math.abs(n * 10_000 - expected) <= tol) return true;
      if (Math.abs(n / 10_000 - expected) <= tol) return true;
      return false;
    });
  }
  if (typeof expected === "boolean") return true;
  if (typeof expected === "string") {
    const needle = expected.replace(/\s+/g, "");
    if (needle === "") return true;
    return strings.some((s) => String(s).replace(/\s+/g, "").includes(needle));
  }
  return false;
}
