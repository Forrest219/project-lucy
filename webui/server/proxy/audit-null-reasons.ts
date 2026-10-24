/**
 * Lucy v0.25 / L25-09 S01(d) — 空值原因（Null Reason）后端共享枚举.
 *
 * U2 已冻结为**单一六值枚举**，不分轴、不合并既有语义：
 *
 *   not_applicable  不适用
 *   not_collected   确认可采但未采
 *   redacted        按既有策略隐藏
 *   parse_failed    解析失败
 *   unknown         状态未知
 *   not_supported   确认该形态不支持
 *
 * 规则：
 *   - 新记录缺值必须带原因与证据来源，展示不得仅留空或填 0。
 *   - 历史空白默认 `unknown`（legacy_unverified），**不得**推定为 `not_collected`。
 *   - 该枚举是「后端共享」的唯一真源；前端 `ReadonlySqlRowset.tsx` 的局部枚举
 *     由 P0-4 接入本模块（前端文件本轮不改）。
 */

/** 六值枚举，按 Spec §15 U2 冻结顺序。 */
export const NULL_REASON_VALUES = [
  "not_applicable",
  "not_collected",
  "redacted",
  "parse_failed",
  "unknown",
  "not_supported"
] as const;

export type NullReason = (typeof NULL_REASON_VALUES)[number];

const NULL_REASON_SET: ReadonlySet<string> = new Set(NULL_REASON_VALUES);

export function isNullReason(value: unknown): value is NullReason {
  return typeof value === "string" && NULL_REASON_SET.has(value);
}

/**
 * 归一化任意来源的缺值原因。
 *
 * - 已是合法枚举 → 原样返回。
 * - `null` / `undefined` / 空串 / 非法字面量 → `unknown`。
 *
 * 历史行的空白**不得**被推定为 `not_collected`（Spec §4.3(d)）。
 */
export function normalizeNullReason(value: unknown): NullReason {
  return isNullReason(value) ? value : "unknown";
}

/**
 * 历史行（legacy / legacy_unverified）的缺值原因。
 * 永远返回 `unknown`；调用方另行标注 `legacy_unverified`，两者是不同维度。
 */
export function legacyNullReason(): NullReason {
  return "unknown";
}

/**
 * 依据「值是否存在」与「为何不存在」推导缺值原因。
 *
 * @param present  值是否真实存在（不是空串、不是 undefined）。
 * @param reason   调用方给出的原因；非法值归一为 `unknown`。
 */
export function nullReasonFor(present: boolean, reason?: unknown): NullReason {
  if (present) return "not_applicable";
  return normalizeNullReason(reason);
}

/** 用户可见标签（服务端共享，供后端错误文案与后续前端 import 使用）。 */
export const NULL_REASON_LABELS: Record<NullReason, string> = {
  not_applicable: "不适用",
  not_collected: "未采集",
  redacted: "已脱敏",
  parse_failed: "解析失败",
  unknown: "未知",
  not_supported: "不支持"
};

/**
 * 带证据来源的缺值记录。Spec §4.3(d)：「新记录缺值须带原因与证据来源」。
 */
export type NullValue<T> = {
  value: T | null;
  reason: NullReason;
  /** 证据来源标识（如 `permission_snapshot` / `call_args` / `ledger`）。 */
  evidenceSource: string;
};

export function nullValue<T>(
  value: T | null | undefined,
  reason: NullReason,
  evidenceSource: string
): NullValue<T> {
  return {
    value: value === undefined ? null : value,
    reason,
    evidenceSource
  };
}
