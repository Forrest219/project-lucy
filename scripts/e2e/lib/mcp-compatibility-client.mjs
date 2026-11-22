/**
 * P1-53 Task 2 — MCP client helpers for deterministic PRE / control samples.
 *
 * Network is behind injectable `fetchImpl` so unit tests stay offline.
 * Does not apply CompatConfigProfile (A1) or judge three-axis (A3).
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 2
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const MCP_ACCEPT = "application/json, text/event-stream";

/**
 * P1-74 / Task 4 —— attempt.reason 分列（SC-E5／E5b）。
 *
 * `question_budget_exhausted` ⇒ `budget_exhausted`（预算终止，**不是** ACL deny）；
 * `question_budget_concurrency_exceeded`／`question_budget_unavailable` 与之**分列**
 * （后者归平台／存储错误）；逃生声明被拒是用法维度。除本表外的原因（含一切
 * ACL reason）原样返回，由调用方按 ACL 路径处理 —— expected deny 反例不得因
 * 见到 budget 字样而假绿。
 *
 * @param {string|null|undefined} reason
 * @returns {string} 分列后的归因类别
 */
export function classifyAttemptReason(reason) {
  switch (reason) {
    case "question_budget_exhausted":
      return "budget_exhausted";
    case "question_budget_concurrency_exceeded":
      return "budget_concurrency_exceeded";
    case "question_budget_unavailable":
      return "budget_unavailable";
    case "pending_exists":
    case "no_credit":
    case "not_exhausted":
    case "not_hard_stopped":
    case "use_begin_question":
    case "mismatch":
    case "invalid_arguments":
      return "budget_escape_rejected";
    default:
      return reason ? "other" : "none";
  }
}

/** 预算类归因（不含用法维度）——用于「expected deny 不得被 budget 假绿」。 */
export function isBudgetDenyClass(denyClass) {
  return (
    denyClass === "budget_exhausted"
    || denyClass === "budget_concurrency_exceeded"
    || denyClass === "budget_unavailable"
  );
}

/**
 * Resolve `env:VAR` / bare env name / absolute file path token refs.
 * @param {string|null|undefined} tokenRef
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ readFileSync?: typeof readFileSync, existsSync?: typeof existsSync }} [fsDeps]
 * @returns {{ ok: true, token: string, source: string } | { ok: false, reason: string, tokenRef: string }}
 */
export function resolveTokenRef(tokenRef, env = process.env, fsDeps = {}) {
  const read = fsDeps.readFileSync ?? readFileSync;
  const exists = fsDeps.existsSync ?? existsSync;
  if (tokenRef == null || String(tokenRef).trim() === "") {
    return { ok: false, reason: "TOKEN_REF_MISSING", tokenRef: String(tokenRef ?? "") };
  }
  const raw = String(tokenRef).trim();
  if (raw.startsWith("env:")) {
    const name = raw.slice(4);
    const value = env[name];
    if (!value || !String(value).trim()) {
      return { ok: false, reason: "TOKEN_MISSING", tokenRef: raw };
    }
    return { ok: true, token: String(value).trim(), source: `env:${name}` };
  }
  if (raw.includes("/") || raw.startsWith(".")) {
    const file = path.isAbsolute(raw) ? raw : path.resolve(raw);
    if (!exists(file)) {
      return { ok: false, reason: "TOKEN_FILE_MISSING", tokenRef: raw };
    }
    const token = String(read(file, "utf8")).trim();
    if (!token) {
      return { ok: false, reason: "TOKEN_FILE_EMPTY", tokenRef: raw };
    }
    return { ok: true, token, source: `file:${file}` };
  }
  const fromEnv = env[raw];
  if (!fromEnv || !String(fromEnv).trim()) {
    return { ok: false, reason: "TOKEN_MISSING", tokenRef: raw };
  }
  return { ok: true, token: String(fromEnv).trim(), source: `env:${raw}` };
}

/**
 * @param {string} token
 * @returns {string} sha256:<hex> — never the plaintext
 */
export function tokenFingerprint(token) {
  return `sha256:${createHash("sha256").update(String(token ?? "")).digest("hex")}`;
}

/**
 * Build JSON-RPC body.
 * @param {number|string} id
 * @param {string} method
 * @param {object} [params]
 */
export function rpc(id, method, params) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

/**
 * Parse MCP tools/call envelope. Detects empty envelope and isError.
 * @param {{ status?: number, json?: object, text?: string }} res
 */
export function parseMcpToolResult(res) {
  if (!res || typeof res !== "object") {
    return { ok: false, reason: "empty_envelope", message: "", envelopeEmpty: true, isError: false };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: `http_${res.status}`,
      message: res.json?.error?.message ?? "",
      envelopeEmpty: false,
      isError: true
    };
  }
  if (res.json?.error) {
    return {
      ok: false,
      reason: String(res.json.error.code ?? "jsonrpc_error"),
      message: String(res.json.error.message ?? ""),
      envelopeEmpty: false,
      isError: true
    };
  }
  const result = res.json?.result;
  if (result == null) {
    return { ok: false, reason: "empty_envelope", message: "", envelopeEmpty: true, isError: false };
  }
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    return { ok: false, reason: "empty_content", message: "", envelopeEmpty: true, isError: false };
  }
  const first = content[0];
  const isError = result.isError === true;
  let parsed = null;
  if (first?.type === "text" && typeof first.text === "string") {
    try {
      parsed = JSON.parse(first.text);
    } catch {
      parsed = first.text;
    }
  } else {
    parsed = first ?? null;
  }
  if (isError) {
    return {
      ok: false,
      reason: "tool_is_error",
      message: typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {}),
      envelopeEmpty: false,
      isError: true,
      parsed
    };
  }
  // Budget exhausted is a soft envelope (often without result.isError) but not a successful fact row.
  if (parsed && typeof parsed === "object" && parsed.reason === "question_budget_exhausted") {
    return {
      ok: false,
      reason: "question_budget_exhausted",
      message: JSON.stringify(parsed),
      envelopeEmpty: false,
      isError: true,
      parsed
    };
  }
  return { ok: true, reason: null, message: "", envelopeEmpty: false, isError: false, parsed };
}

/**
 * Create an MCP HTTP client. All network goes through `fetchImpl`.
 *
 * @param {{
 *   baseUrl: string,
 *   token: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} options
 */
export function createMcpClient(options) {
  const baseUrl = String(options?.baseUrl ?? "").replace(/\/$/, "");
  const token = options?.token;
  if (!baseUrl) throw new Error("createMcpClient requires baseUrl");
  if (!token) throw new Error("createMcpClient requires token");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("createMcpClient requires fetchImpl (injectable for tests)");
  }
  const now = options.now ?? (() => Date.now());
  let rpcId = 1;
  let turnId = null;
  // P1-74 / Task 4b：initialize 返回的 mcp-session-id（客户端支持时随请求发送）。
  let mcpSessionId = null;

  async function request(body, { headers = {} } = {}) {
    const started = now();
    const res = await fetchImpl(baseUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: MCP_ACCEPT,
        "content-type": "application/json",
        ...(turnId ? { "x-lucy-turn-id": turnId } : {}),
        // P1-74 / Task 4b：initialize 拿到 session 后随请求发送（客户端支持时）。
        ...(mcpSessionId ? { "mcp-session-id": mcpSessionId } : {}),
        ...headers
      },
      body: JSON.stringify(body)
    });
    const ended = now();
    const text = typeof res.text === "function" ? await res.text() : String(res.body ?? "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const resHeaders = res.headers ?? null;
    return {
      status: res.status ?? 0,
      text,
      json,
      headers: resHeaders
        ? Object.fromEntries(
            [...resHeaders.entries()].map(([key, value]) => [key.toLowerCase(), value])
          )
        : {},
      mcpClientRttMs: ended - started,
      requestId: randomUUID()
    };
  }

  return {
    get tokenFingerprint() {
      return tokenFingerprint(token);
    },
    get turnId() {
      return turnId;
    },
    get sessionId() {
      return mcpSessionId;
    },
    /** 丢弃已记录的 turn（begin 失败／新问询开始），后续调用不再带陈旧 x-lucy-turn-id。 */
    clearTurn() {
      turnId = null;
    },
    /**
     * P1-74 / Task 4b：initialize 并保存 mcp-session-id（上游支持时）。
     * 显式无 session 对照 = 不调用本方法。
     */
    async initialize() {
      const res = await request(
        rpc(rpcId++, "initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "lucy-mcp-compat", version: "1.0.0" }
        })
      );
      const fromHeader = res.headers?.["mcp-session-id"];
      const fromBody = res.json?.result?.sessionId ?? res.json?.result?.session_id;
      const sessionId = fromHeader ?? (typeof fromBody === "string" && fromBody ? fromBody : null);
      if (sessionId) mcpSessionId = String(sessionId);
      return { ...res, sessionId: mcpSessionId };
    },
    async beginQuestion({ question, intentSummary } = {}) {
      const summary =
        (typeof intentSummary === "string" && intentSummary.trim()) ||
        (typeof question === "string" && question.trim()) ||
        "mcp-compat control";
      const res = await request(
        rpc(rpcId++, "tools/call", {
          name: "lucy_begin_question",
          arguments: {
            ...(typeof question === "string" ? { question } : {}),
            intentSummary: String(summary).slice(0, 500)
          }
        })
      );
      const parsed = parseMcpToolResult(res);
      // P1-74 / Task 4b：begin 失败不得携带陈旧 turn —— 只有成功才采纳新 turnId。
      if (!parsed.ok) {
        turnId = null;
        return { ...res, parsed, turnId };
      }
      const fromMeta = res.json?.result?._meta?.lucy?.turnId;
      const fromParsed =
        parsed.parsed && typeof parsed.parsed === "object"
          ? parsed.parsed.turnId ?? parsed.parsed.turn_id
          : null;
      turnId = fromMeta ?? fromParsed ?? turnId;
      return { ...res, parsed, turnId };
    },
    async continueQuestion({ token, mode } = {}) {
      return this.toolsCall("lucy_continue_question", {
        ...(typeof token === "string" ? { token } : {}),
        ...(mode === "new_question" ? { mode: "new_question" } : {})
      });
    },
    async toolsCall(name, args = {}) {
      const res = await request(rpc(rpcId++, "tools/call", { name, arguments: args }));
      const parsed = parseMcpToolResult(res);
      return { ...res, parsed };
    },
    async lucyQuery(args) {
      return this.toolsCall("lucy_query", args);
    },
    async lucyFreshness(args) {
      return this.toolsCall("lucy_freshness", args);
    },
    async toolsList() {
      return request(rpc(rpcId++, "tools/list"));
    }
  };
}

/**
 * P1-74 / Task 4b —— 从停机 attempt 的解析载荷取逃生指示。
 * @param {{ parsed?: object }} parseResult parseMcpToolResult 的结果
 */
function budgetStopHint(parseResult) {
  const payload = parseResult?.parsed;
  if (!payload || typeof payload !== "object") return null;
  if (payload.reason !== "question_budget_exhausted") return null;
  return {
    continuable: payload.continuable === true,
    continueToken: typeof payload.continueToken === "string" ? payload.continueToken : null,
    nextStep: payload.next_step && typeof payload.next_step === "object" ? payload.next_step : null
  };
}

/**
 * Run one mcpControls entry (begin + query/freshness) and retain every attempt.
 *
 * P1-74 / Task 4b（`budgetEscape`）：
 * - `session: "auto"` 时先 initialize 并复用 mcp-session-id；缺省不发送 session（显式无 session 对照）；
 * - 先读 tools/list：begin 不可见直接走 N（不制造预期外 begin 错误）；
 * - 触顶且 `continuable=true`：continue（默认 mode）＋重试数据工具；
 * - inactive 硬停且 next_step 指向 new_question：mode=new_question＋重试；active 硬停走 begin；
 * - 每轮重试须真实成交（parsed.ok）才停止；有界轮数防 runaway。
 *
 * @param {{
 *   client: ReturnType<typeof createMcpClient>,
 *   control: object,
 *   identityId?: string,
 *   caseId?: string,
 *   budgetEscape?: { session?: "auto", maxRounds?: number },
 * }} args
 */
export async function runMcpControl({ client, control, identityId, caseId, budgetEscape }) {
  const attempts = [];
  const escapeCfg = budgetEscape && typeof budgetEscape === "object" ? budgetEscape : null;
  const maxRounds = Math.max(1, Number(escapeCfg?.maxRounds ?? 8));

  if (escapeCfg?.session === "auto" && typeof client.initialize === "function") {
    await client.initialize();
  }

  // begin 可见性预检：不可见走 N（skip），不制造预期外 begin 错误。
  let beginVisible = true;
  if (escapeCfg && typeof client.toolsList === "function") {
    const listRes = await client.toolsList();
    const listPayload = listRes?.json?.result?.tools;
    if (Array.isArray(listPayload)) {
      beginVisible = listPayload.some((tool) => tool && tool.name === "lucy_begin_question");
    }
  }

  const beginArg = control?.begin;
  const beginPayload =
    typeof beginArg === "string"
      ? { question: beginArg, intentSummary: beginArg }
      : beginArg && typeof beginArg === "object"
        ? beginArg
        : { intentSummary: `${caseId ?? "case"}:${identityId ?? "id"}` };

  let beginRes;
  if (!beginVisible) {
    // N 路径：begin 不在 tools/list ⇒ 不调用（P1-60 实况），不留陈旧 turn。
    if (typeof client.clearTurn === "function") client.clearTurn();
    beginRes = {
      requestId: null,
      mcpClientRttMs: null,
      parsed: { ok: true, reason: "begin_not_visible", isError: false, envelopeEmpty: false }
    };
    attempts.push({
      kind: "lucy_begin_question",
      caseId,
      identityId,
      requestId: null,
      mcpClientRttMs: null,
      ok: true,
      reason: "begin_not_visible",
      isError: false,
      envelopeEmpty: false,
      skipped: true
    });
  } else {
    beginRes = await client.beginQuestion(beginPayload);
    attempts.push({
      kind: "lucy_begin_question",
      caseId,
      identityId,
      requestId: beginRes.requestId,
      mcpClientRttMs: beginRes.mcpClientRttMs,
      ok: beginRes.parsed.ok,
      reason: beginRes.parsed.reason,
      denyClass: beginRes.parsed.ok ? null : classifyAttemptReason(beginRes.parsed.reason),
      isError: beginRes.parsed.isError,
      envelopeEmpty: beginRes.parsed.envelopeEmpty
    });
  }

  const toolName = control?.tool === "lucy_freshness" ? "lucy_freshness" : "lucy_query";
  const runDataTool = () => toolName === "lucy_freshness"
    ? client.lucyFreshness(control.freshness ?? control.query ?? {})
    : client.lucyQuery(control.query ?? {});

  const pushDataAttempt = (res, extra = {}) => {
    attempts.push({
      kind: toolName,
      caseId,
      identityId,
      requestId: res.requestId,
      mcpClientRttMs: res.mcpClientRttMs,
      ok: res.parsed.ok,
      reason: res.parsed.reason,
      denyClass: res.parsed.ok ? null : classifyAttemptReason(res.parsed.reason),
      isError: res.parsed.isError,
      envelopeEmpty: res.parsed.envelopeEmpty,
      ...extra
    });
  };

  let toolRes;
  const query = control.query ?? {};
  // Dual-connection steps: run sequentially; each attempt retained.
  if (toolName === "lucy_query" && Array.isArray(query.steps)) {
    const stepResults = [];
    for (const step of query.steps) {
      const stepRes = await client.lucyQuery(step);
      pushDataAttempt(stepRes, { stepConnectionId: step.connectionId ?? null });
      stepResults.push(stepRes);
    }
    return { attempts, beginRes, toolRes: stepResults, toolName };
  }
  toolRes = await runDataTool();
  pushDataAttempt(toolRes);

  // P1-74 / Task 4b：预算逃生链（触顶 → 合同内动作 → 重试，直到真实成交或无可达动作）。
  if (escapeCfg) {
    let hint = budgetStopHint(toolRes.parsed);
    let rounds = 0;
    while (hint && rounds < maxRounds) {
      rounds += 1;
      let escapeRes = null;
      let escapeKind = "lucy_continue_question";
      if (hint.continuable && hint.continueToken) {
        escapeRes = await client.continueQuestion({ token: hint.continueToken });
      } else if (hint.nextStep?.action === "lucy_continue_question" && hint.nextStep?.mode === "new_question" && hint.continueToken) {
        escapeRes = await client.continueQuestion({ token: hint.continueToken, mode: "new_question" });
      } else if (hint.nextStep?.action === "lucy_begin_question") {
        escapeKind = "lucy_begin_question";
        escapeRes = await client.beginQuestion({
          intentSummary: `${caseId ?? "case"}:${identityId ?? "id"}:budget-reopen`
        });
      } else {
        break; // hard_budget_stop／ops_clear_scope：无用户主路径动作
      }
      attempts.push({
        kind: escapeKind,
        caseId,
        identityId,
        requestId: escapeRes.requestId,
        mcpClientRttMs: escapeRes.mcpClientRttMs,
        ok: escapeRes.parsed.ok,
        reason: escapeRes.parsed.reason,
        denyClass: escapeRes.parsed.ok ? null : classifyAttemptReason(escapeRes.parsed.reason),
        isError: escapeRes.parsed.isError,
        envelopeEmpty: escapeRes.parsed.envelopeEmpty,
        escapeRound: rounds
      });
      if (!escapeRes.parsed.ok) break;
      const retry = await runDataTool();
      pushDataAttempt(retry, { escapeRound: rounds });
      toolRes = retry;
      if (retry.parsed.ok) break;
      hint = budgetStopHint(retry.parsed);
    }
  }

  return { attempts, beginRes, toolRes, toolName };
}

/**
 * Map a control result + identity expect → functional case row for threeAxis.
 *
 * P1-74 / Task 4：归因分列 —— 观测 deny 按 attempt.reason 归类
 * （`budget_exhausted`／`budget_concurrency_exceeded`／`budget_unavailable`／
 * `acl_deny`／…），预算终止不得记成 `new deny`；逃生链恢复后，早期预算停机
 * 不再把该案判 deny（以**最后一个裁决性数据工具 attempt** 为准）。
 * @param {{ identity: object, controlResult: object, caseId: string }} args
 */
export function functionalCaseFromControl({ identity, controlResult, caseId }) {
  const expect = identity?.expect ?? {};
  const expectedOutcome = expect.outcome ?? "allow";
  const attempts = controlResult?.attempts ?? [];
  // Begin may return isError for begin_not_available ("可直接按现有权限查询") while the
  // subsequent lucy_query/lucy_freshness succeeds — that is not a data-plane deny.
  const toolAttempts = attempts.filter((a) => a.kind !== "lucy_begin_question");
  // 裁决性 attempt = 最后一个成功或失败的数据工具调用（逃生链恢复后早期失败不计）。
  const decisive = [...toolAttempts].reverse().find(
    (a) => a.ok === true || a.isError === true || a.envelopeEmpty === true
  );
  const envelopeEmpty = decisive ? decisive.envelopeEmpty === true : false;
  const isError = decisive ? decisive.isError === true : false;
  let observedOutcome = "allow";
  if (decisive && (decisive.envelopeEmpty || decisive.isError || decisive.ok === false)) {
    observedOutcome = "deny";
  }
  // 观测 deny 的归因：优先取裁决性失败 attempt，其次任意预算类 attempt。
  const decisiveFail = decisive && decisive.ok !== true ? decisive : null;
  const budgetFail = toolAttempts.find(
    (a) => a.ok !== true && classifyAttemptReason(a.reason) !== "other" && classifyAttemptReason(a.reason) !== "none"
  );
  const observedDenyClass = decisiveFail
    ? classifyAttemptReason(decisiveFail.reason)
    : observedOutcome === "deny" && budgetFail
      ? classifyAttemptReason(budgetFail.reason)
      : null;
  const parsed =
    Array.isArray(controlResult?.toolRes)
      ? controlResult.toolRes[0]?.parsed?.parsed
      : controlResult?.toolRes?.parsed?.parsed;
  const rows = Array.isArray(parsed?.rows)
    ? parsed.rows
    : Array.isArray(parsed?.data)
      ? parsed.data
      : null;
  const observedRowCount = rows ? rows.length : parsed?.rowCount ?? null;
  const observedMetrics = Array.isArray(parsed?.measures)
    ? parsed.measures
    : Array.isArray(controlResult?.toolRes?.query?.measures)
      ? controlResult.toolRes.query.measures
      : [];

  return {
    id: `${caseId}:${identity?.id ?? "identity"}`,
    caseId,
    identityId: identity?.id ?? null,
    expectedOutcome,
    observedOutcome,
    observedDenyClass,
    envelopeEmpty,
    isError,
    expectedNonempty: expectedOutcome === "allow" && expect.legalEmpty !== true,
    observedRowCount,
    observedMetrics,
    attempts: attempts.map((a) => ({
      kind: a.kind,
      requestId: a.requestId,
      mcpClientRttMs: a.mcpClientRttMs,
      ok: a.ok,
      reason: a.reason,
      denyClass: a.ok === true ? null : classifyAttemptReason(a.reason),
      isError: a.isError,
      envelopeEmpty: a.envelopeEmpty,
      ...(a.skipped ? { skipped: true } : {}),
      ...(typeof a.escapeRound === "number" ? { escapeRound: a.escapeRound } : {}),
      ...(a.stepConnectionId != null ? { stepConnectionId: a.stepConnectionId } : {})
    }))
  };
}

/**
 * Execute MCP controls for a suite (or subset). Retains every attempt.
 *
 * @param {{
 *   suite: object,
 *   tokensByRef: Record<string, string>,
 *   baseUrl: string,
 *   createClient?: typeof createMcpClient,
 *   fetchImpl?: typeof fetch,
 *   caseFilter?: (c: object) => boolean,
 *   sampleRepeats?: number,
 * }} args
 */
export async function runMcpSuiteControls({
  suite,
  tokensByRef,
  baseUrl,
  createClient = createMcpClient,
  fetchImpl,
  caseFilter,
  sampleRepeats = 1,
  budgetEscape = null
}) {
  const functionalCases = [];
  const attempts = [];
  const samplesMs = [];
  const problems = [];
  const cases = (suite?.cases ?? []).filter((c) => (caseFilter ? caseFilter(c) : true));

  for (const c of cases) {
    const controls = Array.isArray(c.mcpControls) ? c.mcpControls : [];
    const identities = Array.isArray(c.identities) ? c.identities : [];
    const identityById = new Map(identities.map((i) => [i.id, i]));

    for (const control of controls) {
      const identity = identityById.get(control.identity) ?? identities[0];
      if (!identity) {
        problems.push(`${c.id}: control missing identity`);
        continue;
      }
      const resolved = resolveTokenRef(identity.tokenRef, {
        ...process.env,
        ...Object.fromEntries(
          Object.entries(tokensByRef ?? {}).flatMap(([k, v]) => {
            const bare = k.startsWith("env:") ? k.slice(4) : k;
            return [
              [k, v],
              [bare, v],
              [`env:${bare}`, v]
            ];
          })
        )
      });
      if (!resolved.ok) {
        problems.push(`${c.id}:${identity.id}: ${resolved.reason}`);
        continue;
      }

      for (let r = 0; r < sampleRepeats; r += 1) {
        const client = createClient({
          baseUrl,
          token: resolved.token,
          fetchImpl
        });
        // P1-74 / Task 4b：CLI／套件级 budgetEscape 开启预算逃生链（session＋tools/list 预检＋continue/new_question）。
        const effectiveEscape = budgetEscape ?? control?.budgetEscape ?? suite?.budgetEscape ?? null;
        const controlResult = await runMcpControl({
          client,
          control,
          identityId: identity.id,
          caseId: c.id,
          ...(effectiveEscape ? { budgetEscape: effectiveEscape } : {})
        });
        attempts.push(...controlResult.attempts);
        for (const a of controlResult.attempts) {
          if (typeof a.mcpClientRttMs === "number") samplesMs.push(a.mcpClientRttMs);
        }
        functionalCases.push(
          functionalCaseFromControl({ identity, controlResult, caseId: c.id })
        );
      }
    }
  }

  return {
    functionalCases,
    attempts,
    samplesMs,
    problems,
    incomplete: problems.length > 0 || attempts.length === 0
  };
}
