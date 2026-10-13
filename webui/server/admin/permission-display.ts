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
  resolveEffectivePermissionsBatchForAdmin,
  runtimeConsistencyFor,
  type AdminPermissionContext,
  type RoleResolutionResult
} from "../proxy/acl.js";
import { parseAccessConfigText, resolveAccessConfigPath, type AccessConfig } from "../proxy/identity.js";
import { countEntryPerf } from "../entry-performance-timing.js";

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

export type RuntimeConsistency = "matched" | "unconfirmed";
export type CountState = "ok" | "partial" | "unavailable";

export type PermissionBatch = {
  results: Map<string, RoleResolutionResult>;
  context: AdminPermissionContext | null;
  problem?: AccessSnapshot["problem"];
  runtimeConsistency: RuntimeConsistency;
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
    return { results: new Map(), context: null, problem: snapshot.problem, runtimeConsistency: "unconfirmed" };
  }
  const context = await buildAdminPermissionContext(snapshot.runtimeConfig);
  const results = await resolveEffectivePermissionsBatchForAdmin(userIds, context);
  return { results, context, runtimeConsistency: runtimeConsistencyFor(context) };
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
