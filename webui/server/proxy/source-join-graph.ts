/**
 * P1-35 v0.4 D12 — 语义层已声明 join 的连通判定（选表歧义门闩「档①放行」判据）。
 *
 * 只读 overlay（`semantic-layer/<conn>/<table>.yaml`）与 manifest（`_schema/<schema>.yaml`）
 * 中本次请求涉及来源自己声明的 `joins`；`source=candidate` 不算已声明；任一端声明即连通；
 * 连通性只在请求内的来源之间计算（不经未出现在请求里的中间表）。
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadContentPaths } from "../paths";
import type { SourceIdentity } from "./source-ambiguity-gate";

export type DeclaredJoinEdge = {
  connectionId: string;
  /** 声明方 sourceName（末段）。 */
  from: string;
  /** 对端 sourceName（可带 `schema.` 限定；无限定时视作与声明方同 schema）。 */
  to: string;
  /** 声明方所在 schema；缺省＝不按 schema 区分（仅纯函数夹具使用，磁盘读取一律带上）。 */
  fromSchema?: string;
};

function lastSegment(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
}

/** `schema.table` → schema；无限定或空 → null。 */
function qualifierOf(name: string): string | null {
  const parts = name.trim().split(".");
  return parts.length >= 2 ? parts[parts.length - 2]! || null : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formalJoinTargets(joins: unknown): string[] {
  if (!Array.isArray(joins)) return [];
  const out: string[] = [];
  for (const raw of joins) {
    const rec = asRecord(raw);
    if (typeof rec.to !== "string" || !rec.to.trim()) continue;
    if (rec.source === "candidate") continue;
    out.push(rec.to.trim());
  }
  return out;
}

async function readYamlRecord(file: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(parseYaml(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * 读取请求内来源各自声明的 join 边。读盘失败／缺文件＝无边（调用方落档②，不是错误）。
 */
export async function loadDeclaredJoinEdges(
  keys: readonly SourceIdentity[]
): Promise<DeclaredJoinEdge[]> {
  const edges: DeclaredJoinEdge[] = [];
  let base: string;
  try {
    base = (await loadContentPaths()).semanticLayer;
  } catch {
    return edges;
  }
  const seen = new Set<string>();
  const push = (connectionId: string, fromSchema: string, from: string, to: string) => {
    const id = `${connectionId}\0${fromSchema}\0${from}\0${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ connectionId, from, to, fromSchema });
  };
  for (const key of keys) {
    const from = lastSegment(key.sourceName);
    const connDir = path.join(base, key.connectionId);
    const overlay = await readYamlRecord(path.join(connDir, `${from}.yaml`));
    if (overlay) {
      for (const to of formalJoinTargets(overlay.joins)) push(key.connectionId, key.schema, from, to);
    }
    const manifest = await readYamlRecord(path.join(connDir, "_schema", `${key.schema}.yaml`));
    if (manifest) {
      const table = asRecord(asRecord(manifest.tables)[from]);
      for (const to of formalJoinTargets(table.joins)) push(key.connectionId, key.schema, from, to);
    }
  }
  return edges;
}

/** 请求内全部来源是否被已声明 join 连成一个整体（单来源恒真）。 */
export function joinConnected(
  keys: readonly SourceIdentity[],
  edges: readonly DeclaredJoinEdge[]
): boolean {
  if (keys.length <= 1) return true;
  // 节点＝完整身份（连接＋schema＋sourceName）：同名不同 schema 的表是两个节点，不得塌缩成一个。
  const nodeId = (k: SourceIdentity) => `${k.connectionId}\0${k.schema}\0${lastSegment(k.sourceName)}`;
  const nodes = new Map(keys.map((k) => [nodeId(k), k]));
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodes.keys()) adjacency.set(id, new Set());
  const matching = (connectionId: string, name: string, schema: string | null) =>
    [...nodes.entries()]
      .filter(
        ([, k]) =>
          k.connectionId === connectionId
          && lastSegment(k.sourceName) === lastSegment(name)
          && (schema === null || k.schema === schema)
      )
      .map(([id]) => id);
  for (const e of edges) {
    const fromSchema = e.fromSchema ?? null;
    const toSchema = qualifierOf(e.to) ?? fromSchema;
    for (const a of matching(e.connectionId, e.from, fromSchema)) {
      for (const b of matching(e.connectionId, e.to, toSchema)) {
        if (a === b) continue;
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      }
    }
  }
  const start = nodeId(keys[0]!);
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === nodes.size;
}
