/**
 * Lucy v0.25 — semantic table identity resolution contract.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §4.1 (identity), §4.3 (dependency closure), §4.4 (read-only dependencies),
 * and the acceptance item V01 / V04.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * The pre-v0.25 code resolved "which table does this overlay belong to?" with
 * two heuristics:
 *
 *   1. `semantic-assets.ts` `manifestSchemaFromTables()` — pick the schema
 *      that appears most often inside `<schema>.<table>` strings.
 *   2. `semantic-asset-export.ts` — `normalized.includes(\`/${scopeSchema}.\`)`
 *      on a file path.
 *
 * Both guess. Neither is derived from the model, and both break as soon as a
 * schema or a table name contains the other as a substring. Spec §1.2 names
 * the first one explicitly as the thing to replace.
 *
 * ── The contract implemented here ───────────────────────────────────────────
 * Ownership is derived ONLY from the Schema Manifest model: a Schema Manifest
 * file `semantic-layer/<connection>/_schema/<schema>.yaml` declares
 * `tables: { <sourceName>: { table: "<schema>.<table>", ... } }`. The manifest
 * is the structure fact source (Spec §2); the semantic overlay is the
 * maintenance target. Therefore:
 *
 *   - The identity of a table is `{connectionId, schema, table}` where
 *     `connectionId` + `schema` come from the manifest that declares it and
 *     `table` is the manifest's source name (which is also the overlay file
 *     stem).
 *   - The physical name declared by the model (`table:`) is carried alongside
 *     as `qualifiedName` and is used to resolve join references.
 *   - Nothing is ever attributed by file name similarity.
 *
 * ── The collision this module must surface (V01) ───────────────────────────
 * An overlay file is `semantic-layer/<connection>/<sourceName>.yaml` — it has
 * NO schema dimension. Two schemas of the same connection that use the same
 * source name therefore share one physical file. Writing it changes both
 * tables. Spec §4.4 forbids silently widening the write scope: selecting one
 * of the two tables must be BLOCKED with the sibling listed, never written
 * "for both".
 *
 * Every unresolved or ambiguous situation is a hard error. This module never
 * picks a default connection, a default schema or a "most likely" candidate.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { ENABLED_TABLE_NAME_RE } from "../src/lib/enabled-table-identity.js";
import { resolveContentPaths } from "./paths";

/** The complete identity of one physical table. Never a bare table string. */
export interface SemanticTableIdentity {
  connectionId: string;
  schema: string;
  table: string;
}

export type SemanticIdentityErrorCode =
  | "IDENTITY_INVALID"
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_AMBIGUOUS"
  | "SHARED_WRITE_TARGET"
  | "DEPENDENCY_NOT_FOUND"
  | "DEPENDENCY_AMBIGUOUS"
  /** A model file exists but cannot be read or parsed — the model is incomplete, not empty. */
  | "SEMANTIC_MODEL_UNREADABLE";

export class SemanticIdentityError extends Error {
  readonly code: SemanticIdentityErrorCode;
  readonly statusCode = 409;
  /** Every identity involved in the failure — for a readable, actionable message. */
  readonly identities: SemanticTableIdentity[];

  constructor(
    code: SemanticIdentityErrorCode,
    message: string,
    identities: SemanticTableIdentity[] = []
  ) {
    super(message);
    this.name = "SemanticIdentityError";
    this.code = code;
    this.identities = identities;
  }
}

export function semanticIdentityKey(identity: SemanticTableIdentity): string {
  return `${identity.connectionId}/${identity.schema}/${identity.table}`;
}

export function formatSemanticIdentity(identity: SemanticTableIdentity): string {
  return semanticIdentityKey(identity);
}

export function compareSemanticIdentities(
  a: SemanticTableIdentity,
  b: SemanticTableIdentity
): number {
  return semanticIdentityKey(a).localeCompare(semanticIdentityKey(b));
}

/** Sort + de-duplicate a list of identities. The canonical order of a scope. */
export function sortUniqueSemanticIdentities(
  identities: readonly SemanticTableIdentity[]
): SemanticTableIdentity[] {
  const seen = new Map<string, SemanticTableIdentity>();
  for (const identity of identities) {
    const key = semanticIdentityKey(identity);
    if (!seen.has(key)) seen.set(key, { ...identity });
  }
  return [...seen.values()].sort(compareSemanticIdentities);
}

/** One table declared by a Schema Manifest. */
export interface SemanticIdentityEntry {
  identity: SemanticTableIdentity;
  /** The manifest's source name (the key inside `tables:`). */
  sourceName: string;
  /** The physical name declared by the model, e.g. `chatbi.orders`. */
  qualifiedName: string;
  /** Schema part of `qualifiedName`. */
  physicalSchema: string;
  /** Table part of `qualifiedName`. */
  physicalTable: string;
  /** Project-root-relative manifest path that declares this table. */
  manifestRelPath: string;
  /** Project-root-relative overlay path that carries this table's overlay. */
  overlayRelPath: string;
  /** Whether the overlay file currently exists on disk. */
  overlayExists: boolean;
  /** True when the manifest file's schema differs from the declared qualified name. */
  schemaMismatch: boolean;
}

/** The model-derived view of every table the project knows about. */
export interface SemanticModelIndex {
  entries: SemanticIdentityEntry[];
  /** Identity key -> entry. */
  byKey: Map<string, SemanticIdentityEntry>;
  /** `<schema>.<table>` -> every entry that declares it (across connections). */
  byQualifiedName: Map<string, SemanticIdentityEntry[]>;
  /** Overlay relative path -> identity keys that share that file. */
  overlayOwners: Map<string, string[]>;
  /** Connection ids present in the model. */
  connections: string[];
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Split a physical object name.
 * Two parts: `schema.table`. Three parts: `database.schema.table`
 * (`schema` is everything except the last segment). One or four parts return null.
 */
export function parseQualifiedTable(value: string): { schema: string; table: string } | null {
  const trimmed = value.trim();
  if (!ENABLED_TABLE_NAME_RE.test(trimmed)) return null;
  const parts = trimmed.split(".");
  const table = parts[parts.length - 1];
  if (!table) return null;
  return { schema: parts.slice(0, -1).join("."), table };
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const info = await stat(absPath);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Read one YAML document.
 *
 * The three outcomes are kept apart on purpose:
 *   - `ok`     — the file was read and parsed;
 *   - `absent` — the file does not exist (a legitimate, optional absence);
 *   - `broken` — the file EXISTS but cannot be read or parsed.
 *
 * A broken model must never be reported as absent: an unreadable Manifest
 * would otherwise make an incomplete model look unambiguous and dependency-free
 * instead of blocking the operation.
 */
type YamlReadResult =
  | { status: "ok"; value: Record<string, unknown> }
  | { status: "absent" }
  | { status: "broken"; reason: string };

async function readYamlRecordDetailed(absPath: string): Promise<YamlReadResult> {
  let text: string;
  try {
    text = await readFile(absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return { status: "broken", reason: `read_failed:${(error as NodeJS.ErrnoException).code ?? "unknown"}` };
  }
  try {
    const doc = parseDocument(text, { prettyErrors: true });
    if (doc.errors.length > 0) return { status: "broken", reason: "yaml_parse_failed" };
    return { status: "ok", value: valueAsRecord(doc.toJSON()) };
  } catch {
    return { status: "broken", reason: "yaml_parse_failed" };
  }
}

async function readYamlRecord(absPath: string): Promise<Record<string, unknown> | null> {
  const result = await readYamlRecordDetailed(absPath);
  return result.status === "ok" ? result.value : null;
}

/**
 * Build the model index from the Schema Manifests on disk.
 *
 * Reads the resolved content root (`resolveContentPaths`), never a hard-coded
 * repository path, so the default, a custom content root and the legacy
 * sibling layout all behave the same (V19).
 */
export async function buildSemanticModelIndex(projectRoot: string): Promise<SemanticModelIndex> {
  const contentPaths = await resolveContentPaths(projectRoot);
  const semanticRoot = contentPaths.semanticLayer;

  const entries: SemanticIdentityEntry[] = [];
  const byKey = new Map<string, SemanticIdentityEntry>();
  const byQualifiedName = new Map<string, SemanticIdentityEntry[]>();
  const overlayOwners = new Map<string, string[]>();
  const connections: string[] = [];

  const connectionDirs = await readdir(semanticRoot, { withFileTypes: true }).catch(() => []);
  for (const connectionDir of connectionDirs) {
    if (!connectionDir.isDirectory()) continue;
    if (connectionDir.name.startsWith(".")) continue;
    const connectionId = connectionDir.name;
    connections.push(connectionId);

    const schemaDir = path.join(semanticRoot, connectionId, "_schema");
    const schemaFiles = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
    for (const schemaFile of schemaFiles) {
      if (!schemaFile.isFile() || !schemaFile.name.endsWith(".yaml")) continue;
      const schema = schemaFile.name.replace(/\.yaml$/, "");
      const manifestRelPath = path.posix.join(
        "semantic-layer",
        connectionId,
        "_schema",
        schemaFile.name
      );
      const manifestRead = await readYamlRecordDetailed(path.join(schemaDir, schemaFile.name));
      if (manifestRead.status === "absent") continue;
      if (manifestRead.status === "broken") {
        // The Manifest EXISTS but cannot be parsed. Treating it as absent would
        // make an incomplete model look complete — the operation must block.
        throw new SemanticIdentityError(
          "SEMANTIC_MODEL_UNREADABLE",
          `Schema Manifest 无法解析：${schemaDir}/${schemaFile.name}（${manifestRead.reason}）。`
        );
      }
      const root = manifestRead.value;
      const tables = valueAsRecord(root.tables);
      for (const [sourceName, rawTable] of Object.entries(tables)) {
        const tableRecord = valueAsRecord(rawTable);
        const declared = typeof tableRecord.table === "string" ? tableRecord.table.trim() : "";
        const qualified = parseQualifiedTable(declared);
        const physicalSchema = qualified?.schema ?? schema;
        const physicalTable = qualified?.table ?? sourceName;
        const qualifiedName = qualified ? `${qualified.schema}.${qualified.table}` : `${schema}.${sourceName}`;
        const declaredPartCount = declared ? declared.split(".").length : 0;
        const overlayRelPath = path.posix.join("semantic-layer", connectionId, `${sourceName}.yaml`);
        const identity: SemanticTableIdentity = { connectionId, schema, table: sourceName };
        const key = semanticIdentityKey(identity);

        // The same identity declared twice (two manifests claiming the same
        // table) is an ambiguity, not a merge. Keep both so the resolution
        // step can block.
        const entry: SemanticIdentityEntry = {
          identity,
          sourceName,
          qualifiedName,
          physicalSchema,
          physicalTable,
          manifestRelPath,
          overlayRelPath,
          overlayExists: await fileExists(path.join(semanticRoot, connectionId, `${sourceName}.yaml`)),
          // A three-part SQL Server name's leading segments are database.schema,
          // not the Manifest file name. That is not a file/schema mismatch.
          schemaMismatch: qualified !== null && declaredPartCount === 2 && qualified.schema !== schema
        };
        entries.push(entry);
        if (!byKey.has(key)) byKey.set(key, entry);
        const qualifiedBucket = byQualifiedName.get(qualifiedName) ?? [];
        qualifiedBucket.push(entry);
        byQualifiedName.set(qualifiedName, qualifiedBucket);
        const owners = overlayOwners.get(overlayRelPath) ?? [];
        owners.push(key);
        overlayOwners.set(overlayRelPath, owners);
      }
    }
  }

  return { entries, byKey, byQualifiedName, overlayOwners, connections: connections.sort() };
}

/**
 * Resolve one identity from a (possibly partial) query.
 *
 * A fully qualified query (`connectionId` + `schema` + `table`) must match
 * exactly one model entry. A partial query must match exactly one as well —
 * anything else is an ambiguity and is blocked. No default connection and no
 * "first match wins".
 */
export function resolveSemanticIdentity(
  index: SemanticModelIndex,
  query: {
    connectionId?: string;
    schema?: string;
    table?: string;
    qualifiedName?: string;
  }
): SemanticIdentityEntry {
  if (query.qualifiedName) {
    const bucket = index.byQualifiedName.get(query.qualifiedName) ?? [];
    const scoped = query.connectionId
      ? bucket.filter((entry) => entry.identity.connectionId === query.connectionId)
      : bucket;
    if (scoped.length === 1) return scoped[0]!;
    if (scoped.length === 0) {
      throw new SemanticIdentityError(
        "IDENTITY_NOT_FOUND",
        `模型中不存在 ${query.qualifiedName}${query.connectionId ? `（连接 ${query.connectionId}）` : ""}，无法解析表身份。`
      );
    }
    throw new SemanticIdentityError(
      "IDENTITY_AMBIGUOUS",
      `表名 ${query.qualifiedName} 在多个连接/Schema 中存在（${scoped
        .map((entry) => semanticIdentityKey(entry.identity))
        .join("、")}），请补全 connectionId 与 schema 后再操作。`,
      scoped.map((entry) => entry.identity)
    );
  }

  const described = [query.connectionId, query.schema, query.table].filter(Boolean).join("/");
  const candidates = index.entries.filter((entry) => {
    if (query.connectionId && entry.identity.connectionId !== query.connectionId) return false;
    if (query.schema && entry.identity.schema !== query.schema) return false;
    if (query.table && entry.identity.table !== query.table) return false;
    return true;
  });

  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new SemanticIdentityError(
      "IDENTITY_NOT_FOUND",
      `模型中不存在 ${described || "(空)"}，无法解析表身份。`
    );
  }
  throw new SemanticIdentityError(
    "IDENTITY_AMBIGUOUS",
    `表身份 ${described} 在模型中匹配到 ${candidates.length} 个对象（${candidates
      .map((entry) => semanticIdentityKey(entry.identity))
      .join("、")}），请补全 connectionId 与 schema。`,
    candidates.map((entry) => entry.identity)
  );
}

/** Read the join references declared for one identity (manifest + overlay). */
export async function readSemanticJoinReferences(
  projectRoot: string,
  entry: SemanticIdentityEntry
): Promise<string[]> {
  const contentPaths = await resolveContentPaths(projectRoot);
  const refs = new Set<string>();

  const manifestRead = await readYamlRecordDetailed(
    path.join(contentPaths.semanticLayer, entry.identity.connectionId, "_schema", `${entry.identity.schema}.yaml`)
  );
  if (manifestRead.status === "broken") {
    // The Manifest exists but cannot be parsed. Reading it as "no joins" would
    // silently drop dependencies and make an incomplete model look complete.
    throw new SemanticIdentityError(
      "SEMANTIC_MODEL_UNREADABLE",
      `Schema Manifest 无法解析：${entry.identity.connectionId}/${entry.identity.schema}.yaml（${manifestRead.reason}）。`,
      [entry.identity]
    );
  }
  const manifest = manifestRead.status === "ok" ? manifestRead.value : null;
  const manifestTable = manifest
    ? valueAsRecord(valueAsRecord(manifest.tables)[entry.sourceName])
    : {};
  for (const join of Array.isArray(manifestTable.joins) ? manifestTable.joins : []) {
    const to = valueAsRecord(join).to;
    if (typeof to === "string" && to.trim()) refs.add(to.trim());
  }

  const overlayRead = await readYamlRecordDetailed(
    path.join(contentPaths.semanticLayer, entry.identity.connectionId, `${entry.sourceName}.yaml`)
  );
  if (overlayRead.status === "broken") {
    throw new SemanticIdentityError(
      "SEMANTIC_MODEL_UNREADABLE",
      `语义 overlay 无法解析：${entry.identity.connectionId}/${entry.sourceName}.yaml（${overlayRead.reason}）。`,
      [entry.identity]
    );
  }
  const overlay = overlayRead.status === "ok" ? overlayRead.value : null;
  for (const join of Array.isArray(overlay?.joins) ? overlay.joins : []) {
    const to = valueAsRecord(join).to;
    if (typeof to === "string" && to.trim()) refs.add(to.trim());
  }

  return [...refs].sort();
}

export type SemanticDependencyRelation = "same_schema" | "cross_schema" | "cross_connection";

export interface SemanticDependency {
  /** The referenced (read-only) table. */
  identity: SemanticTableIdentity;
  /** How the reference relates to the referring table. */
  relation: SemanticDependencyRelation;
  /** The raw reference string as written in the model. */
  referencedAs: string;
  /** The referring table. */
  referencedFrom: SemanticTableIdentity;
}

export interface SemanticDependencyClosure {
  /** The selected, writable targets (sorted + unique). */
  selected: SemanticTableIdentity[];
  /** Every read-only dependency, transitively. */
  dependencies: SemanticDependency[];
  /** Dependency identities only (sorted + unique). */
  dependencyIdentities: SemanticTableIdentity[];
  /**
   * Tables that share a physical overlay file with a selected table but were
   * NOT selected. Writing would change them too, so the caller must block.
   */
  unselectedImpact: SemanticTableIdentity[];
}

function relationBetween(
  from: SemanticTableIdentity,
  to: SemanticTableIdentity
): SemanticDependencyRelation {
  if (from.connectionId !== to.connectionId) return "cross_connection";
  if (from.schema !== to.schema) return "cross_schema";
  return "same_schema";
}

/**
 * Resolve a single join reference to exactly one model identity.
 *
 * `to` may be `<schema>.<table>` or a bare table name. A qualified reference
 * is resolved inside the referring connection first and then across
 * connections; a bare name is resolved inside the referring connection only.
 * More than one candidate is an ambiguity and is blocked — the module never
 * guesses a default connection.
 */
function resolveDependencyReference(
  index: SemanticModelIndex,
  reference: string,
  from: SemanticTableIdentity
): SemanticIdentityEntry {
  const qualified = parseQualifiedTable(reference);
  const matches = (entries: SemanticIdentityEntry[]) => {
    if (qualified) {
      return entries.filter(
        (entry) =>
          (entry.physicalSchema === qualified.schema && entry.physicalTable === qualified.table) ||
          (entry.identity.schema === qualified.schema && entry.identity.table === qualified.table)
      );
    }
    return entries.filter((entry) => entry.identity.table === reference);
  };

  const sameConnection = matches(
    index.entries.filter((entry) => entry.identity.connectionId === from.connectionId)
  );
  const candidates = sameConnection.length > 0 ? sameConnection : matches(index.entries);

  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new SemanticIdentityError(
      "DEPENDENCY_NOT_FOUND",
      `关联 ${from.connectionId}/${from.schema}/${from.table} 引用了 ${reference}，但模型中找不到该表；缺失依赖必须阻断，不能猜默认连接。`,
      [from]
    );
  }
  throw new SemanticIdentityError(
    "DEPENDENCY_AMBIGUOUS",
    `关联 ${from.connectionId}/${from.schema}/${from.table} 引用了 ${reference}，该名称在模型中匹配到 ${candidates.length} 个对象（${candidates
      .map((entry) => semanticIdentityKey(entry.identity))
      .join("、")}）；同名歧义必须阻断。`,
    candidates.map((entry) => entry.identity)
  );
}

/**
 * Compute the dependency closure of a selection.
 *
 * The selected objects and their read-only dependencies are listed
 * separately (Spec §4.3). A dependency never becomes a writable target, and
 * a missing or ambiguous dependency blocks the whole selection.
 */
export async function resolveSemanticDependencyClosure(
  projectRoot: string,
  index: SemanticModelIndex,
  selected: readonly SemanticTableIdentity[]
): Promise<SemanticDependencyClosure> {
  const selectedIdentities = sortUniqueSemanticIdentities(selected);
  const selectedKeys = new Set(selectedIdentities.map(semanticIdentityKey));

  const dependencies: SemanticDependency[] = [];
  const seenDeps = new Set<string>();
  const visited = new Set<string>();
  const queue: SemanticTableIdentity[] = [...selectedIdentities];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = semanticIdentityKey(current);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    const entry = index.byKey.get(currentKey);
    if (!entry) {
      throw new SemanticIdentityError(
        "IDENTITY_NOT_FOUND",
        `模型中不存在 ${currentKey}，无法解析依赖闭包。`,
        [current]
      );
    }

    const references = await readSemanticJoinReferences(projectRoot, entry);
    for (const reference of references) {
      const resolved = resolveDependencyReference(index, reference, current);
      const depKey = semanticIdentityKey(resolved.identity);
      if (depKey === currentKey) continue;
      if (!seenDeps.has(depKey)) {
        seenDeps.add(depKey);
        dependencies.push({
          identity: resolved.identity,
          relation: relationBetween(current, resolved.identity),
          referencedAs: reference,
          referencedFrom: current
        });
      }
      // Transitive closure: a dependency's own dependencies are dependencies
      // too. They stay read-only.
      if (!visited.has(depKey)) queue.push(resolved.identity);
    }
  }

  const dependencyIdentities = sortUniqueSemanticIdentities(
    dependencies.map((dependency) => dependency.identity)
  ).filter((identity) => !selectedKeys.has(semanticIdentityKey(identity)));

  const unselectedImpact = computeUnselectedSharedTargets(index, selectedIdentities);

  return { selected: selectedIdentities, dependencies, dependencyIdentities, unselectedImpact };
}

/**
 * Tables that share a physical overlay file with a selected table.
 *
 * Spec §4.4: "若一个实际 overlay 文件承载多个表，本期不拆分写入；选择未覆盖全部写入影响表时阻断".
 */
export function computeUnselectedSharedTargets(
  index: SemanticModelIndex,
  selected: readonly SemanticTableIdentity[]
): SemanticTableIdentity[] {
  const selectedKeys = new Set(selected.map(semanticIdentityKey));
  const impacted = new Map<string, SemanticTableIdentity>();

  for (const identity of selected) {
    const entry = index.byKey.get(semanticIdentityKey(identity));
    if (!entry) continue;
    const owners = index.overlayOwners.get(entry.overlayRelPath) ?? [];
    for (const ownerKey of owners) {
      if (ownerKey === semanticIdentityKey(identity)) continue;
      if (selectedKeys.has(ownerKey)) continue;
      const owner = index.byKey.get(ownerKey);
      if (!owner) continue;
      impacted.set(ownerKey, owner.identity);
    }
  }

  return [...impacted.values()].sort(compareSemanticIdentities);
}

/**
 * Block a selection that would silently widen the write scope.
 *
 * Called by the scope resolver and by the import pre-check.
 */
export function assertNoUnselectedSharedTargets(
  index: SemanticModelIndex,
  selected: readonly SemanticTableIdentity[],
  closure?: SemanticDependencyClosure
): void {
  const impacted = closure?.unselectedImpact ?? computeUnselectedSharedTargets(index, selected);
  if (impacted.length === 0) return;
  throw new SemanticIdentityError(
    "SHARED_WRITE_TARGET",
    `以下对象与已选表共用同一个 overlay 文件，写入会同时改变它们，必须先补选：${impacted
      .map(semanticIdentityKey)
      .join("、")}`,
    impacted
  );
}

/** Structural validation of an identity supplied by a caller. */
export function assertValidSemanticIdentity(identity: SemanticTableIdentity): void {
  const segments = [identity.connectionId, identity.schema, identity.table];
  if (segments.some((segment) => !segment || segment.includes("/") || segment.includes("\\"))) {
    throw new SemanticIdentityError(
      "IDENTITY_INVALID",
      `表身份 ${segments.join("/")} 含非法字符。`
    );
  }
}

/** Convenience: the display label of an identity (never a bare table name). */
export function semanticIdentityLabel(identity: SemanticTableIdentity): string {
  return `${identity.connectionId} / ${identity.schema} / ${identity.table}`;
}
