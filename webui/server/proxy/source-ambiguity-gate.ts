/**
 * P0-3 表级歧义门闩（REQ-030-024）— 命中算法、分态、候选构造与门禁裁决。
 *
 * 权威合同：docs/specs/lucy-20261107-source-ambiguity-gate-spec.md v0.5
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

/** 多表命中先问 — instructions 事实源片段（D13）。 */
export const ASK_FIRST_SECTION = `## 问询范围确认／多表命中先问

- 问询**原文**里出现指代（"这个""上次那个""它"）或一句包含两个意图时，先复述账户、月份和产品线，等用户确认后再发 \`lucy_query\`。
- 没有用户原文的推断问询（例如从历史日志或工具报错反推出来的需求）跳过复述，直接按已确认范围查数。
- 当多个可见来源表都可能回答同一业务词时，必须先澄清选哪张表，再发 \`lucy_query\`／\`lucy_explain_query\`。
- 工具面可能返回表级歧义拒绝（\`source_ambiguity_gate\`）；须按候选完整身份经宿主确认后重试，不得自行挑选最高分表或静默换表。
- 指代／双意图的复述仍约束模型行为；表级选表由 Proxy 硬门闩执行，缺少可信确认时不会放行歧义查数。
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
  | { kind: "allow" }
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

export function buildRepairEvidenceForGate(input: {
  candidates: readonly AmbiguityCandidateRow[];
  permissions: Pick<EffectivePermissions, "sources" | "tools">;
  toolName: string;
  /** false → 全体 schemaExists=null。缺省亦为不可判定（无真实探测）。 */
  sourceMapReliable?: boolean;
}): Map<string, Omit<RepairTargetEvidence, "target">> {
  const visible = new Set(
    input.permissions.sources.map(
      (s) =>
        `${s.connectionId}|${s.schema}|${s.sourceName}|${s.table}`
    )
  );
  const callable = input.permissions.tools.includes(input.toolName);
  const out = new Map<string, Omit<RepairTargetEvidence, "target">>();
  for (const c of input.candidates) {
    const key = repairEvidenceIdentityKey(c.sourceKey);
    const isVisible = visible.has(key);
    out.set(key, {
      // 无独立 schema／编译探测入口时不得用可见性冒充
      schemaExists: null,
      visibleToPrincipal: isVisible,
      compiled: false,
      parameterShapeValid: false,
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

function denialPayload(
  candidates: AmbiguityCandidateRow[],
  repair: RepairClosure,
  detail?: string,
  fieldAmbiguity?: SourceAmbiguityDenial["fieldAmbiguity"]
): SourceAmbiguityDenial {
  return {
    reason: SOURCE_AMBIGUITY_GATE,
    failureDimension: SOURCE_AMBIGUITY_FAILURE_DIMENSION,
    message: SOURCE_AMBIGUITY_MESSAGE,
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
   * 五项证据覆盖。缺省走 `buildRepairEvidenceForGate`（基于 permissions）；
   * 未传入且不想用默认探测时显式传空 Map → fail-closed（不假装全绿）。
   */
  repairEvidenceByName?: ReadonlyMap<string, Omit<RepairTargetEvidence, "target">>;
  /** 与 repairEvidenceByName 联用：sourceMap 不可靠时 schemaExists=null。 */
  sourceMapReliable?: boolean;
  fieldAmbiguity?: { field: string; repair: string } | null;
};

/**
 * 表级歧义门闩主入口。须在 ACL 通过后、上游／explain 成功体前调用。
 */
export async function checkSourceAmbiguityGate(
  input: CheckSourceAmbiguityGateInput
): Promise<SourceAmbiguityGateOutcome> {
  const bindingScope = bindingScopeKey(input.identityKey, input.sessionId);
  const session = await readBindingSession(bindingScope);
  const state = session.state;

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
  const generation =
    session.record?.generation
    ?? (state === "never_begun" ? NEVER_BEGUN_GENERATION_SENTINEL : journey.generation);

  const termOutcome = resolveBusinessTermsByPriority({
    bindingState: state,
    args: input.args,
    journey
  });

  if (termOutcome.kind === "context_missing") {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, "need_begin_or_confirm", input.fieldAmbiguity)
    };
  }

  if (
    termOutcome.kind === "catalog_read_failure"
    || termOutcome.kind === "read_partial_indeterminate"
    || termOutcome.kind === "description_read_unreliable"
  ) {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, "catalog_unreliable", input.fieldAmbiguity)
    };
  }

  if (termOutcome.kind === "zero_hits") {
    return { kind: "allow" };
  }

  const sources =
    input.matchableSources
    ?? input.permissions.sources.map((s) => effectiveSourceToMatchable(s));

  const matchOutcome = matchVisibleSources(termOutcome.terms, sources, {
    catalogReadFailed: input.catalogReadFailed,
    catalogReadReason: input.catalogReadReason
  });

  if (
    matchOutcome.kind === "catalog_read_failure"
    || matchOutcome.kind === "description_read_unreliable"
    || matchOutcome.kind === "read_partial_indeterminate"
  ) {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, matchOutcome.reason, input.fieldAmbiguity)
    };
  }

  if (matchOutcome.kind === "zero_hits" || matchOutcome.hits.length < 2) {
    return { kind: "allow" };
  }

  // ≥2 命中 — 检查引用集合与确认
  const collected = await collectCanonicalSourceKeys(input.toolName, input.args);
  if (collected.unresolved.length > 0) {
    const emptyRepair = buildAmbiguityRepairClosure([]);
    return {
      kind: "deny",
      executed: false,
      denial: denialPayload([], emptyRepair, "unresolved_source_refs", input.fieldAmbiguity)
    };
  }

  const confirmedKey = journey.confirmedSourceKey;
  if (confirmedKey) {
    const inHits = matchOutcome.hits.some((h) => canonicalSourceKeyEquals(h, confirmedKey));
    const participation = verifyUserParticipationEvidence({
      journey,
      expectedGeneration: generation,
      confirmedKey
    });
    const singletonOk =
      collected.keys.length === 1
      && canonicalSourceKeyEquals(collected.keys[0]!, confirmedKey);
    if (inHits && participation.ok && singletonOk) {
      // 选表已确认；字段级护栏仍继续（由调用方）
      return { kind: "allow" };
    }
  }

  // 构造候选：可见 ∩ allow-list
  const allow = denialAllowList({
    connections: input.permissions.connections,
    sources: input.permissions.sources
  });
  const allowSet = new Set(allow.sources);
  const matchedRows = matchOutcome.matched
    .filter((m) => allowSet.has(m.sourceName || m.table))
    .map(toCandidateRow);

  const evidenceMap =
    input.repairEvidenceByName
    ?? buildRepairEvidenceForGate({
      candidates: matchedRows,
      permissions: {
        sources: input.permissions.sources,
        tools: input.permissions.tools ?? [input.toolName]
      },
      toolName: input.toolName,
      sourceMapReliable: input.sourceMapReliable
    });
  const evidences = toRepairTargetEvidence(matchedRows, evidenceMap);
  const closure = buildAmbiguityRepairClosure(evidences);

  await persistAmbiguityCandidateSnapshot({
    scopeKey: sagScope,
    generation,
    candidates: matchedRows.map((r) => r.sourceKey)
  });

  return {
    kind: "deny",
    executed: false,
    denial: denialPayload(matchedRows, closure, undefined, input.fieldAmbiguity)
  };
}

/** SC-21：O2＝否 — read_source 不纳入本门闩。 */
export function sourceAmbiguityGateAppliesToTool(
  toolName: string
): toolName is "lucy_query" | "lucy_explain_query" {
  return toolName === "lucy_query" || toolName === "lucy_explain_query";
}
