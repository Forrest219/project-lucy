/**
 * P0-1 问题类型口径绑定 — 注册表（加载／校验／提交／恢复）。
 *
 * 权威来源＝**内容根**的 `caliber-bindings/<bindingId>.yaml`（D1／D2）。
 * 绑定资产**不**进 KTX 内容镜像（`CONTENT_DIR_NAMES` 不含 `caliber-bindings`），
 * **不**从项目根 sibling 旧副本回退读取，也**不以** KTX reindex／catalog reload／
 * daemon 重启成功代替绑定加载成功（O1 §4.1①）。
 *
 * 提交模型（O1 §4.1②）：
 *   ① 原子持久化 `activeGeneration` 提交凭据（指向完整注册表快照与消费回执）
 *      —— 候选 `prepared` **不**构成 committed；
 *   ② 切换内存注册表 generation（这才是新旅程可见的生效点）；
 *   ③ 以同一凭据完成基线及终态登记。
 *
 * 恢复（O1 §4.1⑥）：以持久化的提交凭据为权威。凭据已提交且引用完整 → 恢复同一
 * generation 并幂等补齐未完成登记；只有 prepared、凭据缺失或引用不完整 → 拒绝
 * 新 begin。**不**把当前作者目录自动视为已发布。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { CALIBER_BINDINGS_DIR_NAME, caliberBindingsPath, loadContentPaths } from "../paths.js";
import {
  currentSourceMapCompileError,
  currentSourceMapVersion,
  loadSourceMapSnapshot,
  resolveCanonicalSourceKey,
  type CanonicalSourceKey
} from "./acl.js";
import { normalizeCaliberFieldKeyForSource, validateCaliberTrigger } from "./caliber-binding-text.js";
import type { BoundCaliber } from "./caliber-binding-session.js";

export { CALIBER_BINDINGS_DIR_NAME };

/** 发布种类（O1 §4.1①）——一等发布种类，不进 KTX 镜像。 */
export const CALIBER_BINDING_SEMANTIC_KIND = "caliber_binding" as const;

export interface CaliberBindingAsset {
  bindingId: string;
  title: string;
  status: "draft" | "published";
  /** 原始触发词（资产里的写法）。 */
  triggers: string[];
  /** `N(t)` 规范化后的触发词；同绑定内去重。 */
  normalizedTriggers: string[];
  connectionId: string;
  /** 逻辑 sourceName。 */
  source: string;
  /** 加载时固化的规范源键（D3）。查询**不得**按 bindingId 热读资产重解析。 */
  boundKey: CanonicalSourceKey;
  caliber: BoundCaliber;
  /** 内容根相对路径（诊断用）。 */
  relativePath: string;
  /** 该资产正文的 sha256（内容核验用）。 */
  contentHash: string;
}

export interface RegistryReceipt {
  consumer: string;
  digest: string;
  fileCount: number;
}

export interface CaliberBindingRegistry {
  generation: number;
  /** 仅 `published` 资产参与匹配与门禁。 */
  bindings: Map<string, CaliberBindingAsset>;
  /** 全部候选文件的内容摘要（发布核验用）。 */
  digest: string;
  sourceMapVersion: string;
  fileCount: number;
  loadedAt: number;
  receipts: RegistryReceipt[];
}

export interface RegistryCredential {
  phase: "prepared" | "committed";
  generation: number;
  releaseId: string;
  attemptId: string;
  digest: string;
  sourceMapVersion: string;
  fileCount: number;
  receipts: RegistryReceipt[];
  preparedAt: string;
  committedAt?: string;
}

export type RegistryLoadFailure =
  | "content_read_failed"
  | "yaml_parse_failed"
  | "schema_invalid"
  | "duplicate_binding_id"
  | "trigger_invalid"
  | "bound_key_unresolved"
  | "scan_truncated"
  | "source_map_compile_failed";

export interface RegistryCandidateOk {
  ok: true;
  registry: Omit<CaliberBindingRegistry, "generation">;
}

export interface RegistryCandidateFailure {
  ok: false;
  reason: RegistryLoadFailure;
  detail: string;
  logicalPath?: string;
}

export type RegistryCandidate = RegistryCandidateOk | RegistryCandidateFailure;

const CREDENTIAL_FILE = "active-generation.json";
const SCAN_FILE_LIMIT = 2000;

/** 可注入故障点（SC-17c／SC-30 的最小进程测用）。 */
export interface CaliberBindingFaultHooks {
  /** ① 之前 —— 模拟凭据持久化失败。 */
  beforeRegistryCredential?: () => void | Promise<void>;
  /** ① 之后、② 之前 —— 模拟「凭据已提交但内存切换前中断」。 */
  afterRegistryCredential?: () => void | Promise<void>;
  /** ② 之后、③ 之前 —— 模拟「内存切换后基线／终态登记失败」。 */
  afterRegistrySwitch?: () => void | Promise<void>;
}

let faultHooks: CaliberBindingFaultHooks = {};

export function setCaliberBindingFaultHooks(hooks: CaliberBindingFaultHooks): void {
  faultHooks = hooks;
}

export function resetCaliberBindingFaultHooks(): void {
  faultHooks = {};
}

interface RegistryState {
  /** 当前生效的注册表（内存 generation）。 */
  current: CaliberBindingRegistry | null;
  /** 同步未决 —— 未决期间不得放行新 begin。 */
  syncPending: boolean;
  /** 已持久化的提交凭据。 */
  credential: RegistryCredential | null;
  /** 终态登记是否完成（O1 §4.1②③）。 */
  terminalRecorded: boolean;
}

const state: RegistryState = {
  current: null,
  syncPending: false,
  credential: null,
  terminalRecorded: false
};

export function currentCaliberBindingRegistry(): CaliberBindingRegistry | null {
  return state.current;
}

export function currentRegistryCredential(): RegistryCredential | null {
  return state.credential;
}

export function registrySyncPending(): boolean {
  return state.syncPending;
}

/** 运维可见状态（O1 §4.1③「结构化错误＋运维可见状态」）。 */
export function caliberBindingRegistryStatus(): {
  usable: boolean;
  generation: number | null;
  syncPending: boolean;
  credentialPhase: "prepared" | "committed" | null;
  reason: string | null;
} {
  const credential = state.credential;
  if (state.syncPending) {
    return {
      usable: false,
      generation: state.current?.generation ?? null,
      syncPending: true,
      credentialPhase: credential?.phase ?? null,
      reason: "sync_pending"
    };
  }
  if (!credential) {
    return {
      usable: state.current !== null,
      generation: state.current?.generation ?? null,
      syncPending: false,
      credentialPhase: null,
      reason: state.current === null ? "no_credential" : null
    };
  }
  if (credential.phase !== "committed") {
    return {
      usable: false,
      generation: state.current?.generation ?? null,
      syncPending: false,
      credentialPhase: credential.phase,
      reason: "credential_prepared_only"
    };
  }
  if (!state.current) {
    return {
      usable: false,
      generation: credential.generation,
      syncPending: false,
      credentialPhase: credential.phase,
      reason: "committed_but_not_loaded"
    };
  }
  return {
    usable: true,
    generation: state.current.generation,
    syncPending: false,
    credentialPhase: credential.phase,
    reason: null
  };
}

/** 内容根下的绑定目录绝对路径。 */
export async function caliberBindingsDir(): Promise<string> {
  const paths = await loadContentPaths();
  return caliberBindingsPath(paths);
}

async function credentialPath(): Promise<string> {
  const dir = await caliberBindingsDir();
  return path.join(dir, ".caliber-binding", CREDENTIAL_FILE);
}

async function readCredential(): Promise<RegistryCredential | null> {
  const file = await credentialPath();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as RegistryCredential;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCredential(credential: RegistryCredential): Promise<void> {
  const file = await credentialPath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(credential), { encoding: "utf8" });
  await rename(tmp, file);
}

// ─── 候选加载 ────────────────────────────────────────────────────────────────

type ParseResult<T> = { ok: true; value: T } | { ok: false; failure: RegistryCandidateFailure };

function asStringArray(
  value: unknown,
  field: string,
  logicalPath: string
): ParseResult<string[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return {
      ok: false,
      failure: { ok: false, reason: "schema_invalid", detail: `${field}_must_be_array`, logicalPath }
    };
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return {
        ok: false,
        failure: { ok: false, reason: "schema_invalid", detail: `${field}_must_be_strings`, logicalPath }
      };
    }
    out.push(item.trim());
  }
  return { ok: true, value: out };
}

function parseCaliber(raw: unknown, logicalPath: string): ParseResult<BoundCaliber> {
  if (raw === undefined || raw === null) {
    return {
      ok: false,
      failure: { ok: false, reason: "schema_invalid", detail: "caliber_required", logicalPath }
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      failure: { ok: false, reason: "schema_invalid", detail: "caliber_must_be_object", logicalPath }
    };
  }
  const record = raw as Record<string, unknown>;
  const measures = asStringArray(record.measures, "caliber.measures", logicalPath);
  if (!measures.ok) return measures;
  const dimensions = asStringArray(record.dimensions, "caliber.dimensions", logicalPath);
  if (!dimensions.ok) return dimensions;
  const segments = asStringArray(record.segments, "caliber.segments", logicalPath);
  if (!segments.ok) return segments;
  const filterFields = asStringArray(record.filterFields, "caliber.filterFields", logicalPath);
  if (!filterFields.ok) return filterFields;
  const requireMeasures = asStringArray(record.requireMeasures, "caliber.requireMeasures", logicalPath);
  if (!requireMeasures.ok) return requireMeasures;
  return {
    ok: true,
    value: {
      measures: measures.value,
      dimensions: dimensions.value,
      segments: segments.value,
      filterFields: filterFields.value,
      requireMeasures: requireMeasures.value
    }
  };
}

/**
 * D7 ⑤ —— 把口径集合的字段键归一到逻辑 sourceName。允许集与请求侧用同一套
 * 归一规则，物理表别名与逻辑名才可比（SC-26）。
 */
function normalizeCaliberForBoundKey(caliber: BoundCaliber, boundKey: CanonicalSourceKey): BoundCaliber {
  const map = (values: string[]) => values.map((value) => normalizeCaliberFieldKeyForSource(value, boundKey));
  return {
    measures: map(caliber.measures),
    dimensions: map(caliber.dimensions),
    segments: map(caliber.segments),
    filterFields: map(caliber.filterFields),
    requireMeasures: map(caliber.requireMeasures)
  };
}

/**
 * 读取并校验候选注册表。
 *
 * **不**切换生效 generation —— 只有 {@link commitCaliberBindingRegistry} 会。
 * 任何一条资产校验失败 → 整个候选失败（不得转换为「空注册表放行」）。
 */
export async function loadCaliberBindingCandidate(): Promise<RegistryCandidate> {
  const dir = await caliberBindingsDir();

  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // 有效空目录 —— 与「读取失败」必须区分（O1 §4.1④）。
      return {
        ok: true,
        registry: {
          bindings: new Map(),
          digest: createHash("sha256").update("[]").digest("hex"),
          sourceMapVersion: "",
          fileCount: 0,
          loadedAt: Date.now(),
          receipts: []
        }
      };
    }
    return { ok: false, reason: "content_read_failed", detail: code ?? "unknown" };
  }

  if (entries.length > SCAN_FILE_LIMIT) {
    return { ok: false, reason: "scan_truncated", detail: `file_limit:${SCAN_FILE_LIMIT}` };
  }

  // 一次装载只重建一次 sourceMap：版本、编译错误与每条资产的 `boundKey` 都用
  // 这一份，避免同一轮里出现「版本与解析依据不同源」的窗口。
  const sourceMap = await loadSourceMapSnapshot({ fresh: true });
  const compileError = await currentSourceMapCompileError({ sourceMap });
  if (compileError) {
    return { ok: false, reason: "source_map_compile_failed", detail: compileError };
  }

  const bindings = new Map<string, CaliberBindingAsset>();
  const digestParts: string[] = [];

  for (const name of entries) {
    const absolute = path.join(dir, name);
    const relativePath = `${CALIBER_BINDINGS_DIR_NAME}/${name}`;
    let raw: string;
    try {
      raw = await readFile(absolute, "utf8");
    } catch (err) {
      return {
        ok: false,
        reason: "content_read_failed",
        detail: (err as NodeJS.ErrnoException).code ?? "unknown",
        logicalPath: relativePath
      };
    }
    const contentHash = createHash("sha256").update(raw).digest("hex");
    digestParts.push(`${name}:${contentHash}`);

    let parsed: unknown;
    try {
      parsed = parse(raw);
    } catch (err) {
      return {
        ok: false,
        reason: "yaml_parse_failed",
        detail: err instanceof Error ? err.message : "parse_failed",
        logicalPath: relativePath
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "schema_invalid", detail: "root_must_be_object", logicalPath: relativePath };
    }
    const record = parsed as Record<string, unknown>;

    const bindingId = typeof record.bindingId === "string" ? record.bindingId.trim() : "";
    if (!bindingId) {
      return { ok: false, reason: "schema_invalid", detail: "bindingId_required", logicalPath: relativePath };
    }
    if (bindings.has(bindingId)) {
      return {
        ok: false,
        reason: "duplicate_binding_id",
        detail: bindingId,
        logicalPath: relativePath
      };
    }
    const status = record.status === "published" ? "published" : record.status === "draft" ? "draft" : null;
    if (!status) {
      return { ok: false, reason: "schema_invalid", detail: "status_invalid", logicalPath: relativePath };
    }
    const connectionId = typeof record.connectionId === "string" ? record.connectionId.trim() : "";
    if (!connectionId) {
      return { ok: false, reason: "schema_invalid", detail: "connectionId_required", logicalPath: relativePath };
    }
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (!source) {
      return { ok: false, reason: "schema_invalid", detail: "source_required", logicalPath: relativePath };
    }

    // O2 §4.2④ —— 触发词校验。非法触发词 → 候选发布失败，**不得静默丢弃**。
    const rawTriggers = record.triggers;
    if (rawTriggers !== undefined && rawTriggers !== null && !Array.isArray(rawTriggers)) {
      return { ok: false, reason: "schema_invalid", detail: "triggers_must_be_array", logicalPath: relativePath };
    }
    const normalizedTriggers: string[] = [];
    const triggers: string[] = [];
    for (const trigger of (rawTriggers as unknown[] | undefined) ?? []) {
      const checked = validateCaliberTrigger(trigger);
      if (!checked.ok) {
        return {
          ok: false,
          reason: "trigger_invalid",
          detail: `${checked.reason}:${String(trigger)}`,
          logicalPath: relativePath
        };
      }
      triggers.push(trigger as string);
      if (!normalizedTriggers.includes(checked.normalized)) normalizedTriggers.push(checked.normalized);
    }

    const caliber = parseCaliber(record.caliber, relativePath);
    if (!caliber.ok) return caliber.failure;

    // O1 §4.1⑧ —— 加载校验：`(connectionId, source)` → `boundKey`；失败 → 该资产
    // 拒绝进入 published 候选。draft 不参与，故不做解析。
    if (status !== "published") {
      continue;
    }
    const boundKey = await resolveCanonicalSourceKey(connectionId, source, { sourceMap });
    if (!boundKey) {
      return {
        ok: false,
        reason: "bound_key_unresolved",
        detail: `${connectionId}/${source}`,
        logicalPath: relativePath
      };
    }

    bindings.set(bindingId, {
      bindingId,
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : bindingId,
      status,
      triggers,
      normalizedTriggers,
      connectionId,
      source,
      boundKey,
      caliber: normalizeCaliberForBoundKey(caliber.value, boundKey),
      relativePath,
      contentHash
    });
  }

  const digest = createHash("sha256").update(digestParts.sort().join("\n")).digest("hex");
  return {
    ok: true,
    registry: {
      bindings,
      digest,
      sourceMapVersion: await currentSourceMapVersion({ sourceMap }),
      fileCount: entries.length,
      loadedAt: Date.now(),
      receipts: []
    }
  };
}

/**
 * 提交候选注册表（O1 §4.1②）。
 *
 * 顺序固定：① 原子持久化提交凭据 → ② 切换内存 generation → ③ 完成终态登记。
 * 任一步失败 → 保留未决，**不得**以旧注册表恢复新 begin 服务。
 */
export async function commitCaliberBindingRegistry(
  candidate: RegistryCandidateOk,
  input: { releaseId: string; attemptId: string; receipts?: RegistryReceipt[] }
): Promise<{ ok: true; generation: number } | { ok: false; reason: string }> {
  const receipts = input.receipts ?? [{
    consumer: "lucy_mcp_proxy",
    digest: candidate.registry.digest,
    fileCount: candidate.registry.fileCount
  }];
  const generation = (state.credential?.generation ?? 0) + 1;
  const prepared: RegistryCredential = {
    phase: "prepared",
    generation,
    releaseId: input.releaseId,
    attemptId: input.attemptId,
    digest: candidate.registry.digest,
    sourceMapVersion: candidate.registry.sourceMapVersion,
    fileCount: candidate.registry.fileCount,
    receipts,
    preparedAt: new Date().toISOString()
  };

  state.syncPending = true;
  try {
    // ① 原子持久化提交凭据。候选 prepared 不构成 committed。
    await faultHooks.beforeRegistryCredential?.();
    await writeCredential(prepared);
    await faultHooks.afterRegistryCredential?.();
    const committed: RegistryCredential = {
      ...prepared,
      phase: "committed",
      committedAt: new Date().toISOString()
    };
    await writeCredential(committed);
    state.credential = committed;

    // ② 切换内存注册表 generation —— 新旅程可见的生效点。
    state.current = {
      generation,
      bindings: candidate.registry.bindings,
      digest: candidate.registry.digest,
      sourceMapVersion: candidate.registry.sourceMapVersion,
      fileCount: candidate.registry.fileCount,
      loadedAt: candidate.registry.loadedAt,
      receipts
    };
    await faultHooks.afterRegistrySwitch?.();

    // ③ 以同一凭据完成终态登记。
    state.terminalRecorded = true;
    state.syncPending = false;
    return { ok: true, generation };
  } catch (err) {
    // 失败 → 保留未决；不得用旧注册表恢复新 begin 服务。
    state.syncPending = true;
    return { ok: false, reason: err instanceof Error ? err.message : "commit_failed" };
  }
}

/**
 * 启动／恢复（O1 §4.1⑥）。以持久化提交凭据为权威。
 *
 * - 凭据已提交且引用完整 → 恢复同一 generation（幂等补齐未完成登记）；
 * - 只有 prepared、凭据缺失或引用不完整 → 拒绝新 begin；
 * - 无历史且能证明未配置绑定 → 空注册表（可用）。
 */
export async function recoverCaliberBindingRegistry(): Promise<{
  usable: boolean;
  generation: number | null;
  reason: string | null;
}> {
  const credential = await readCredential();
  state.credential = credential;

  if (!credential) {
    const candidate = await loadCaliberBindingCandidate();
    if (!candidate.ok) {
      state.syncPending = true;
      return { usable: false, generation: null, reason: candidate.reason };
    }
    if (candidate.registry.fileCount === 0) {
      // 无历史且能证明未配置绑定 → 空注册表。
      state.current = {
        generation: 0,
        bindings: new Map(),
        digest: candidate.registry.digest,
        sourceMapVersion: candidate.registry.sourceMapVersion,
        fileCount: 0,
        loadedAt: candidate.registry.loadedAt,
        receipts: []
      };
      state.syncPending = false;
      return { usable: true, generation: 0, reason: null };
    }
    // 有候选但无提交证据 → 拒绝新 begin。
    state.syncPending = true;
    return { usable: false, generation: null, reason: "no_commit_evidence" };
  }

  if (credential.phase !== "committed") {
    state.syncPending = true;
    return { usable: false, generation: credential.generation, reason: "credential_prepared_only" };
  }

  // 引用完整性核验：当前内容摘要必须与已提交凭据一致。
  const candidate = await loadCaliberBindingCandidate();
  if (!candidate.ok) {
    state.syncPending = true;
    return { usable: false, generation: credential.generation, reason: candidate.reason };
  }
  if (candidate.registry.digest !== credential.digest) {
    state.syncPending = true;
    return { usable: false, generation: credential.generation, reason: "content_drift" };
  }
  if (candidate.registry.sourceMapVersion !== credential.sourceMapVersion) {
    state.syncPending = true;
    return { usable: false, generation: credential.generation, reason: "source_map_drift" };
  }

  state.current = {
    generation: credential.generation,
    bindings: candidate.registry.bindings,
    digest: credential.digest,
    sourceMapVersion: credential.sourceMapVersion,
    fileCount: credential.fileCount,
    loadedAt: candidate.registry.loadedAt,
    receipts: credential.receipts
  };
  state.syncPending = false;
  // 幂等补齐未完成登记。
  state.terminalRecorded = true;
  return { usable: true, generation: credential.generation, reason: null };
}

/**
 * O1 §4.1⑤ `verifyCurrentBindingContentAndDependencies`。
 *
 * 在注册表激活互斥区内复核：当前绑定文件集合＋内容摘要＋sourceMap 解析依赖。
 * **不得**把缓存命中、last-known-good 回退或跳过损坏文件视为本次核验成功。
 */
export async function verifyCurrentBindingContentAndDependencies(
  expectedGeneration: number
): Promise<{ complete: boolean; matchesCommitted: boolean; reason: string | null }> {
  const credential = state.credential;
  if (!credential) {
    // 无提交证据。只有「能证明未配置绑定」（内容目录里一个绑定资产都没有）时
    // 才是可用的空注册表（O1 §4.1⑥）；有候选但无提交证据 → 拒绝新 begin。
    const candidate = await loadCaliberBindingCandidate();
    if (!candidate.ok) {
      return { complete: false, matchesCommitted: false, reason: candidate.reason };
    }
    if (candidate.registry.fileCount === 0) {
      return { complete: true, matchesCommitted: true, reason: null };
    }
    return { complete: false, matchesCommitted: false, reason: "credential_missing" };
  }
  if (credential.phase !== "committed") {
    return { complete: false, matchesCommitted: false, reason: "credential_prepared_only" };
  }
  if (credential.generation !== expectedGeneration) {
    return { complete: false, matchesCommitted: false, reason: "generation_changed" };
  }
  const candidate = await loadCaliberBindingCandidate();
  if (!candidate.ok) {
    return { complete: false, matchesCommitted: false, reason: candidate.reason };
  }
  if (candidate.registry.digest !== credential.digest) {
    return { complete: true, matchesCommitted: false, reason: "content_drift" };
  }
  if (candidate.registry.sourceMapVersion !== credential.sourceMapVersion) {
    return { complete: true, matchesCommitted: false, reason: "source_map_drift" };
  }
  return { complete: true, matchesCommitted: true, reason: null };
}

/** 测试用：清空内存注册表状态。 */
export function resetCaliberBindingRegistryForTests(): void {
  state.current = null;
  state.syncPending = false;
  state.credential = null;
  state.terminalRecorded = false;
}

/** 测试用：删除已持久化的提交凭据。 */
export async function clearCaliberBindingCredential(): Promise<void> {
  const file = await credentialPath();
  await rm(file, { force: true });
}
