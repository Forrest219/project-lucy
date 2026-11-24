/**
 * Connection-scoped sourceName registry and deterministic allocation (P1-64 / REQ-030-085).
 * Uniqueness matches ACL normalize rules; allocation never renames other Manifests.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveContentPaths } from "./paths";

/** Same rules as ACL `normalizeRef`: trim, strip backticks/quotes, lower-case. */
export function normalizeSourceRef(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

export type SchemaManifestSnapshot = {
  schema: string;
  targetPath: string;
  tables: Record<string, { table: string }>;
};

export type ConnectionSourceRegistry = {
  connectionId: string;
  manifests: SchemaManifestSnapshot[];
};

export type SourceManifestEntry = {
  targetPath: string;
  schema: string;
  physicalTable: string;
  sourceName: string;
};

export type SourceNameConflict = {
  sourceName: string;
  entries: SourceManifestEntry[];
};

export type CandidateManifestReplace = {
  schema: string;
  content: string;
};

export class SourceNameRegistryError extends Error {
  code: "REGISTRY_READ_FAILED";
  target?: string;

  constructor(message: string, target?: string) {
    super(message);
    this.name = "SourceNameRegistryError";
    this.code = "REGISTRY_READ_FAILED";
    if (target !== undefined) this.target = target;
  }
}

/** Bare physical table name from `schema.table` or a bare identifier. */
export function physicalTableBareName(physicalTable: string): string {
  // Physical identifiers can be case-sensitive (e.g. MySQL on Linux). Only
  // semantic-name occupancy uses normalizeSourceRef; Map keys keep real case.
  const identifier = physicalTable.trim().replace(/[`"']/g, "");
  const dot = identifier.lastIndexOf(".");
  return dot >= 0 ? identifier.slice(dot + 1) : identifier;
}

function schemaManifestRelPath(connectionId: string, schema: string): string {
  return `${connectionId}/_schema/${schema}.yaml`;
}

function parseManifestTables(
  content: string,
  targetPath: string
): Record<string, { table: string }> {
  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SourceNameRegistryError(
      `无法解析 Schema Manifest「${targetPath}」：${detail}`,
      targetPath
    );
  }
  if (parsed == null || typeof parsed !== "object") {
    return {};
  }
  const tablesRaw = (parsed as { tables?: unknown }).tables;
  if (tablesRaw == null) return {};
  if (typeof tablesRaw !== "object" || Array.isArray(tablesRaw)) {
    throw new SourceNameRegistryError(
      `Schema Manifest「${targetPath}」的 tables 不是对象。`,
      targetPath
    );
  }
  const tables: Record<string, { table: string }> = {};
  for (const [sourceName, def] of Object.entries(tablesRaw as Record<string, unknown>)) {
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const table = (def as { table?: unknown }).table;
    if (typeof table !== "string" || !table.trim()) continue;
    tables[sourceName] = { table };
  }
  return tables;
}

/**
 * Read all `_schema/*.yaml` Manifests for one Connection.
 * `candidate` replaces the target schema file (does not stack on the old target).
 * Fail-closed: directory list failures (except missing dir) and any existing
 * Manifest read/parse failure throw — never return an empty registry as “no conflict”.
 */
export async function readConnectionSourceManifests(
  projectRoot: string,
  connectionId: string,
  candidate?: CandidateManifestReplace
): Promise<ConnectionSourceRegistry> {
  const paths = await resolveContentPaths(projectRoot);
  const schemaDir = path.join(paths.semanticLayer, connectionId, "_schema");
  let names: string[];
  try {
    names = await readdir(schemaDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      names = [];
    } else {
      throw new SourceNameRegistryError(
        `无法列举 Connection「${connectionId}」的 Schema Manifest 目录：${
          error instanceof Error ? error.message : String(error)
        }`,
        schemaDir
      );
    }
  }

  const yamlFiles = names
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort((a, b) => a.localeCompare(b));

  const candidateSchema = candidate
    ? normalizeSourceRef(candidate.schema)
    : undefined;
  const manifests: SchemaManifestSnapshot[] = [];

  for (const fileName of yamlFiles) {
    const schema = fileName.replace(/\.ya?ml$/i, "");
    const targetPath = schemaManifestRelPath(connectionId, schema);
    if (candidateSchema && normalizeSourceRef(schema) === candidateSchema) {
      continue;
    }
    const abs = path.join(schemaDir, fileName);
    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch (error) {
      throw new SourceNameRegistryError(
        `无法读取 Schema Manifest「${targetPath}」：${
          error instanceof Error ? error.message : String(error)
        }`,
        targetPath
      );
    }
    manifests.push({
      schema,
      targetPath,
      tables: parseManifestTables(content, targetPath)
    });
  }

  if (candidate) {
    const targetPath = schemaManifestRelPath(connectionId, candidate.schema);
    manifests.push({
      schema: candidate.schema,
      targetPath,
      tables: parseManifestTables(candidate.content, targetPath)
    });
  }

  manifests.sort((a, b) => a.schema.localeCompare(b.schema));
  return { connectionId, manifests };
}

function reservedSourceNames(
  registry: ConnectionSourceRegistry,
  targetSchema: string
): Set<string> {
  const target = normalizeSourceRef(targetSchema);
  const reserved = new Set<string>();
  for (const manifest of registry.manifests) {
    if (normalizeSourceRef(manifest.schema) === target) continue;
    for (const sourceName of Object.keys(manifest.tables)) {
      const normalized = normalizeSourceRef(sourceName);
      if (normalized) reserved.add(normalized);
    }
  }
  return reserved;
}

function existingByPhysical(
  registry: ConnectionSourceRegistry,
  targetSchema: string
): Map<string, string> {
  const target = normalizeSourceRef(targetSchema);
  const map = new Map<string, string>();
  const manifest = registry.manifests.find(
    (item) => normalizeSourceRef(item.schema) === target
  );
  if (!manifest) return map;
  for (const [sourceName, def] of Object.entries(manifest.tables)) {
    const bare = physicalTableBareName(def.table);
    if (!bare) continue;
    // First mapping wins; allocation input is unique bare names.
    if (!map.has(bare)) map.set(bare, sourceName);
  }
  return map;
}

function firstAvailable(base: string, used: Set<string>): string {
  const normalizedBase = normalizeSourceRef(base);
  if (!used.has(normalizedBase)) return base;
  let n = 2;
  while (true) {
    const candidate = `${base}_${n}`;
    if (!used.has(normalizeSourceRef(candidate))) return candidate;
    n += 1;
  }
}

/**
 * Deterministic short-name allocation for one Schema scan (Spec D1–D4).
 * Returns Map of bare physical table → sourceName (YAML key).
 */
export function allocateSourceNames(
  schema: string,
  physicalTables: string[],
  registry: ConnectionSourceRegistry
): Map<string, string> {
  const reserved = reservedSourceNames(registry, schema);
  const existing = existingByPhysical(registry, schema);
  const used = new Set(reserved);
  const result = new Map<string, string>();

  const uniqueBare = [
    ...new Set(
      physicalTables
        .map((table) => physicalTableBareName(table))
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  // Reserve the complete set of valid old mappings first. Otherwise a newly
  // discovered physical table sorting before its old alias owner can steal
  // that alias, silently changing the source of existing queries.
  const oldClaims = new Map<string, string[]>();
  for (const bare of uniqueBare) {
    const old = existing.get(bare);
    if (old === undefined) continue;
    const normalized = normalizeSourceRef(old);
    if (!normalized || reserved.has(normalized)) continue;
    const owners = oldClaims.get(normalized) ?? [];
    owners.push(bare);
    oldClaims.set(normalized, owners);
  }
  for (const [normalized, owners] of oldClaims) {
    if (owners.length !== 1) continue; // An already ambiguous mapping is not valid.
    const bare = owners[0]!;
    result.set(bare, existing.get(bare)!);
    used.add(normalized);
  }

  for (const bare of uniqueBare) {
    if (result.has(bare)) continue;
    const candidate = !used.has(normalizeSourceRef(bare))
      ? bare
      : firstAvailable(`${schema}_${bare}`, used);
    result.set(bare, candidate);
    used.add(normalizeSourceRef(candidate));
  }
  return result;
}

/** Flatten registry manifests into Source Map style entries. */
export function flattenRegistryEntries(
  registry: ConnectionSourceRegistry
): SourceManifestEntry[] {
  const entries: SourceManifestEntry[] = [];
  for (const manifest of registry.manifests) {
    for (const [sourceName, def] of Object.entries(manifest.tables)) {
      entries.push({
        targetPath: manifest.targetPath,
        schema: manifest.schema,
        physicalTable: def.table,
        sourceName
      });
    }
  }
  return entries;
}

/**
 * Group entries by normalized sourceName; return groups with more than one entry.
 */
export function findSourceNameConflicts(
  entries: SourceManifestEntry[]
): SourceNameConflict[] {
  const groups = new Map<string, SourceManifestEntry[]>();
  for (const entry of entries) {
    const key = normalizeSourceRef(entry.sourceName);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([sourceName, group]) => ({ sourceName, entries: group }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}
