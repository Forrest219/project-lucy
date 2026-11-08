/**
 * P0-1 问题类型口径绑定 — BindingSession 权威存储（D5／D11）。
 *
 * 权威作用域＝`identityKey`＋`sessionId`（D5）。**不**使用审计 turn 的低置信
 * 推断作为门禁源；审计 turn 与本存储互不替代。
 *
 * 四态（D5）：
 * - `never_begun`      本作用域从未开题；
 * - `begun_no_hit`     已开题，本旅程未命中任何绑定；
 * - `begun_bound`      已开题且命中一条绑定，携带 begin 时的**深拷贝**快照；
 * - `lost_or_conflict` 状态不可靠（`commitPhase≠committed`、指针损坏、代次冲突、
 *                      过期应有却缺失、重启读到未完成提交）→ 查询侧一律
 *                      `caliber_binding_unresolved`，**禁止当 null 放行**。
 *
 * 预算关闭／legacy 不改变四态。
 *
 * 持久化：`commitPhase` 与快照一起落盘（D11）。`preparing` 记录代表一次未完成
 * 的提交；进程在 `preparing` 中断后重启读到它 → `lost_or_conflict`（SC-17c）。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import type { CanonicalSourceKey } from "./acl.js";

export type BindingSessionState =
  | "never_begun"
  | "begun_no_hit"
  | "begun_bound"
  | "lost_or_conflict";

export type BindingCommitPhase = "preparing" | "committed";

/**
 * Bound Caliber（Spec Terminology §「Bound Caliber」）。
 *
 * 首期**不含** grain／granularity（D9），也**不含**固定等值（O3 首期默认仅允许
 * 字段集）。
 */
export interface BoundCaliber {
  measures: string[];
  dimensions: string[];
  segments: string[];
  filterFields: string[];
  requireMeasures: string[];
}

export interface BindingSessionRecord {
  /** 本次开题的 turnId。 */
  turnId: string | null;
  /** BindingSession 代次（D5）。supersede 时递增。 */
  generation: number;
  /** D11 共同提交点。`committed` 才是权威可读状态。 */
  commitPhase: BindingCommitPhase | null;
  /** 命中的绑定 id；未命中为 null。 */
  bindingId: string | null;
  /** 资产加载时固化的规范源键。查询**不得**按 bindingId 热读资产重解析。 */
  boundKey: CanonicalSourceKey | null;
  /** begin 时深拷贝的口径快照。查询**禁止**热读资产。 */
  caliberSnapshot: BoundCaliber | null;
  /** begin 准备阶段记录的注册表代次（O1 §4.1⑤）。 */
  registryGeneration: number | null;
  updatedAt: string;
}

interface StoredSessionFile {
  scopeKey: string;
  /** 当前指针。`preparing` 表示提交未完成。 */
  current: BindingSessionRecord | null;
  /**
   * 上一次 `committed` 记录。D11「失败 begin → 旧 BindingSession 不变」：
   * 写 `preparing` 之前先把旧记录挪到这里，失败时原样写回。
   */
  previousCommitted: BindingSessionRecord | null;
  /**
   * 指针损坏（读失败／JSON 解析失败）。D5 把「指针损坏」列入
   * `lost_or_conflict` —— **不得**当成「从未开题」放行。
   */
  corrupt?: boolean;
}

const STATE_DIR_REL = path.join(".ktx-ui", "caliber-binding");
const SESSION_FILE_PREFIX = "session-";

let stateDirOverride: string | null = null;

/** 测试钩子：把状态目录指到临时目录。传 null 恢复默认。 */
export function setCaliberBindingStateDir(dir: string | null): void {
  stateDirOverride = dir;
}

async function stateDir(): Promise<string> {
  if (stateDirOverride) return stateDirOverride;
  return path.join(await resolveProjectRoot(), STATE_DIR_REL);
}

function sessionFilePath(base: string, scopeKey: string): string {
  const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
  return path.join(base, "sessions", `${SESSION_FILE_PREFIX}${digest}.json`);
}

/** 作用域键＝`identityKey`＋`sessionId`（D5）。空会话段用 `-`（与预算作用域键一致）。 */
export function bindingScopeKey(identityKey: string, sessionId: string | null | undefined): string {
  const session = sessionId && sessionId.length > 0 ? sessionId : "-";
  return `cb:${identityKey}:${session}`;
}

async function readStoredSession(base: string, scopeKey: string): Promise<StoredSessionFile | null> {
  const file = sessionFilePath(base, scopeKey);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // 读失败 → 指针损坏（`lost_or_conflict`），**不是**「从未开题」。
    return { scopeKey, current: null, previousCommitted: null, corrupt: true };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSessionFile>;
    if (!parsed || typeof parsed !== "object") {
      return { scopeKey, current: null, previousCommitted: null, corrupt: true };
    }
    return {
      scopeKey,
      current: parsed.current ?? null,
      previousCommitted: parsed.previousCommitted ?? null
    };
  } catch {
    return { scopeKey, current: null, previousCommitted: null, corrupt: true };
  }
}

async function writeStoredSession(base: string, stored: StoredSessionFile): Promise<void> {
  const file = sessionFilePath(base, stored.scopeKey);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(stored), { encoding: "utf8" });
  await rename(tmp, file);
}

/** 深拷贝 —— begin 快照不得与注册表里的资产共享引用（D5）。 */
export function deepCopyCaliber(caliber: BoundCaliber): BoundCaliber {
  return {
    measures: [...caliber.measures],
    dimensions: [...caliber.dimensions],
    segments: [...caliber.segments],
    filterFields: [...caliber.filterFields],
    requireMeasures: [...caliber.requireMeasures]
  };
}

function deepCopyBoundKey(key: CanonicalSourceKey): CanonicalSourceKey {
  return {
    connectionId: key.connectionId,
    schema: key.schema,
    sourceName: key.sourceName,
    physicalTable: key.physicalTable
  };
}

/**
 * 读取本作用域的**已提交** BindingSession。
 *
 * 返回 `state` 与权威记录。四态判定：
 * - 无记录 → `never_begun`；
 * - `commitPhase !== "committed"`（含重启读到 `preparing`）→ `lost_or_conflict`；
 * - `committed` 且 `bindingId === null` → `begun_no_hit`；
 * - `committed` 且 `bindingId !== null` → `begun_bound`（指针损坏时降级为
 *   `lost_or_conflict`：`boundKey`／`caliberSnapshot` 缺失即不可信）。
 */
export async function readBindingSession(
  scopeKey: string
): Promise<{ state: BindingSessionState; record: BindingSessionRecord | null }> {
  const base = await stateDir();
  const stored = await readStoredSession(base, scopeKey);
  if (!stored) return { state: "never_begun", record: null };
  if (stored.corrupt) {
    // 指针损坏 → 不可信（D5）→ `lost_or_conflict`，禁止当 null 放行。
    return { state: "lost_or_conflict", record: null };
  }

  const current = stored.current;
  if (!current) {
    // 指针缺失但有旧提交记录 → 用旧记录；两者皆无 → 从未开题。
    const previous = stored.previousCommitted;
    if (!previous) return { state: "never_begun", record: null };
    return classifyRecord(previous);
  }
  if (current.commitPhase !== "committed") {
    return { state: "lost_or_conflict", record: current };
  }
  return classifyRecord(current);
}

function classifyRecord(record: BindingSessionRecord): { state: BindingSessionState; record: BindingSessionRecord | null } {
  if (record.bindingId === null) {
    return { state: "begun_no_hit", record };
  }
  if (!record.boundKey || !record.caliberSnapshot) {
    // 指针损坏 → 不可信，禁止当 null 放行。
    return { state: "lost_or_conflict", record };
  }
  if (typeof record.generation !== "number" || !Number.isFinite(record.generation)) {
    return { state: "lost_or_conflict", record };
  }
  return { state: "begun_bound", record };
}

/**
 * D11 ① 之前的 `preparing` 写入。旧记录挪到 `previousCommitted`，失败时用
 * {@link restorePriorBindingSession} 原样写回（旧 BindingSession 不变）。
 */
export async function beginBindingSessionPreparation(
  scopeKey: string,
  input: {
    turnId: string;
    registryGeneration: number;
    bindingId: string | null;
    boundKey: CanonicalSourceKey | null;
    caliberSnapshot: BoundCaliber | null;
  }
): Promise<void> {
  const base = await stateDir();
  const stored = (await readStoredSession(base, scopeKey)) ?? {
    scopeKey,
    current: null,
    previousCommitted: null
  };
  const prior = stored.current && stored.current.commitPhase === "committed"
    ? stored.current
    : stored.previousCommitted;
  await writeStoredSession(base, {
    scopeKey,
    previousCommitted: prior ?? null,
    current: {
      turnId: input.turnId,
      generation: (prior?.generation ?? 0) + 1,
      commitPhase: "preparing",
      bindingId: input.bindingId,
      boundKey: input.boundKey ? deepCopyBoundKey(input.boundKey) : null,
      caliberSnapshot: input.caliberSnapshot ? deepCopyCaliber(input.caliberSnapshot) : null,
      registryGeneration: input.registryGeneration,
      updatedAt: new Date().toISOString()
    }
  });
}

/**
 * D11 ④ —— 提交点。仅 ④ 成功后才标 `committed`；查询只读 `committed` 的已发布
 * 快照（读侧发布点＝④ 完成）。
 */
export async function commitBindingSession(
  scopeKey: string,
  input: {
    turnId: string;
    registryGeneration: number;
    bindingId: string | null;
    boundKey: CanonicalSourceKey | null;
    caliberSnapshot: BoundCaliber | null;
  }
): Promise<void> {
  const base = await stateDir();
  const stored = (await readStoredSession(base, scopeKey)) ?? {
    scopeKey,
    current: null,
    previousCommitted: null
  };
  const prior = stored.current && stored.current.commitPhase === "committed"
    ? stored.current
    : stored.previousCommitted;
  await writeStoredSession(base, {
    scopeKey,
    previousCommitted: prior ?? null,
    current: {
      turnId: input.turnId,
      generation: (prior?.generation ?? 0) + 1,
      commitPhase: "committed",
      bindingId: input.bindingId,
      boundKey: input.boundKey ? deepCopyBoundKey(input.boundKey) : null,
      caliberSnapshot: input.caliberSnapshot ? deepCopyCaliber(input.caliberSnapshot) : null,
      registryGeneration: input.registryGeneration,
      updatedAt: new Date().toISOString()
    }
  });
}

/**
 * D11「失败 begin（激活错／①②失败）→ 旧 BindingSession 不变」。
 *
 * 把 `previousCommitted` 原样写回；此前没有旧记录时删除本作用域记录，回到
 * `never_begun`。
 */
export async function restorePriorBindingSession(scopeKey: string): Promise<void> {
  const base = await stateDir();
  const stored = await readStoredSession(base, scopeKey);
  if (!stored) return;
  const prior = stored.previousCommitted;
  if (!prior) {
    await rm(sessionFilePath(base, scopeKey), { force: true });
    return;
  }
  await writeStoredSession(base, {
    scopeKey,
    previousCommitted: null,
    current: prior
  });
}

/** 测试与运维用：清掉本作用域记录。 */
export async function clearBindingSession(scopeKey: string): Promise<void> {
  const base = await stateDir();
  await rm(sessionFilePath(base, scopeKey), { force: true });
}
