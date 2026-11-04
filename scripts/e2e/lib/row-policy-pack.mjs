// Row-policy real e2e pack (strength B) — registry, constants, phase membership.
//
// Authority: docs/superpowers/specs/2026-11-04-row-policy-real-e2e-pack-design.md
// Execution ids: ROW25 (access-v025), RTP25/RTV25 (row-policy-templates-v025), BY-01..19.

import path from "node:path";
import process from "node:process";
import { REPO_ROOT } from "./common.mjs";
import { ROW25_EXECUTION_IDS } from "./access-v025.mjs";
import { rowPolicyCaseIds } from "./row-policy-templates-v025.mjs";

export const PACK_ID = "row-policy";
export const CONNECTION_ID = "mysql-aliyun";

export const REGIONS = Object.freeze({ A: "华东", B: "西南" });

export const TABLES = Object.freeze({
  // Live RDS column is lowercase `region` (not `Region`).
  fact: { schema: "dataforai", name: "superstore_orders", field: "region" },
  ungranted: { schema: "dataforai", name: "superstore_returns" },
});

export const ROLES = Object.freeze({
  east: "rp_east",
  west: "rp_west",
  all: "rp_all",
  eastPlusInline: "rp_east_plus_inline",
});

export const AGENTS = Object.freeze({
  east: "ag_east",
  eastWest: "ag_east_west",
  all: "ag_all",
  eastConstrained: "ag_east_constrained",
});

/** Per-run tokens → access.yaml `{{TOKEN_HASH_*}}` keys, mirroring security-e2e AGENT_TOKENS. */
export const ROW_POLICY_AGENT_TOKENS = Object.freeze([
  [AGENTS.east, "EAST"],
  [AGENTS.eastWest, "EAST_WEST"],
  [AGENTS.all, "ALL"],
  [AGENTS.eastConstrained, "EAST_CONSTRAINED"]
]);

export const ROW_POLICY_DB_DEFAULTS = Object.freeze({
  host: "rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com",
  port: 3306,
  readerRole: "cw_rds_bot",
  passwordRelPath: path.join(".ktx", "secrets", "mysql-aliyun-password")
});

/**
 * Fixture pack root. Default remains security-e2e so existing prepare callers stay unchanged.
 *
 * @param {string} [pack]
 * @returns {string}
 */
export function resolveFixtureRoot(pack = "security") {
  if (pack === "security") {
    return path.join(REPO_ROOT, "examples", "security-e2e");
  }
  if (pack === PACK_ID) {
    return path.join(REPO_ROOT, "examples", "row-policy-e2e");
  }
  throw new Error(`e2e pack must be "security" or "${PACK_ID}", got ${JSON.stringify(pack)}`);
}

/**
 * RDS read-only contract for the row-policy pack. Throws when apply-db is requested.
 *
 * @param {{ dbHost?: string, dbPort?: number|string, dbReaderRole?: string, applyDb?: boolean, env?: NodeJS.ProcessEnv }} [options]
 */
export function resolveRowPolicyDbContract(options = {}) {
  if (options.applyDb === true) {
    throw new Error("row-policy pack is RDS read-only");
  }
  const env = options.env ?? process.env;
  return {
    host: options.dbHost ?? env.LUCY_ROW_POLICY_DB_HOST ?? ROW_POLICY_DB_DEFAULTS.host,
    port: Number(options.dbPort ?? ROW_POLICY_DB_DEFAULTS.port),
    readerRole: options.dbReaderRole ?? ROW_POLICY_DB_DEFAULTS.readerRole
  };
}

/** @typedef {{ executionId: string, phase: "off"|"on"|"both", ownerFile: string, ownerSymbol: string, catalogId?: string, expectation?: string }} RegEntry */

const ROW25_OWNER_FILE = "webui/tests/real-e2e/row-policy-v025.spec.ts";
const RTP_RTV_OWNER_FILE = "webui/tests/real-e2e/row-policy-templates-v025.spec.ts";
const BY_OWNER_FILE = "scripts/e2e/security/row-policy-cases.mjs";

/**
 * Playwright titles for ROW25. Each value contains its execution id so
 * `run-row-policy-b` `--grep` selects that test and no other id.
 */
export const ROW25_OWNER_SYMBOLS = Object.freeze({
  "ROW25-V01": "ROW25-V01 模板 eq 展开为 scoped 且与内联 digest 一致",
  "ROW25-V02": "ROW25-V02 模板 in 的 values 顺序不影响 digest",
  "ROW25-V03": "ROW25-V03 模板与内联条件在同一 Role 分支内 AND",
  "ROW25-V04": "ROW25-V04 引用不存在的模板编译失败 row_policy_template_unresolved",
  "ROW25-V05": "ROW25-V05 未知字段编译失败 row_policy_field_unknown",
  "ROW25-V06": "ROW25-V06 模板引用度量编译失败 row_policy_field_unresolved:measure",
  "ROW25-V07": "ROW25-V07 非法谓词 op 编译失败 row_policy_op_forbidden",
  "ROW25-V08": "ROW25-V08 预览 ag_east_west 为 OR-of-AND 且 MCP 见华东与西南",
  "ROW25-V09": "ROW25-V09 并集含 rp_all 时预览全部行且运行时可见其他区划",
  "ROW25-V10": "ROW25-V10 ag_east_constrained 交集仅见华东",
  "ROW25-V11": "ROW25-V11 个人行限制不可满足时拒绝且不落盘",
  "ROW25-V12": "ROW25-V12 未落盘草稿预览与运行时区划一致",
  "ROW25-V13": "ROW25-V13 预览失败零落盘且失效确认不能提交",
  "ROW25-V14": "ROW25-V14 被引用模板拒绝删除且未引用模板可删",
  "ROW25-V15": "ROW25-V15 intent 与终结审计故障注入",
  "ROW25-V16": "ROW25-V16 模板变更后 policyVersion 变化且无需重启",
  "ROW25-V17": "ROW25-V17 未包装 lucy_read_source 按 row_policy_requires_wrapped_tool 拒绝",
  "ROW25-V18": "ROW25-V18 phase-off scoped 取数 row_policy_upstream_unproven",
  "ROW25-V19": "ROW25-V19 D-03 大写清单文件名",
  "ROW25-V20": "ROW25-V20 清单不可用与目录能力未知失败关闭",
  "ROW25-V21": "ROW25-V21 目录可靠时装载时字段不存在",
  "ROW25-V22": "ROW25-V22 D-03 大写 schema 预览与运行时等价"
});

for (const executionId of ROW25_EXECUTION_IDS) {
  const symbol = ROW25_OWNER_SYMBOLS[executionId];
  if (typeof symbol !== "string" || !symbol.includes(executionId)) {
    throw new Error(`row-policy-pack: ownerSymbol for ${executionId} must include the execution id`);
  }
}

/**
 * Playwright titles for RTP25-01..10 and RTV25-01..08. Each value contains its
 * execution id so `--grep` selects that test. These replace the Task 1 `TODO`.
 */
export const RTP_RTV_OWNER_SYMBOLS = Object.freeze({
  "RTP25-01": "RTP25-01 eq 与 in 模板展开 digest 与内联一致",
  "RTP25-02": "RTP25-02 模板与内联 AND、Role OR、Agent AND 保留 DNF",
  "RTP25-03": "RTP25-03 五类非法输入失败关闭且原因可区分",
  "RTP25-04": "RTP25-04 有引用模板拒绝删除改名且无引用可保存",
  "RTP25-05": "RTP25-05 模板变更后 policyVersion 变化且闸门不变",
  "RTP25-06": "RTP25-06 旧预览 digest 不可提交且重新 dry-run 后可保存",
  "RTP25-07": "RTP25-07 恢复失败阻断读取与写入",
  "RTP25-08": "RTP25-08 不可绑定模板在选择时披露原因",
  "RTP25-09": "RTP25-09 模板审计含 actor 与摘要且不含秘密",
  "RTP25-10": "RTP25-10 无模板配置不变且非法组合仍拒绝",
  "RTV25-01": "RTV25-01 superstore_orders 多 Role 多 Agent 同源",
  "RTV25-02": "RTV25-02 两受限 Role 不显示全部行且 all 仅真实分支",
  "RTV25-03": "RTV25-03 无授权不可满足编译失败与空筛选四态可区分",
  "RTV25-04": "RTV25-04 规范表键不合并且深链可复现",
  "RTV25-05": "RTV25-05 partial 与 unavailable 明示失败且不显示零授权",
  "RTV25-06": "RTV25-06 反查与关系图同快照且路径数与表数分开",
  "RTV25-07": "RTV25-07 按表反查只读且无写入口",
  "RTV25-08": "RTV25-08 单次响应快照代际一致且刷新后身份更新"
});

for (const executionId of rowPolicyCaseIds()) {
  const symbol = RTP_RTV_OWNER_SYMBOLS[executionId];
  if (typeof symbol !== "string" || !symbol.includes(executionId) || symbol === "TODO") {
    throw new Error(`row-policy-pack: ownerSymbol for ${executionId} must include the execution id`);
  }
}

/** @param {string} executionId @param {"off"|"on"|"both"} phase @param {string} ownerFile @param {string} [catalogId] @param {string} [ownerSymbol] @returns {RegEntry} */
function regEntry(executionId, phase, ownerFile, catalogId, ownerSymbol = "TODO") {
  return Object.freeze({
    executionId,
    phase,
    ownerFile,
    ownerSymbol,
    ...(catalogId !== undefined ? { catalogId } : {}),
  });
}

/** BY-01..BY-19 execution ids (Security row-policy matrix). */
export const BY_EXECUTION_IDS = Object.freeze(
  Array.from({ length: 19 }, (_, i) => `BY-${String(i + 1).padStart(2, "0")}`)
);

/** Approved pack id set: ROW25 + RTP25/RTV25 + BY. */
export const PACK_EXECUTION_IDS = Object.freeze([
  ...ROW25_EXECUTION_IDS,
  ...rowPolicyCaseIds(),
  ...BY_EXECUTION_IDS,
]);

const ROW25_REGISTRY = ROW25_EXECUTION_IDS.map((executionId) =>
  regEntry(
    executionId,
    executionId === "ROW25-V18" ? "off" : "on",
    ROW25_OWNER_FILE,
    undefined,
    ROW25_OWNER_SYMBOLS[executionId]
  )
);

const RTP_RTV_REGISTRY = rowPolicyCaseIds().map((executionId) =>
  regEntry(
    executionId,
    "on",
    RTP_RTV_OWNER_FILE,
    undefined,
    RTP_RTV_OWNER_SYMBOLS[executionId]
  )
);

/**
 * Handler labels for BY-01..19. Each value contains its execution id.
 * BY-09 is the phase-off unproven case; the others are phase-on.
 */
export const BY_OWNER_SYMBOLS = Object.freeze({
  "BY-01": "BY-01 ag_east 无用户筛选时仅见华东",
  "BY-02": "BY-02 结构化 or 筛选被拒",
  "BY-03": "BY-03 字符串 filter 被拒",
  "BY-04": "BY-04 度量表达式被拒",
  "BY-05": "BY-05 伪造 forced_filters 不被采纳",
  "BY-06": "BY-06 entity_details 与 sl_validate 均 row_policy_requires_wrapped_tool",
  "BY-07": "BY-07 未包装 lucy_read_source 按 row_policy_requires_wrapped_tool 拒绝",
  "BY-08": "BY-08 sl_query 按 tool_absolute_deny:sl_query 拒绝",
  "BY-09": "BY-09 phase-off scoped 取数 row_policy_upstream_unproven",
  "BY-10": "BY-10 ag_east_west 见华东与西南",
  "BY-11": "BY-11 跨来源 join 不扩权",
  "BY-12": "BY-12 left join 不扩权",
  "BY-13": "BY-13 布尔树筛选被拒",
  "BY-14": "BY-14 自连接不绕过行策略",
  "BY-15": "BY-15 having 不绕过行策略",
  "BY-16": "BY-16 子查询不扩权",
  "BY-17": "BY-17 lucy_freshness 按 row_policy_requires_wrapped_tool 拒绝",
  "BY-18": "BY-18 lucy_explain_query 本地诊断不转发上游",
  "BY-19": "BY-19 度量字段作谓词编译失败"
});

for (const executionId of BY_EXECUTION_IDS) {
  const symbol = BY_OWNER_SYMBOLS[executionId];
  if (typeof symbol !== "string" || !symbol.includes(executionId) || symbol === "TODO") {
    throw new Error(`row-policy-pack: ownerSymbol for ${executionId} must include the execution id`);
  }
}

const BY_REGISTRY = BY_EXECUTION_IDS.map((executionId) => {
  const suffix = executionId.slice("BY-".length);
  return regEntry(
    executionId,
    executionId === "BY-09" ? "off" : "on",
    BY_OWNER_FILE,
    `SEC-11-BY${suffix}`,
    BY_OWNER_SYMBOLS[executionId]
  );
});

/** @type {readonly RegEntry[]} */
export const REGISTRY = Object.freeze([
  ...ROW25_REGISTRY,
  ...RTP_RTV_REGISTRY,
  ...BY_REGISTRY,
]);

/**
 * Execution ids that run in the given gate phase (`off` = upstream unproven, `on` = proven).
 * Entries with `phase: "both"` appear in either phase list.
 *
 * @param {"off"|"on"} phase
 * @returns {string[]}
 */
export function idsForPhase(phase) {
  if (phase !== "off" && phase !== "on") {
    throw new Error(`row-policy-pack: idsForPhase expects "off" or "on", got ${JSON.stringify(phase)}`);
  }
  return REGISTRY.filter((entry) => entry.phase === phase || entry.phase === "both").map(
    (entry) => entry.executionId
  );
}

/** Throws if any pack execution id is missing, duplicated, or extraneous. */
export function assertRegistryComplete() {
  const seen = new Map();
  for (const entry of REGISTRY) {
    const { executionId } = entry;
    if (seen.has(executionId)) {
      throw new Error(`row-policy-pack: duplicate executionId ${executionId}`);
    }
    seen.set(executionId, entry);
  }

  const missing = PACK_EXECUTION_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`row-policy-pack: missing execution id(s): ${missing.join(", ")}`);
  }

  const packSet = new Set(PACK_EXECUTION_IDS);
  const extra = [...seen.keys()].filter((id) => !packSet.has(id));
  if (extra.length > 0) {
    throw new Error(`row-policy-pack: unknown execution id(s) in REGISTRY: ${extra.join(", ")}`);
  }
}
