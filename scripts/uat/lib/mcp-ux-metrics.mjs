/**
 * P1-37 观测指标 M1–M6 取数口径（Spec §5）。输入是 `access_log` 行（对象数组）与可选的
 * `access_trace_span` 行；纯函数，便于对着已知值核对。口径：
 *
 *  M1 握手延迟：tool='initialize' 行的 duration_ms 的 P50/P99、> 30 s 次数；另给按日、按 15 分钟窗的条数与 P99。
 *  M2 拒绝延迟：被拒请求＝ outcome='denied'，或 error_category='client_schema_failure'（代理侧入参拒绝）；P95/P99。
 *  M3 原样重试率：只看带 rejection_fingerprint 的被拒行；同（身份、会话、工具、指纹、拒绝理由），
 *     与同组前一行相隔 ≤ 60 s 即计为一次「原样重试」；分子＝重试次数，分母＝带指纹的被拒总数。
 *     **只比较同一版本前缀（rf1:…）内的指纹**；不使用 args_summary／query_hash。
 *  M4 未知工具名次数：decision_reason 以 'tool_unclassified:' 开头的行数（并按日）。
 *  M5 会话类失败：decision_reason 以 'session_lost' 开头＝失败；含 'upstream_session_recovered'＝恢复成功；
 *     失败率＝失败 ÷ 总调用；恢复成功率＝恢复 ÷（恢复＋失败）；同会话最大连续失败数。
 *  M6 入参错误占比：error_category='client_schema_failure' ÷ 总调用；另报仍被记为 upstream_failed 且
 *     decision_reason 以 'invalid_arguments' 开头的条数（应为 0）。
 *  总调用＝ tool 不在 initialize／notifications/initialized／tools/list／ping 的行。
 */
const PROTOCOL_TOOLS = new Set(["initialize", "notifications/initialized", "tools/list", "ping"]);
const REPEAT_WINDOW_MS = 60_000;

export function percentile(samples, p) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10;
}

const reasonOf = (row) => String(row.decision_reason ?? "");
const tsMs = (row) => Date.parse(row.ts);
const day = (row) => String(row.ts).slice(0, 10);
const window15 = (row) => {
  const ms = tsMs(row);
  return new Date(Math.floor(ms / 900_000) * 900_000).toISOString();
};

function byKey(rows, keyFn, valueFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), valueFn(row)]);
  }
  return groups;
}

export function computeMetrics(rows) {
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  const toolCalls = ordered.filter((row) => !PROTOCOL_TOOLS.has(row.tool));

  const init = ordered.filter((row) => row.tool === "initialize");
  const initMs = init.map((row) => row.duration_ms);
  const M1 = {
    n: init.length, p50: percentile(initMs, 50), p99: percentile(initMs, 99), over30s: initMs.filter((ms) => ms > 30_000).length,
    byDay: Object.fromEntries([...byKey(init, day, (r) => r.duration_ms)].map(([k, v]) => [k, { n: v.length, p99: percentile(v, 99) }])),
    by15min: Object.fromEntries([...byKey(init, window15, (r) => r.duration_ms)].map(([k, v]) => [k, { n: v.length, p99: percentile(v, 99) }]))
  };

  const rejected = ordered.filter((row) => row.outcome === "denied" || row.error_category === "client_schema_failure");
  const rejMs = rejected.map((row) => row.duration_ms);
  const M2 = { n: rejected.length, p95: percentile(rejMs, 95), p99: percentile(rejMs, 99) };

  const withFp = rejected.filter((row) => row.rejection_fingerprint);
  const lastSeen = new Map();
  let repeated = 0;
  for (const row of withFp) {
    const version = String(row.rejection_fingerprint).split(":")[0];
    const key = JSON.stringify([version, row.user_id, row.lucy_session_id ?? "default", row.tool, row.rejection_fingerprint, reasonOf(row)]);
    const previous = lastSeen.get(key);
    if (previous !== undefined && tsMs(row) - previous <= REPEAT_WINDOW_MS) repeated += 1;
    lastSeen.set(key, tsMs(row));
  }
  const M3 = { rejected: withFp.length, repeated, rate: withFp.length === 0 ? null : Math.round((repeated / withFp.length) * 1000) / 1000 };

  const unknown = ordered.filter((row) => reasonOf(row).startsWith("tool_unclassified:"));
  const M4 = { count: unknown.length, byDay: Object.fromEntries([...byKey(unknown, day, () => 1)].map(([k, v]) => [k, v.length])) };

  const lost = ordered.filter((row) => reasonOf(row).startsWith("session_lost"));
  const recovered = ordered.filter((row) => reasonOf(row).includes("upstream_session_recovered"));
  let maxConsecutive = 0;
  const run = new Map();
  for (const row of toolCalls) {
    const key = row.lucy_session_id ?? "default";
    if (reasonOf(row).startsWith("session_lost")) {
      run.set(key, (run.get(key) ?? 0) + 1);
      maxConsecutive = Math.max(maxConsecutive, run.get(key));
    } else run.set(key, 0);
  }
  const M5 = {
    sessionLost: lost.length,
    recovered: recovered.length,
    failureRate: toolCalls.length === 0 ? null : Math.round((lost.length / toolCalls.length) * 1000) / 1000,
    recoveryRate: lost.length + recovered.length === 0 ? null : Math.round((recovered.length / (lost.length + recovered.length)) * 1000) / 1000,
    maxConsecutiveFailures: maxConsecutive
  };

  const schemaFail = toolCalls.filter((row) => row.error_category === "client_schema_failure");
  const M6 = {
    clientSchemaFailure: schemaFail.length,
    totalCalls: toolCalls.length,
    ratio: toolCalls.length === 0 ? null : Math.round((schemaFail.length / toolCalls.length) * 1000) / 1000,
    invalidArgsStillUpstreamFailed: toolCalls.filter((row) => reasonOf(row).startsWith("invalid_arguments") && row.error_category === "upstream_failed").length
  };

  return { M1, M2, M3, M4, M5, M6 };
}
