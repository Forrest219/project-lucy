/**
 * Spec 174 §3.1 / §3.3 — Admin display permission batch.
 *
 * One access snapshot feeds the Agent list fields, version, permissions and
 * the catalog authorized-agent counts. Runtime authorization never reads
 * these results.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildAdminPermissionContext,
  compileRoleForAdmin,
  displayPolicyInputsOf,
  resolveEffectivePermissionsBatchForAdmin,
  resolveRoleIds,
  type AdminPermissionContext,
  type DisplayPolicyInputs,
  type RoleResolutionResult
} from "../proxy/acl.js";
import { parseAccessConfigText, resolveAccessConfigPath, type AccessConfig } from "../proxy/identity.js";
import { countEntryPerf } from "../entry-performance-timing.js";
import type { YamlAccessConfig, YamlRole } from "./access-config.js";

export const ACCESS_YAML_REL = "webui/config/access.yaml";
export const ACCESS_PATH_MISMATCH = "access_config_path_mismatch";

export type AccessSnapshot = {
  adminPath: string;
  runtimePath: string;
  raw: string;
  version: string;
  /** Parsed runtime-equivalent config; null when unreadable or inconsistent. */
  runtimeConfig: AccessConfig | null;
  problem?: "access_unreadable" | "access_invalid" | typeof ACCESS_PATH_MISMATCH;
};

export type CountState = "ok" | "partial" | "unavailable";

export type PermissionBatch = {
  results: Map<string, RoleResolutionResult>;
  context: AdminPermissionContext | null;
  problem?: AccessSnapshot["problem"];
  /** Compile inputs for the response-time runtimeConsistency check; null when no context was built. */
  policyInputs: DisplayPolicyInputs | null;
};

function versionOf(raw: string, mtimeMs: number): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${mtimeMs.toFixed(0)}-${hash}`;
}

/** Read the Admin access file once and reconcile it with the runtime path. */
export async function readAccessSnapshot(projectRoot: string, raw?: string, version?: string): Promise<AccessSnapshot> {
  const adminPath = path.join(projectRoot, ACCESS_YAML_REL);
  const runtimePath = await resolveAccessConfigPath();
  let text = raw;
  let snapshotVersion = version ?? "";
  if (text === undefined) {
    try {
      text = await readFile(adminPath, "utf8");
      countEntryPerf("accessReads");
      snapshotVersion = versionOf(text, (await stat(adminPath)).mtimeMs);
    } catch {
      return { adminPath, runtimePath, raw: "", version: "", runtimeConfig: null, problem: "access_unreadable" };
    }
  }
  if (path.resolve(runtimePath) !== path.resolve(adminPath)) {
    let runtimeRaw: string;
    try {
      runtimeRaw = await readFile(runtimePath, "utf8");
      countEntryPerf("accessReads");
    } catch {
      return { adminPath, runtimePath, raw: text, version: snapshotVersion, runtimeConfig: null, problem: ACCESS_PATH_MISMATCH };
    }
    if (runtimeRaw !== text) {
      return { adminPath, runtimePath, raw: text, version: snapshotVersion, runtimeConfig: null, problem: ACCESS_PATH_MISMATCH };
    }
  }
  try {
    return { adminPath, runtimePath, raw: text, version: snapshotVersion, runtimeConfig: parseAccessConfigText(text) };
  } catch {
    return { adminPath, runtimePath, raw: text, version: snapshotVersion, runtimeConfig: null, problem: "access_invalid" };
  }
}

export async function resolvePermissionBatch(snapshot: AccessSnapshot, userIds: string[]): Promise<PermissionBatch> {
  if (!snapshot.runtimeConfig) {
    return { results: new Map(), context: null, problem: snapshot.problem, policyInputs: null };
  }
  const context = await buildAdminPermissionContext(snapshot.runtimeConfig);
  const results = await resolvePermissionBatchIncremental(userIds, context);
  return { results, context, policyInputs: displayPolicyInputsOf(context) };
}

// ─── REQ-0117 方向 1（委托人 2026-11-26 扩权本文件：展示快照重建缩面）────────
//
// 展示编译是输入的纯函数：单用户结果取决于「自身记录 + 其角色定义 + 全局输入
// （source map、启用表、工具分类、defaults）」。输入逐字未变的对象复用上次编译
// 结果（输出逐字一致），其余用户/角色正常编译。全局输入任一变化即整体失效。
// 夹具规模（530 Agent 含绑定 2000 表角色的 Agent）下，这把重建从 >10s（超过
// DISPLAY_BUILD_WAIT_BUDGET_MS，快照无限 pending）压回构建预算内；语义不变。

const displayCompileMemo = new Map<string, unknown>();
const DISPLAY_COMPILE_MEMO_CAP = 4096;

function displayCompileMemoKeyPrefix(context: AdminPermissionContext): string {
  const defaultsKey = stableJsonOf(context.config.defaults ?? null);
  return `${context.sourceMapVersion}\u0000${context.enabledTablesDigest}\u0000${context.toolClassificationVersion}\u0000${defaultsKey}`;
}

function stableJsonOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonOf).join(",")}]`;
  if (value && typeof value === "object") {
    const out: string[] = [];
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out.push(`${JSON.stringify(key)}:${stableJsonOf((value as Record<string, unknown>)[key])}`);
    }
    return `{${out.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function memoPut(key: string, value: unknown): void {
  if (displayCompileMemo.size >= DISPLAY_COMPILE_MEMO_CAP) {
    const oldest = displayCompileMemo.keys().next().value;
    if (oldest !== undefined) displayCompileMemo.delete(oldest);
  }
  displayCompileMemo.set(key, value);
}

/** Event-loop relief: yield between compile chunks so builds do not block in multi-second slices. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function resolvePermissionBatchIncremental(
  userIds: string[],
  context: AdminPermissionContext
): Promise<Map<string, RoleResolutionResult>> {
  const prefix = displayCompileMemoKeyPrefix(context);
  const roles = context.config.roles ?? {};
  const usersById = new Map((context.config.users ?? []).filter((user) => user?.id).map((user) => [user.id, user]));
  const keys = new Map<string, string>();
  const reusable = new Map<string, RoleResolutionResult>();
  const pending: string[] = [];
  for (const userId of userIds) {
    const user = usersById.get(userId);
    if (!user) continue;
    const roleList = resolveRoleIds(user);
    const roleDefs = roleList.ok ? roleList.roleIds.map((id) => roles[id] ?? null) : [];
    const key = `${prefix}\u0000user\u0000${userId}\u0000${stableJsonOf(user)}\u0000${stableJsonOf(roleDefs)}`;
    keys.set(userId, key);
    const cached = displayCompileMemo.get(key);
    if (cached !== undefined) reusable.set(userId, cached as RoleResolutionResult);
    else pending.push(userId);
  }
  const results = pending.length > 0
    ? await resolveEffectivePermissionsBatchForAdmin(pending, context)
    : new Map<string, RoleResolutionResult>();
  const merged = new Map<string, RoleResolutionResult>();
  let compiled = 0;
  for (const userId of userIds) {
    const reused = reusable.get(userId);
    if (reused) {
      merged.set(userId, reused);
      continue;
    }
    const fresh = results.get(userId);
    if (!fresh) continue;
    merged.set(userId, fresh);
    const key = keys.get(userId);
    if (key) memoPut(key, fresh);
    compiled += 1;
    if (compiled % 20 === 0) await yieldToEventLoop();
  }
  return merged;
}

type CountInput = { conn: string; schema: string; table: string };

export function sourceCountKey(conn: string, schema: string, table: string): string {
  return `${conn}\u0000${schema}\u0000${table}`;
}

/**
 * Counts enabled Agents whose permissions include each source.
 * ok: every enabled Agent resolved (zero enabled Agents is a definite 0);
 * partial: some enabled Agents failed; unavailable: access missing/invalid,
 * path mismatch, or every enabled Agent failed. Disabled Agents are skipped.
 */
export function authorizedCountsFromBatch(
  snapshot: AccessSnapshot,
  batch: PermissionBatch,
  enabledUserIds: string[],
  sources: CountInput[]
): { counts: Map<string, number>; state: CountState } {
  const counts = new Map<string, number>();
  for (const source of sources) counts.set(sourceCountKey(source.conn, source.schema, source.table), 0);
  if (!snapshot.runtimeConfig || !batch.context) return { counts, state: "unavailable" };
  if (enabledUserIds.length === 0) return { counts, state: "ok" };
  let failed = 0;
  for (const userId of enabledUserIds) {
    const resolved = batch.results.get(userId);
    if (!resolved || !resolved.ok) {
      failed += 1;
      continue;
    }
    for (const source of resolved.permissions.sources) {
      if (!source.connectionId) continue;
      const key = sourceCountKey(source.connectionId, source.schema, source.sourceName);
      if (!counts.has(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const state: CountState = failed === 0 ? "ok" : failed === enabledUserIds.length ? "unavailable" : "partial";
  return { counts, state };
}

export function enabledUserIdsFromRaw(snapshot: AccessSnapshot): string[] {
  const users = snapshot.runtimeConfig?.users ?? [];
  return users.filter((user) => user && typeof user.id === "string" && user.enabled !== false).map((user) => user.id);
}

export type RoleListDisplaySource = "yaml" | "template";

export type RoleListDisplayRow = {
  id: string;
  description?: string;
  source: RoleListDisplaySource;
  tools: string[];
  connections: string[];
  source_scope?: "catalog_bound";
  usageCount: number;
  users: Array<{ id: string; name?: string; enabled: boolean; tokenCount: number }>;
  sourceCount: number;
  sourceNames: string[];
  invalid: boolean;
  warnings: string[];
};

function sourceNamesFromCompilation(
  compiled: Awaited<ReturnType<typeof compileRoleForAdmin>>
): string[] {
  if (!compiled.ok || !compiled.sources) return [];
  return [
    ...new Set(
      compiled.sources.flatMap((source) => {
        const full = source.table;
        const short = full.includes(".") ? full.slice(full.lastIndexOf(".") + 1) : full;
        return [full, short, source.sourceName].filter(
          (item): item is string => typeof item === "string" && item.length > 0
        );
      })
    )
  ];
}

/**
 * Spec 174 / P1-58 §3.2 — one permission context compiles every list row. Runtime
 * authorization, dryRun and save paths must not read this output.
 *
 * REQ-0117 方向 1 — 角色行编译同样按输入缩面（记忆化）＋单遍用户索引＋分片让出，
 * 使大目录（含绑定 2000 表角色的行）重建不超构建预算、不长时间阻塞事件循环。
 * 输出与全量编译逐字一致。
 */
export async function compileAdminRoleListRows(
  listConfig: YamlAccessConfig,
  entries: Array<{ id: string; role: YamlRole; source: RoleListDisplaySource }>
): Promise<{ rows: RoleListDisplayRow[]; policyInputs: DisplayPolicyInputs | null }> {
  if (!listConfig) return { rows: [], policyInputs: null };
  const context = await buildAdminPermissionContext(listConfig as unknown as AccessConfig);
  const prefix = displayCompileMemoKeyPrefix(context);
  // 单遍用户索引：roleId → 引用它的 users（保持 config.users 顺序，与逐条 filter 等价）。
  const usersByRole = new Map<string, YamlAccessConfig["users"]>();
  for (const user of listConfig.users ?? []) {
    const resolved = resolveRoleIds(user);
    if (!resolved.ok) continue;
    for (const roleId of resolved.roleIds) {
      let list = usersByRole.get(roleId);
      if (!list) usersByRole.set(roleId, list = []);
      list.push(user);
    }
  }
  const rows: RoleListDisplayRow[] = [];
  let compiledCount = 0;
  type MemoRow = { ok: boolean; reason?: string; sources?: Array<{ table?: string; sourceName?: string }> };
  for (const entry of entries) {
    const key = `${prefix} role ${entry.id} ${stableJsonOf(entry.role ?? null)}`;
    let row = displayCompileMemo.get(key) as MemoRow | undefined;
    if (row === undefined) {
      const compiled = await compileRoleForAdmin(entry.id, context);
      row = compiled.ok
        ? { ok: true, sources: compiled.sources }
        : { ok: false, reason: compiled.reason };
      memoPut(key, row);
      compiledCount += 1;
      if (compiledCount % 20 === 0) await yieldToEventLoop();
    }
    const users = usersByRole.get(entry.id) ?? [];
    const allow = entry.role.allow;
    rows.push({
      id: entry.id,
      description: entry.role.description,
      source: entry.source,
      tools: allow?.tools ?? [],
      connections: allow?.connections ?? [],
      ...(allow?.source_scope ? { source_scope: allow.source_scope } : {}),
      usageCount: users.length,
      users: users.map((user) => ({
        id: user.id,
        name: user.name,
        enabled: user.enabled !== false,
        tokenCount: user.tokens?.length ?? 0
      })),
      sourceCount: row.ok ? (row.sources?.length ?? 0) : 0,
      sourceNames: row.ok ? sourceNamesFromCompilation(row as never) : [],
      invalid: !row.ok,
      warnings: row.ok ? [] : [row.reason ?? "role_resolution_failed"]
    });
  }
  return { rows, policyInputs: displayPolicyInputsOf(context) };
}
