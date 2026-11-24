/**
 * P0-1 问题类型口径绑定 —— 规范化与触发词校验（O2 §4.2②／§4.2④）。
 *
 * **唯一**规范化函数（Normative）：
 *
 * ```ts
 * N(s) = s.normalize("NFKC")
 *         .toLowerCase()
 *         .replace(/\p{White_Space}+/gu, " ")
 *         .trim()
 * ```
 *
 * 大小写转换**固定**采用 ECMAScript `String.prototype.toLowerCase()`；**不**采用
 * Unicode full casefold（`Straße` ≠ `STRASSE`），**不**采用 locale-sensitive 转换。
 * 保留内部标点；不做简繁转换、同义词、停用词删除或否定识别。
 */

const ALNUM_CODE_POINT = /[\p{L}\p{N}]/u;

/**
 * O2 §4.2② —— 规范化字面子串匹配的唯一规范化函数。
 */
export function normalizeCaliberText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\p{White_Space}+/gu, " ")
    .trim();
}

/** Unicode 字母或数字码点个数（按码点计；空白／标点不计长度）。 */
export function countAlnumCodePoints(value: string): number {
  let count = 0;
  for (const ch of value) {
    if (ALNUM_CODE_POINT.test(ch)) count += 1;
  }
  return count;
}

export const MIN_TRIGGER_ALNUM_CODE_POINTS = 4;

export type TriggerValidation =
  | { ok: true; normalized: string }
  | { ok: false; reason: "trigger_not_string" | "trigger_empty" | "trigger_too_short" };

/**
 * O2 §4.2④ —— 触发词校验。
 *
 * 每个条目必须为字符串；`N(t)` 后至少含 **4 个 Unicode 字母或数字码点**
 * （`\p{L}`｜`\p{N}`，按码点计；纯中文即至少四字；空白／标点不计长度）。
 * 中英文同一门槛。非法触发词 → **候选发布失败**，不得静默丢弃。
 */
export function validateCaliberTrigger(raw: unknown): TriggerValidation {
  if (typeof raw !== "string") return { ok: false, reason: "trigger_not_string" };
  const normalized = normalizeCaliberText(raw);
  if (normalized.length === 0) return { ok: false, reason: "trigger_empty" };
  if (countAlnumCodePoints(normalized) < MIN_TRIGGER_ALNUM_CODE_POINTS) {
    return { ok: false, reason: "trigger_too_short" };
  }
  return { ok: true, normalized };
}

/**
 * 口径字段键的规范化（比较用）。
 *
 * 与 ACL 的 `normalizeRef` 保持同一大小写口径（sourceMap 的 `sourceName` 本身
 * 就是小写规范名），因此这里做 trim＋小写。
 */
export function normalizeCaliberFieldKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * D7 ⑤「在**规范化字段键**上比较」—— 把字段键的来源部分归一到**逻辑
 * sourceName**。
 *
 * 请求方可能用物理表名引用来源（`dataforai.asset_count.asset_count`），绑定
 * 资产里写的是逻辑 sourceName（`asset_count.asset_count`）。归一后两侧口径
 * 才可比（SC-26：物理表别名／sourceMap 正向）。
 *
 * 归一只做**前缀**替换，不改写度量／维度名本身。
 */
export function normalizeCaliberFieldKeyForSource(
  value: string,
  boundKey: { sourceName: string; physicalTable: string; schema: string }
): string {
  const base = normalizeCaliberFieldKey(value);
  const source = normalizeCaliberFieldKey(boundKey.sourceName);
  const physical = normalizeCaliberFieldKey(boundKey.physicalTable);
  if (physical && physical !== source && base.startsWith(`${physical}.`)) {
    return `${source}.${base.slice(physical.length + 1)}`;
  }
  const schemaQualified = `${normalizeCaliberFieldKey(boundKey.schema)}.${source}`;
  if (schemaQualified !== source && base.startsWith(`${schemaQualified}.`)) {
    return `${source}.${base.slice(schemaQualified.length + 1)}`;
  }
  return base;
}
