/**
 * P0-3 表级歧义门闩（REQ-030-024）— 命中算法、分态、候选构造与门禁裁决。
 *
 * 权威合同：docs/specs/lucy-20261107-source-ambiguity-gate-spec.md v0.5
 * 可用性续作：docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md（P1-35 D1／D3／D5／D9）
 * O1＝旅程字段 confirmedSourceKey；O2＝否（read_source 不纳入）；O4＝度量摘要 8。
 *
 * 既有字段级 `ambiguousFieldHint`（source-ambiguity.ts）保留；本模块是 source 级。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { loadContentPaths } from "../paths.js";
import {
  canonicalSourceKeyEquals,
  collectCanonicalSourceKeys,
  type EffectivePermissions,
  type EffectiveSource
} from "./acl.js";
import { normalizeCaliberText } from "./caliber-binding-text.js";
import { classifyCaliberParticipation } from "./caliber-binding-registry.js";
import {
  bindingScopeKey,
  readBindingSession,
  type BindingSessionState
} from "./caliber-binding-session.js";
import {
  buildRepairClosure,
  denialAllowList,
  type RepairClosure,
  type RepairTargetEvidence
} from "./question-experience.js";
import {
  assembleCatalogSources,
  descriptionIndexKey,
  loadDescriptionIndexes,
  MAX_TOTAL_DESCRIPTION_CHARS,
  type CatalogSourceEntry
} from "./source-descriptions.js";
import {
  ambiguityScopeKey,
  NEVER_BEGUN_GENERATION_SENTINEL,
  persistAmbiguityCandidateSnapshot,
  readSourceAmbiguityJourneyResult,
  verifyUserParticipationEvidence,
  type DescriptionReadHealth,
  type DescriptionState,
  type SourceAmbiguityJourney,
  type SourceIdentity
} from "./source-ambiguity-journey.js";
import { joinConnected, loadDeclaredJoinEdges } from "./source-join-graph.js";
import {
  appendToleratedEvent,
  decideSourceSelection,
  SOURCE_COUNT_CAP,
  type SourceSelection
} from "./source-selection-tolerance.js";

// re-export for callers that only need the gate surface
export type { DescriptionReadHealth, DescriptionState, SourceIdentity };
export {
  ambiguityScopeKey,
  attestSourceConfirmation,
  admitHostConfirmRequest,
  hostConfirmCallerAllowed,
  LUCY_HOST_ATTESTATION_HEADER,
  NEVER_BEGUN_GENERATION_SENTINEL,
  persistAmbiguityCandidateSnapshot,
  readSourceAmbiguityJourney,
  readSourceAmbiguityJourneyResult,
  setSourceAmbiguityStateDir,
  upsertJourneyOnBegin,
  verifyUserParticipationEvidence
} from "./source-ambiguity-journey.js";

export const SOURCE_AMBIGUITY_GATE = "source_ambiguity_gate" as const;
export const SOURCE_AMBIGUITY_FAILURE_DIMENSION = "source_selection" as const;
export const SOURCE_AMBIGUITY_MESSAGE = "表级歧义：请先确认来源表";

/** O4 闭合：度量覆盖摘要最大条数。 */
export const MEASURE_SUMMARY_MAX = 8;

/** 多表命中先问 — instructions 事实源片段（D13；P1-35 钉选放行）。 */
export const ASK_FIRST_SECTION = `## 问询范围确认／多表命中先问

- 问询**原文**里出现指代（"这个""上次那个""它"）或一句包含两个意图时，先复述账户、月份和产品线，等用户确认后再发 \`lucy_query\`。
- 没有用户原文的推断问询（例如从历史日志或工具报错反推出来的需求）跳过复述，直接按已确认范围查数。
- 当多个可见来源表都可能回答同一业务词时，优先向用户澄清选哪张表，再发 \`lucy_query\`／\`lucy_explain_query\`；用户无法即时确认时，按最贴近问题的来源直接查，并在答复里说明所用来源。
- Proxy 对选表歧义采用「放行并披露」：单来源、或经语义层已声明 join 连通的同连接多来源（至多 ${SOURCE_COUNT_CAP} 个）直接放行；集外钉选或未连通的多来源同样放行，但 \`answer_verifiability.sourceSelection\` 会标注 \`tolerated\`——此时你**必须**在答复里如实告知所用来源，并说明该选表未经用户确认。
- 仍会拦截（\`source_ambiguity_gate\`）：无法解析的引用、目录健康失败、跨连接多来源、来源数超过 ${SOURCE_COUNT_CAP}、ACL／行权限限制；以及请求里**没有任何带来源限定的引用**（如度量只写 \`order_count\`、没有 \`source.\` 前缀）而业务词命中多个来源时——此时改用 \`source.measure\` 形式钉选单一来源再重试。被拦后按返回的 \`usableTargets\` 改写为**单来源查询**重试；跨连接则按连接分别查。
- 宿主 person＋attestation 确认仍可用于 WebUI；Agent 不得伪造宿主 confirm HTTP。
- 支持／暂不支持的组合场景见 \`docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md\` §4.5。
- 指代／双意图的复述仍约束模型行为。
`;

/** CJK／Han 判定（与 Spec §4.1 夹具一致）。 */
const HAN_CHAR = /\p{Script=Han}/u;

export function normalizeAmbiguityText(value: string): string {
  return normalizeCaliberText(value);
}

/**
 * §4.1 短语提取：整句 + 空白 token（len≥2）+ CJK 连续 n-gram（L∈[2,min(8,|R|)]）。
 */
export function extractTerms(inputs: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  const push = (t: string) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    terms.push(t);
  };

  for (const raw of inputs) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const T = normalizeAmbiguityText(raw);
    if (T.length < 1) continue;
    push(T);
    for (const token of T.split(" ")) {
      if (token.length >= 2) push(token);
    }
    // CJK 连续 n-gram
    let i = 0;
    const chars = [...T];
    while (i < chars.length) {
      if (!HAN_CHAR.test(chars[i]!)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < chars.length && HAN_CHAR.test(chars[j]!)) j += 1;
      const run = chars.slice(i, j).join("");
      const maxL = Math.min(8, run.length);
      for (let L = 2; L <= maxL; L += 1) {
        for (let start = 0; start + L <= run.length; start += 1) {
          push(run.slice(start, start + L));
        }
      }
      i = j;
    }
  }
  return terms;
}

export type MatchableSource = {
  identity: SourceIdentity;
  sourceName: string;
  table: string;
  measureNames?: readonly string[];
  dimensionNames?: readonly string[];
  description?: string | null;
  descriptionState?: DescriptionState;
  descriptionHealth?: DescriptionReadHealth;
  /** 语义模型／度量枚举部分失败。 */
  readPartial?: boolean;
};

export type MatchOutcome =
  | { kind: "hits"; hits: SourceIdentity[]; matched: MatchableSource[] }
  | { kind: "zero_hits" }
  | { kind: "catalog_read_failure"; reason: string }
  | { kind: "read_partial_indeterminate"; reason: string }
  | { kind: "description_read_unreliable"; reason: string };

function descriptionHealthy(source: MatchableSource): boolean {
  const health = source.descriptionHealth ?? { status: "ok" as const };
  return health.status === "ok";
}

function sourceHit(source: MatchableSource, terms: readonly string[]): boolean {
  const fields: string[] = [source.sourceName, source.table];
  const health = source.descriptionHealth ?? { status: "ok" as const };
  if (
    health.status === "ok"
    && (source.descriptionState === "present" || source.descriptionState === "truncated")
    && source.description != null
  ) {
    fields.push(source.description);
  }
  for (const name of source.measureNames ?? []) fields.push(name);
  for (const name of source.dimensionNames ?? []) fields.push(name);

  for (const t of terms) {
    for (const f of fields) {
      const nf = normalizeAmbiguityText(f);
      if (!nf) continue;
      if (nf.includes(t)) return true;
      if (t.length >= 2 && nf.length >= 2 && t.includes(nf)) return true;
    }
  }
  return false;
}

/**
 * §4.1＋§4.6：匹配可见 source；健康态非 ok → 不可判定。
 */
export function matchVisibleSources(
  terms: readonly string[],
  sources: readonly MatchableSource[],
  options: { catalogReadFailed?: boolean; catalogReadReason?: string } = {}
): MatchOutcome {
  if (options.catalogReadFailed) {
    return {
      kind: "catalog_read_failure",
      reason: options.catalogReadReason ?? "catalog_read_failure"
    };
  }
  if (sources.some((s) => s.descriptionHealth?.status === "index_unreliable")) {
    return { kind: "description_read_unreliable", reason: "description_index_unreliable" };
  }
  if (sources.some((s) => s.descriptionHealth?.status === "read_failed")) {
    return { kind: "description_read_unreliable", reason: "description_read_failed" };
  }

  const partialSources = sources.filter((s) => s.readPartial);
  const hits: MatchableSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!sourceHit(source, terms)) continue;
    const id = `${source.identity.connectionId}|${source.identity.schema}|${source.identity.sourceName}|${source.identity.physicalTable}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push(source);
  }

  if (hits.length >= 2) {
    return {
      kind: "hits",
      hits: hits.map((h) => h.identity),
      matched: hits
    };
  }

  // 因部分读取失败导致「看起来 <2」但宇宙不完整 → fail-closed
  if (partialSources.length > 0 && hits.length < 2) {
    return {
      kind: "read_partial_indeterminate",
      reason: "semantic_model_partial"
    };
  }

  if (hits.length === 0) return { kind: "zero_hits" };
  return { kind: "hits", hits: hits.map((h) => h.identity), matched: hits };
}

/** 请求是否已断言任一 source／限定字段（§4.3 P1）。 */
export function requestAssertsSource(args: Record<string, unknown>): boolean {
  const top = ["sourceName", "source_name", "source", "table", "tableName", "table_name"];
  for (const key of top) {
    if (typeof args[key] === "string" && String(args[key]).trim()) return true;
  }
  const scan = (value: unknown): boolean => {
    if (typeof value === "string") {
      const s = value.trim();
      return s.includes(".") && /[A-Za-z_\u4e00-\u9fff]/.test(s);
    }
    if (Array.isArray(value)) return value.some(scan);
    if (value && typeof value === "object") {
      const rec = value as Record<string, unknown>;
      if (typeof rec.field === "string" && rec.field.includes(".")) return true;
      if (typeof rec.name === "string" && rec.name.includes(".")) return true;
      return Object.values(rec).some(scan);
    }
    return false;
  };
  for (const key of ["measures", "dimensions", "filters", "where", "segments", "order_by", "orderBy", "sort", "having"]) {
    if (scan(args[key])) return true;
  }
  return false;
}

export type TermOutcome =
  | { kind: "context_missing" }
  | { kind: "catalog_read_failure"; reason: string }
  | { kind: "read_partial_indeterminate"; reason: string }
  | { kind: "description_read_unreliable"; reason: string }
  | { kind: "zero_hits" }
  | { kind: "terms_ready"; terms: string[]; mode: "journey" | "terms_from_request" };

/**
 * §4.3 互斥优先级分态（不含匹配；匹配在后续）。
 * catalog／描述失败由调用方在 match 阶段注入。
 */
export function resolveBusinessTermsByPriority(input: {
  bindingState: BindingSessionState;
  args: Record<string, unknown>;
  journey: SourceAmbiguityJourney;
}): TermOutcome {
  const asserted = requestAssertsSource(input.args);
  const hasBegin =
    input.bindingState === "begun_no_hit"
    || input.bindingState === "begun_bound"
    || (input.journey.intentSummary != null && input.journey.intentSummary.length > 0);

  if (input.bindingState === "never_begun" && asserted) {
    return { kind: "context_missing" };
  }

  if (hasBegin || input.bindingState === "begun_no_hit") {
    const terms = extractTerms([input.journey.intentSummary, input.journey.question]);
    if (terms.length === 0 && asserted) {
      // 有 begin 但词空且已断言 source → 仍用请求字面补充（不得覆盖确认语义）
      const requestTerms = extractTerms(requestLiteralStrings(input.args));
      if (requestTerms.length === 0) return { kind: "context_missing" };
      return { kind: "terms_ready", terms: requestTerms, mode: "journey" };
    }
    if (terms.length === 0) {
      const requestTerms = extractTerms(requestLiteralStrings(input.args));
      if (requestTerms.length === 0) return { kind: "zero_hits" };
      return { kind: "terms_ready", terms: [...terms, ...requestTerms], mode: "journey" };
    }
    return { kind: "terms_ready", terms, mode: "journey" };
  }

  // never_begun + 未断言 source → terms_from_request（O3′ 边角）
  if (!asserted) {
    const terms = extractTerms(requestLiteralStrings(input.args));
    if (terms.length === 0) return { kind: "zero_hits" };
    return { kind: "terms_ready", terms, mode: "terms_from_request" };
  }

  return { kind: "context_missing" };
}

function requestLiteralStrings(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (typeof value === "string" && value.trim()) out.push(value);
    else if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
    else if (value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v, depth + 1);
    }
  };
  walk(args, 0);
  return out;
}

export type AmbiguityCandidateRow = {
  sourceKey: SourceIdentity;
  displayName: string;
  allowListName: string;
  measures: string[];
  description?: string | null;
  descriptionState?: DescriptionState;
};

export type SourceAmbiguityDenial = {
  reason: typeof SOURCE_AMBIGUITY_GATE;
  failureDimension: typeof SOURCE_AMBIGUITY_FAILURE_DIMENSION;
  message: string;
  detail?: string;
  candidates: AmbiguityCandidateRow[];
  repair: RepairClosure;
  /** 可选：字段级歧义并存信息（D7）。 */
  fieldAmbiguity?: { field: string; repair: string } | null;
};

export type SourceAmbiguityGateOutcome =
  | { kind: "allow"; selection?: SourceSelection } // selection＝档②披露（v0.4 D13）
  | { kind: "skip_bound" } // begun_bound：跳过本门闩，交 P0-1
  | { kind: "deny_caliber_unresolved"; text: string }
  | { kind: "deny"; denial: SourceAmbiguityDenial; executed: false };

function toCandidateRow(source: MatchableSource): AmbiguityCandidateRow {
  const measures = [...(source.measureNames ?? [])].slice(0, MEASURE_SUMMARY_MAX);
  return {
    sourceKey: source.identity,
    displayName: source.sourceName || source.table,
    allowListName: source.sourceName || source.table,
    measures,
    description: source.description ?? null,
    descriptionState: source.descriptionState
  };
}

/** 五项证据 Map 键＝完整 Source Identity（禁止仅用短名）。 */
export function repairEvidenceIdentityKey(sourceKey: SourceIdentity): string {
  return `${sourceKey.connectionId}|${sourceKey.schema}|${sourceKey.sourceName}|${sourceKey.physicalTable}`;
}

/**
 * §4.7 五项证据装配。
 * 缺省 **fail-closed／unknown**（`schemaExists=null`、其余 false），禁止假装全绿。
 * 生产须传入真实探测结果（见 `buildRepairEvidenceForGate`）。
 */
export function toRepairTargetEvidence(
  candidates: readonly AmbiguityCandidateRow[],
  evidenceByIdentityOrName: ReadonlyMap<string, Omit<RepairTargetEvidence, "target">>
): RepairTargetEvidence[] {
  return candidates.map((c) => {
    const base =
      evidenceByIdentityOrName.get(repairEvidenceIdentityKey(c.sourceKey))
      ?? evidenceByIdentityOrName.get(c.allowListName);
    return {
      target: c.allowListName,
      schemaExists: base?.schemaExists ?? null,
      visibleToPrincipal: base?.visibleToPrincipal ?? false,
      compiled: base?.compiled ?? false,
      parameterShapeValid: base?.parameterShapeValid ?? false,
      callable: base?.callable ?? false
    };
  });
}

/**
 * 生产五项证据：按 Source Identity 装配，不默认全绿。
 * - schemaExists：无真实 schema 探测时一律 null（不可判定 → 不进 usableTargets）
 * - compiled：无 completion=done 探测时 false
 * - parameterShapeValid：无相对本次 args 的形状核验时 false
 * 短名只用于 denialAllowList；Map 键＝完整身份串，避免双连接同名覆盖。
 */

export type GateSchemaProbe = {
  schemaExists: boolean | null;
  /** 仅 `done` 计为 compiled；`partial` 及其他均 false（P1-35 §4.4）。 */
  completion?: string | null;
  measureNames?: readonly string[];
  dimensionNames?: readonly string[];
};

/**
 * 单身份重试形态的度量核验（Spec §4.4 argsShape）：本候选限定的度量与无限定度量须真实存在；
 * 指向其他候选的度量在改写时被丢弃，但请求里至少有一个度量名在本候选存在，否则重试无度量可用。
 * 仅字符串度量参与核验（`{expr,name}` 即席表达式不带来源限定）；无字符串度量则恒合法。
 */
function retryMeasureShapeValid(
  rawMeasures: unknown,
  candidateSourceName: string,
  measureNames: readonly string[] | undefined
): boolean {
  const requested = Array.isArray(rawMeasures)
    ? rawMeasures.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
    : [];
  if (requested.length === 0) return true;
  const known = new Set((measureNames ?? []).map((n) => n.trim().toLowerCase()));
  const self = candidateSourceName.trim().toLowerCase();
  let anyPresent = false;
  for (const raw of requested) {
    const text = raw.trim().toLowerCase();
    const dot = text.lastIndexOf(".");
    const leaf = dot >= 0 ? text.slice(dot + 1) : text;
    const qualifier = dot >= 0 ? text.slice(0, dot).split(".").pop() : null;
    const present = known.has(leaf);
    if (present) anyPresent = true;
    const addressesSelf = qualifier === null || qualifier === self;
    if (addressesSelf && !present) return false;
  }
  return anyPresent;
}

export function buildRepairEvidenceForGate(input: {
  candidates: readonly AmbiguityCandidateRow[];
  permissions: Pick<EffectivePermissions, "sources" | "tools">;
  toolName: string;
  /** false → 全体 schemaExists=null。缺省亦为不可判定（无真实探测）。 */
  sourceMapReliable?: boolean;
  /** 按完整身份键的真实探测；缺省则 schemaExists=null、compiled=false。 */
  schemaProbeByIdentity?: ReadonlyMap<string, GateSchemaProbe>;
  /** 本次请求；仅用于 argsShape 的度量存在性核验（单身份重试形态）。 */
  args?: Record<string, unknown>;
}): Map<string, Omit<RepairTargetEvidence, "target">> {
  const visible = new Set(
    input.permissions.sources.map(
      (s) =>
        `${s.connectionId}|${s.schema}|${s.sourceName}|${s.table}`
    )
  );
  const callable = input.permissions.tools.includes(input.toolName);
  const reliable = input.sourceMapReliable === true;
  const out = new Map<string, Omit<RepairTargetEvidence, "target">>();
  for (const c of input.candidates) {
    const key = repairEvidenceIdentityKey(c.sourceKey);
    const isVisible = visible.has(key);
    const probe = input.schemaProbeByIdentity?.get(key);
    const schemaExists =
      !reliable
        ? null
        : probe
          ? probe.schemaExists
          : null;
    const compiled = probe?.completion === "done";
    // 无探测入口时 argsShape 一律 false（fail-closed）。
    // 校验对象是「单身份重试形态」（Spec §4.4），不是原请求：原请求含他表引用不使候选失效。
    const parameterShapeValid = probe
      ? retryMeasureShapeValid(input.args?.measures, c.sourceKey.sourceName, probe.measureNames)
      : false;
    out.set(key, {
      schemaExists,
      visibleToPrincipal: isVisible,
      compiled,
      parameterShapeValid,
      callable
    });
  }
  return out;
}

export function buildAmbiguityRepairClosure(
  evidences: readonly RepairTargetEvidence[]
): RepairClosure {
  // D14／§4.7：五项失败对象不得进入 availableCandidates
  return buildRepairClosure({
    failureDimension: SOURCE_AMBIGUITY_FAILURE_DIMENSION,
    candidates: evidences,
    availableCandidates: []
  });
}

function effectiveSourceToMatchable(
  source: EffectiveSource,
  enrich?: Partial<MatchableSource>
): MatchableSource {
  return {
    identity: {
      connectionId: source.connectionId,
      schema: source.schema,
      sourceName: source.sourceName,
      physicalTable: source.table
    },
    sourceName: source.sourceName,
    table: source.table,
    ...enrich
  };
}

type OverlayNameBag = {
  measureNames: string[];
  dimensionNames: string[];
  readPartial: boolean;
};

async function loadOverlayNamesForSource(
  semanticLayerRoot: string,
  source: EffectiveSource
): Promise<OverlayNameBag> {
  const overlayPath = path.join(
    semanticLayerRoot,
    source.connectionId,
    `${source.sourceName}.yaml`
  );
  let content: string;
  try {
    content = await readFile(overlayPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { measureNames: [], dimensionNames: [], readPartial: false };
    }
    return { measureNames: [], dimensionNames: [], readPartial: true };
  }
  let yaml: unknown;
  try {
    yaml = parse(content);
  } catch {
    return { measureNames: [], dimensionNames: [], readPartial: true };
  }
  if (!yaml || typeof yaml !== "object" || Array.isArray(yaml)) {
    return { measureNames: [], dimensionNames: [], readPartial: false };
  }
  const rec = yaml as Record<string, unknown>;
  const namesOf = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) out.push(name.trim());
    }
    return out;
  };
  return {
    measureNames: namesOf(rec.measures),
    dimensionNames: [...namesOf(rec.dimensions), ...namesOf(rec.columns)],
    readPartial: false
  };
}

export type BuildMatchableSourcesResult = {
  matchableSources: MatchableSource[];
  /** 整根描述索引不可用时 true（门闩应 fail-closed）。 */
  descriptionIndexUnreliable: boolean;
};

/**
 * 生产装配：复用 P0-2 `source-descriptions` 投影＋overlay 度量／维度名＋健康态。
 * mcp-proxy 必须调用本函数（或等价富化）再调门闩；禁止只传 permissions.sources。
 */
export async function buildMatchableSourcesForGate(
  sources: readonly EffectiveSource[],
  options: {
    semanticLayerRoot?: string;
    connectionScope?: string[];
  } = {}
): Promise<BuildMatchableSourcesResult> {
  const semanticLayerRoot =
    options.semanticLayerRoot
    ?? (await loadContentPaths()).semanticLayer;
  const connectionScope = options.connectionScope
    ?? [...new Set(sources.map((s) => s.connectionId))];

  let indexUnreliable = false;
  let failedConnections = new Set<string>();
  let failedSourceKeys = new Set<string>();
  let catalogEntries: CatalogSourceEntry[] = [];
  try {
    const indexes = await loadDescriptionIndexes(semanticLayerRoot, connectionScope);
    failedConnections = indexes.failedConnections;
    failedSourceKeys = indexes.failedSourceKeys;
    const identities = sources.map((s) => ({
      connectionId: s.connectionId,
      schema: s.schema,
      sourceName: s.sourceName,
      table: s.table
    }));
    catalogEntries = assembleCatalogSources(
      identities,
      indexes.manifestIndex,
      indexes.overlayIndex,
      { maxTotalDescriptionChars: MAX_TOTAL_DESCRIPTION_CHARS }
    );
  } catch {
    indexUnreliable = true;
    catalogEntries = sources.map((s) => ({
      connectionId: s.connectionId,
      schema: s.schema,
      sourceName: s.sourceName,
      table: s.table,
      description: null,
      descriptionState: "missing" as const
    }));
  }

  const byKey = new Map(
    catalogEntries.map((e) => [
      descriptionIndexKey(e.connectionId, e.schema, e.sourceName),
      e
    ])
  );

  const matchableSources: MatchableSource[] = [];
  for (const source of sources) {
    const key = descriptionIndexKey(source.connectionId, source.schema, source.sourceName);
    const entry = byKey.get(key);
    const names = await loadOverlayNamesForSource(semanticLayerRoot, source);
    const connectionNorm = source.connectionId.trim().replace(/[`"']/g, "").toLowerCase();
    let descriptionHealth: DescriptionReadHealth = { status: "ok" };
    if (indexUnreliable) {
      descriptionHealth = { status: "index_unreliable" };
    } else if (failedConnections.has(connectionNorm)) {
      descriptionHealth = { status: "read_failed", reason: "schema_index_unreadable" };
    } else if (failedSourceKeys.has(key)) {
      descriptionHealth = { status: "read_failed", reason: "overlay_unreadable" };
    } else if (names.readPartial) {
      descriptionHealth = { status: "read_failed", reason: "overlay_parse_or_io" };
    }
    // assemble 已截断时保留 truncated 态与原文切片；健康态非 ok 时描述不参与匹配
    const descriptionState: DescriptionState =
      descriptionHealth.status !== "ok"
        ? "missing"
        : (entry?.descriptionState ?? "missing");
    const description =
      descriptionHealth.status !== "ok"
        ? null
        : (entry?.description ?? null);
    matchableSources.push(
      effectiveSourceToMatchable(source, {
        description,
        descriptionState,
        descriptionHealth,
        measureNames: names.measureNames,
        dimensionNames: names.dimensionNames,
        readPartial: names.readPartial || descriptionHealth.status !== "ok"
      })
    );
  }

  return {
    matchableSources,
    descriptionIndexUnreliable: indexUnreliable
  };
}

/**
 * 同构描述投影（P0-2 未接线时的直读夹具合同；字段名／missing／truncated／健康态对齐 D12）。
 */
export function projectDescriptionForGate(input: {
  descriptionDb: string | null | undefined;
  maxChars?: number;
  health?: DescriptionReadHealth;
}): {
  description: string | null;
  descriptionState: DescriptionState;
  descriptionHealth: DescriptionReadHealth;
} {
  const health = input.health ?? { status: "ok" };
  if (health.status !== "ok") {
    // 投影层可能把失败记成 missing；门闩仍保留健康态
    return { description: null, descriptionState: "missing", descriptionHealth: health };
  }
  const raw = input.descriptionDb;
  if (raw == null || !String(raw).trim()) {
    return { description: null, descriptionState: "missing", descriptionHealth: health };
  }
  const max = input.maxChars;
  if (typeof max === "number" && max >= 0 && raw.length > max) {
    return {
      description: raw.slice(0, max),
      descriptionState: "truncated",
      descriptionHealth: health
    };
  }
  return { description: raw, descriptionState: "present", descriptionHealth: health };
}

/** P1-35 v0.4 D15：硬线拦截的下一步直接写进 message（MCP 可达＝拆成单来源／单连接）。 */
export function denialMessageFor(detail: string | undefined): string {
  if (detail === "cross_connection") {
    return "跨连接多来源不能在一次查询中合并：请按连接拆分为单连接查询";
  }
  if (detail === "source_count_over_cap") {
    return "单次查询引用的来源过多：请拆成单来源（或不超过 ${SOURCE_COUNT_CAP} 个已声明 join 的来源）查询";
  }
  return SOURCE_AMBIGUITY_MESSAGE;
}

function denialPayload(
  candidates: AmbiguityCandidateRow[],
  repair: RepairClosure,
  detail?: string,
  fieldAmbiguity?: SourceAmbiguityDenial["fieldAmbiguity"]
): SourceAmbiguityDenial {
  return {
    reason: SOURCE_AMBIGUITY_GATE,
    failureDimension: SOURCE_AMBIGUITY_FAILURE_DIMENSION,
    message: denialMessageFor(detail),
    detail,
    candidates,
    repair,
    fieldAmbiguity: fieldAmbiguity ?? null
  };
}

export type CheckSourceAmbiguityGateInput = {
  identityKey: string;
  sessionId: string | null | undefined;
  toolName: "lucy_query" | "lucy_explain_query";
  args: Record<string, unknown>;
  permissions: Pick<EffectivePermissions, "connections" | "sources" | "tools">;
  /** 可见 source 的匹配富化（度量／描述／健康态）；生产须由 buildMatchableSourcesForGate 装配。 */
  matchableSources?: MatchableSource[];
  catalogReadFailed?: boolean;
  catalogReadReason?: string;
  /**
   * 五项证据覆盖。缺省走 `buildRepairEvidenceForGate`（基于 permissions＋探测）；
   * 未传入且不想用默认探测时显式传空 Map → fail-closed（不假装全绿）。
   */
  repairEvidenceByName?: ReadonlyMap<string, Omit<RepairTargetEvidence, "target">>;
  /** 与 repairEvidenceByName 联用：sourceMap 不可靠时 schemaExists=null。 */
  sourceMapReliable?: boolean;
  /** 生产须传入按完整身份的 schema／completion 探测（P1-35 D5）。 */
  schemaProbeByIdentity?: ReadonlyMap<string, GateSchemaProbe>;
  fieldAmbiguity?: { field: string; repair: string } | null;
};

function sourceVisibleToPrincipal(
  key: SourceIdentity,
  permissions: Pick<EffectivePermissions, "sources">
): boolean {
  return permissions.sources.some(
    (s) =>
      s.connectionId === key.connectionId
      && s.schema === key.schema
      && s.sourceName === key.sourceName
      && s.table === key.physicalTable
  );
}

function catalogHealthFailed(
  input: CheckSourceAmbiguityGateInput,
  sources: readonly MatchableSource[],
  requested: readonly SourceIdentity[]
): string | null {
  if (input.catalogReadFailed) {
    return input.catalogReadReason ?? "catalog_read_failure";
  }
  for (const key of requested) {
    const row = sources.find((s) => canonicalSourceKeyEquals(s.identity, key));
    if (row?.descriptionHealth?.status === "read_failed") {
      return row.descriptionHealth.reason ?? "description_read_unreliable";
    }
  }
  return null;
}

/**
 * 表级歧义门闩主入口。须在 ACL 通过后、上游／explain 成功体前调用。
 * 优先级：lost → bound skip → catalog 健康 → unresolved → D1 钉选放行 → never_begun context_missing → hits＜2 allow → deny。
 */
export async function checkSourceAmbiguityGate(
  input: CheckSourceAmbiguityGateInput
): Promise<SourceAmbiguityGateOutcome> {
  const bindingScope = bindingScopeKey(input.identityKey, input.sessionId);
  const session = await readBindingSession(bindingScope);
  let state = session.state;

  // A proven optional legacy preparation must follow the ordinary never-begun
  // ambiguity path too. Do not bypass source checks or clear persisted history.
  if (state === "lost_or_conflict" && session.optionalPreparing
    && await classifyCaliberParticipation({ scopeKey: bindingScope }) === "inactive") {
    state = "never_begun";
  }

  if (state === "lost_or_conflict") {
    return {
      kind: "deny_caliber_unresolved",
      text: "Access denied: caliber_binding_unresolved（口径绑定无法解析）：本次问询的口径绑定状态不可信"
    };
  }
  if (state === "begun_bound" && session.record?.commitPhase === "committed") {
    return { kind: "skip_bound" };
  }

  const sagScope = ambiguityScopeKey(input.identityKey, input.sessionId);
  const journeyRead = await readSourceAmbiguityJourneyResult(sagScope);
  if (!journeyRead.ok) {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, journeyRead.reason, input.fieldAmbiguity)
    };
  }
  const journey = journeyRead.journey;
  const generation = state === "never_begun"
    ? NEVER_BEGUN_GENERATION_SENTINEL
    : session.record?.generation ?? journey.generation;

  const sources =
    input.matchableSources
    ?? input.permissions.sources.map((s) => effectiveSourceToMatchable(s));

  const collected = await collectCanonicalSourceKeys(input.toolName, input.args);
  if (collected.unresolved.length > 0) {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, "unresolved_source_refs", input.fieldAmbiguity)
    };
  }

  const ctx: GateContext = { input, state, journey, generation, sagScope, sources };
  if (collected.keys.length > 0) {
    return gateForRequestedSources(ctx, collected.keys);
  }

  // keys=0（无 source-qualified 引用）：保持 v0.3 行为
  const healthFail = catalogHealthFailed(input, sources, []);
  if (healthFail) return denyEmpty(input, healthFail);
  const termOutcome = resolveBusinessTermsByPriority({
    bindingState: state,
    args: input.args,
    journey
  });
  if (termOutcome.kind === "context_missing") return denyEmpty(input, "need_begin_or_confirm");
  if (
    termOutcome.kind === "catalog_read_failure"
    || termOutcome.kind === "read_partial_indeterminate"
    || termOutcome.kind === "description_read_unreliable"
  ) {
    return denyEmpty(input, "catalog_unreliable");
  }
  if (termOutcome.kind === "zero_hits") return { kind: "allow" };
  const matchOutcome = matchVisibleSources(termOutcome.terms, sources, {
    catalogReadFailed: input.catalogReadFailed,
    catalogReadReason: input.catalogReadReason
  });
  if (
    matchOutcome.kind === "catalog_read_failure"
    || matchOutcome.kind === "description_read_unreliable"
    || matchOutcome.kind === "read_partial_indeterminate"
  ) {
    return denyEmpty(input, matchOutcome.reason);
  }
  if (matchOutcome.kind === "zero_hits" || matchOutcome.hits.length < 2) return { kind: "allow" };

  const allowSet = new Set(
    denialAllowList({
      connections: input.permissions.connections,
      sources: input.permissions.sources
    }).sources
  );
  const matchedRows = matchOutcome.matched
    .filter((m) => allowSet.has(m.sourceName || m.table))
    .map(toCandidateRow);
  return denyWithCandidates(ctx, matchedRows, undefined);
}

type GateContext = {
  input: CheckSourceAmbiguityGateInput;
  state: BindingSessionState;
  journey: SourceAmbiguityJourney;
  generation: number;
  sagScope: string;
  sources: readonly MatchableSource[];
};

function denyEmpty(
  input: CheckSourceAmbiguityGateInput,
  detail: string
): SourceAmbiguityGateOutcome {
  return {
    kind: "deny",
    executed: false,
    denial: denialPayload([], buildAmbiguityRepairClosure([]), detail, input.fieldAmbiguity)
  };
}

async function denyWithCandidates(
  ctx: GateContext,
  rows: AmbiguityCandidateRow[],
  detail: string | undefined
): Promise<SourceAmbiguityGateOutcome> {
  const { input } = ctx;
  const evidenceMap =
    input.repairEvidenceByName
    ?? buildRepairEvidenceForGate({
      candidates: rows,
      permissions: {
        sources: input.permissions.sources,
        tools: input.permissions.tools ?? [input.toolName]
      },
      toolName: input.toolName,
      sourceMapReliable: input.sourceMapReliable,
      schemaProbeByIdentity: input.schemaProbeByIdentity,
      args: input.args
    });
  const closure = buildAmbiguityRepairClosure(toRepairTargetEvidence(rows, evidenceMap));
  await persistAmbiguityCandidateSnapshot({
    scopeKey: ctx.sagScope,
    generation: ctx.generation,
    candidates: rows.map((r) => r.sourceKey)
  });
  return {
    kind: "deny",
    executed: false,
    denial: denialPayload(rows, closure, detail, input.fieldAmbiguity)
  };
}

/** 词源命中集；never_begun／无词源／零命中＝空集；健康类失败返回 deny 原因。 */
function resolveTermHits(
  ctx: GateContext
): { ok: true; hits: SourceIdentity[] } | { ok: false; reason: string } {
  const { input, state, journey, sources } = ctx;
  if (state === "never_begun") return { ok: true, hits: [] };
  const termOutcome = resolveBusinessTermsByPriority({
    bindingState: state,
    args: input.args,
    journey
  });
  if (termOutcome.kind === "zero_hits" || termOutcome.kind === "context_missing") {
    return { ok: true, hits: [] };
  }
  if (
    termOutcome.kind === "catalog_read_failure"
    || termOutcome.kind === "read_partial_indeterminate"
    || termOutcome.kind === "description_read_unreliable"
  ) {
    return { ok: false, reason: "catalog_unreliable" };
  }
  const match = matchVisibleSources(termOutcome.terms, sources, {
    catalogReadFailed: input.catalogReadFailed,
    catalogReadReason: input.catalogReadReason
  });
  if (
    match.kind === "catalog_read_failure"
    || match.kind === "description_read_unreliable"
    || match.kind === "read_partial_indeterminate"
  ) {
    return { ok: false, reason: match.reason };
  }
  return { ok: true, hits: match.kind === "zero_hits" ? [] : [...match.hits] };
}

function requestedRows(
  ctx: GateContext,
  keys: readonly SourceIdentity[]
): AmbiguityCandidateRow[] {
  return keys.map((key) => {
    const row = ctx.sources.find((s) => canonicalSourceKeyEquals(s.identity, key));
    return row
      ? toCandidateRow(row)
      : {
          sourceKey: key,
          displayName: key.sourceName,
          allowListName: key.sourceName,
          measures: []
        };
  });
}

function hostConfirmedPin(ctx: GateContext, key: SourceIdentity): boolean {
  const confirmedKey = ctx.journey.confirmedSourceKey;
  if (!confirmedKey || !canonicalSourceKeyEquals(confirmedKey, key)) return false;
  return verifyUserParticipationEvidence({
    journey: ctx.journey,
    expectedGeneration: ctx.generation,
    confirmedKey
  }).ok;
}

/**
 * keys≥1：v0.4 三档（D10–D15）。硬线（健康／不可见／跨连接／超上限）先于容错。
 */
async function gateForRequestedSources(
  ctx: GateContext,
  keys: readonly SourceIdentity[]
): Promise<SourceAmbiguityGateOutcome> {
  const { input } = ctx;
  const healthFail = catalogHealthFailed(input, ctx.sources, keys);
  if (healthFail) return denyEmpty(input, healthFail);
  if (keys.some((k) => !sourceVisibleToPrincipal(k, input.permissions))) {
    // never_begun 沿用 v0.3 文案（SC-10）；其余 fail-closed。均为硬线，不降档。
    return denyEmpty(input, ctx.state === "never_begun" ? "need_begin_or_confirm" : "unresolved_source_refs");
  }
  const termHits = resolveTermHits(ctx);
  if (!termHits.ok) return denyEmpty(input, termHits.reason);

  const singleConnection = new Set(keys.map((k) => k.connectionId)).size === 1;
  const connected =
    keys.length <= 1 || !singleConnection
      ? true
      : joinConnected(keys, await loadDeclaredJoinEdges(keys));
  const decision = decideSourceSelection({ keys, termHits: termHits.hits, connected });

  if (decision.kind === "deny") {
    return denyWithCandidates(ctx, requestedRows(ctx, keys), decision.detail);
  }
  if (decision.kind === "allow") return { kind: "allow" };
  if (keys.length === 1 && hostConfirmedPin(ctx, keys[0]!)) return { kind: "allow" };

  const selection: SourceSelection = {
    status: "tolerated",
    reason: decision.reason,
    usedSources: [...keys],
    termHits: termHits.hits
  };
  await appendToleratedEvent({
    selection,
    tool: input.toolName,
    identityKey: input.identityKey,
    sessionId: input.sessionId
  });
  return { kind: "allow", selection };
}

/** SC-21：O2＝否 — read_source 不纳入本门闩。 */
export function sourceAmbiguityGateAppliesToTool(
  toolName: string
): toolName is "lucy_query" | "lucy_explain_query" {
  return toolName === "lucy_query" || toolName === "lucy_explain_query";
}
