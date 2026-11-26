/**
 * P1-84 公共首页与静态公开接口隔离 — runner 共享库（纯函数）。
 * 合同：docs/specs/lucy-20261124-public-entry-static-isolation-spec.md（v1.0）
 * 用例：docs/qa/uat/suites/public-entry-static/cases.md（R0／01–08）
 *
 * 判定只读回执（JSONL 账本），不接触 Docker／网络／凭据。
 * 预算＝客户端发送 → 首字节／完整响应（Spec §3.2，OQ-1 冻结）：
 *   GET /                 TTFB ≤ 2000 ms；文档完整 ≤ 5000 ms
 *   首屏静态资产（单资源）  ≤ 3000 ms
 *   GET /api/branding     ≤ 1000 ms
 *   GET /api/branding/logo ≤ 2000 ms
 *   GET /api/auth/status  ≤ 1000 ms
 *   POST /api/auth/login（合法凭据＋健康存储）≤ 3000 ms
 * 判定口径（Spec §3.2 冻结）：逐样本无超时、无 0-byte、状态符合期望；
 *   P99 ≤ 预算；max ≤ 2 × 预算。「有界拒绝」＝ ≤ 10 s 内带可读 code 的结构化 4xx／5xx。
 * 事件循环延迟（最终臂）：p99 ≤ 400 ms、max ≤ 800 ms（Spec §3.1.1）。
 */

export const LEDGER_SCHEMA = "pes-ledger/1";

/** OQ-1 冻结预算（毫秒）。ttfb／complete 双阈值只对 `GET /` 生效，其余只看 complete。 */
export const BUDGETS_MS = Object.freeze({
  "/": { ttfb: 2000, complete: 5000 },
  asset: { complete: 3000 },
  "/api/branding": { complete: 1000 },
  "/api/branding/logo": { complete: 2000 },
  "/api/auth/status": { complete: 1000 },
  "/api/auth/login": { complete: 3000 }
});

/** 有界拒绝上限（毫秒）：客户端在该时限内收到带可读 code 的结构化 4xx／5xx。 */
export const BOUNDED_REJECT_MS = 10_000;

/** 最终臂事件循环延迟上限（毫秒，Spec §3.1.1 冻结）。 */
export const EVENT_LOOP_LIMITS = Object.freeze({ p99: 400, max: 800 });

/** 同步片段上限（毫秒，Spec §3.1.1 冻结；沿用 yield-slices 口径）。 */
export const SYNC_SLICE_LIMIT_MS = 250;

/**
 * 把一组样本归纳为 per-path 统计。样本字段（pes-ledger/1）：
 *   ts, path, method, status, ttfbMs, totalMs, bytes, error, kind, label
 * 判定：
 *   - 超时（error 含 timeout／aborted）或 bytes === 0（0-byte）或状态非期望 → 样本级 FAIL；
 *   - P99 ≤ complete 预算且 max ≤ 2 × complete 预算 → 预算级 PASS。
 */
export function summarizeSamples(samples) {
  const byPath = new Map();
  for (const s of samples) {
    if (!s || typeof s.path !== "string") continue;
    const key = s.kind === "asset" ? "asset" : `${s.method ?? "GET"} ${s.path}`;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(s);
  }
  const out = [];
  for (const [key, rows] of byPath) {
    const pathOnly = key.startsWith("POST /api/auth/login") ? "/api/auth/login" : key.split(" ")[1];
    const budget = key === "asset" ? BUDGETS_MS.asset : BUDGETS_MS[pathOnly] ?? null;
    const totals = rows.map((r) => r.totalMs).filter((v) => typeof v === "number" && Number.isFinite(v));
    const sorted = [...totals].sort((a, b) => a - b);
    const p = (q) => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]);
    const timeouts = rows.filter((r) => /timeout|aborted|ECONNRESET|socket/i.test(String(r.error ?? "")));
    const zeroByte = rows.filter((r) => (r.bytes ?? 0) === 0 && r.error == null);
    const badStatus = rows.filter((r) => r.expectedStatus != null && r.status !== r.expectedStatus);
    let verdict;
    if (!budget) {
      verdict = { ok: true, reason: "no-frozen-budget(probe-only)" };
    } else {
      const p99 = p(0.99);
      const max = sorted.length ? sorted[sorted.length - 1] : null;
      const overBudget = p99 != null && p99 > budget.complete;
      const overMax = max != null && max > 2 * budget.complete;
      const sampleFails = timeouts.length + zeroByte.length + badStatus.length;
      verdict = {
        ok: !overBudget && !overMax && sampleFails === 0,
        n: rows.length,
        p50: p(0.5),
        p95: p(0.95),
        p99,
        max,
        budgetMs: budget.complete,
        maxLimitMs: 2 * budget.complete,
        overBudget,
        overMax,
        timeouts: timeouts.length,
        zeroByte: zeroByte.length,
        badStatus: badStatus.length
      };
    }
    out.push({ key, ...verdict });
  }
  return out;
}

/**
 * 主路径两臂判定（UAT-PES-06／06b，Spec SC-06／06b）。
 * 每臂回执：{ arm, success: boolean, boundedReject: { ok, ms, code } | null, timeoutOrHang: boolean }
 * 规则：至少一臂成功成交；另一臂必须成功或有界拒绝（≤10s 结构化 4xx/5xx）；
 * 任一臂超时／0-byte／无限挂起 → FAIL（无论首臂是否成功）；两臂皆仅拒绝 → FAIL。
 */
export function judgeMainPathArms(arms) {
  const fail = (reason) => ({ ok: false, reason, needsRetryAfterStop: false });
  if (!Array.isArray(arms) || arms.length !== 2) return fail("需要 MCP 与管理只读两臂回执");
  const successes = arms.filter((a) => a.success);
  if (successes.length === 0) return fail("两臂皆未成功成交（仅拒绝）");
  for (const arm of arms) {
    if (arm.success) continue;
    if (arm.timeoutOrHang) return fail(`臂 ${arm.arm} 超时／0-byte／无限挂起`);
    if (!arm.boundedReject?.ok) return fail(`臂 ${arm.arm} 未成功且无有界拒绝回执`);
  }
  const needsRetryAfterStop = successes.length < arms.length;
  return { ok: true, reason: needsRetryAfterStop ? "一臂成功＋另一臂有界拒绝（06b 触发）" : "两臂均成功成交", needsRetryAfterStop };
}

/**
 * 事件循环快照判定（最终臂，Spec §3.1.1）。快照来自 /api/health data.eventLoop。
 * 任一快照 p99 > 400 或 max > 800 → FAIL。
 */
export function judgeEventLoop(snapshots) {
  const bad = snapshots.filter((s) => s.p99Ms > EVENT_LOOP_LIMITS.p99 || s.maxMs > EVENT_LOOP_LIMITS.max);
  return {
    ok: bad.length === 0,
    limit: EVENT_LOOP_LIMITS,
    worstP99: snapshots.reduce((m, s) => Math.max(m, s.p99Ms ?? 0), 0),
    worstMax: snapshots.reduce((m, s) => Math.max(m, s.maxMs ?? 0), 0),
    violations: bad.length
  };
}

/** PES ledger JSONL 一行的构造器（探测侧共用，保证字段命名一致）。 */
export function ledgerLine(entry) {
  return JSON.stringify({ schema: LEDGER_SCHEMA, ts: Date.now(), ...entry });
}

/** percentile（就近上取整口径，与 summarizeSamples 内部一致）。 */
export function percentile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const sorted = [...sortedValues].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}
