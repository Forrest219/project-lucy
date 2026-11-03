import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Document, isMap, parseDocument, Scalar, YAMLMap, YAMLSeq, type ParsedNode } from "yaml";
import { computeCompletion } from "./completion";
import { previewDiff } from "./diff";
import { assertReadable, ForbiddenPathError, safeWrite } from "./fs-safe";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { auditActorFields, type TrustedActor } from "./security/request-actor.js";
import type { AuthoredText, Column, Join, ManifestSchemaSummary, Measure, Segment, SourceSummary, TableModel, TablePatch } from "./model";
import { previewOverlayUpdate } from "./overlay";
import {
  authorizedCountsFromBatch,
  enabledUserIdsFromRaw,
  readAccessSnapshot,
  resolvePermissionBatch,
  sourceCountKey
} from "./admin/permission-display.js";
import type { DisplayPolicyInputs } from "./proxy/acl.js";
import { readConnections } from "./project";
import { isSqlServerDriver, manifestTableIsEnabled } from "../src/lib/enabled-table-identity.js";
import { loadContentPaths } from "./paths";
import { stripManifestOnlyColumnKeys } from "./semantic-overlay-sanitize";
import { countEntryPerf, timeAsync } from "./entry-performance-timing";
import {
  expandDisplayWrite,
  scopeContextFor,
  scopesForPath,
  withDisplayWriteBarrier,
  type DisplayScope
} from "./display-generation";
// L25-16 N05 / G17 — 旧的源表导入写入口接入**同一把** ktx.yaml 写锁，
// 否则控制面批量导入的互斥承诺不成立（旧入口可以在批量持锁期间交错写）。
import { withKtxYamlWriteLock } from "./ktx-yaml-write-lock";
import { withPublishCoordinator } from "./publish-coordinator.js";
import { openPromotingContentRelease, closeContentBatch, failContentBatch } from "./semantic-assets.js";
import { readOrCreateSemanticInstanceId } from "./semantic-release-snapshots.js";
import {
  createRecoveryJournal,
  markRecoveryJournalFilesSaved
} from "./semantic-recovery-journal.js";

const TABLE_KEYS = new Set(["table", "descriptions", "grain", "columns", "measures", "segments", "joins"]);

export class SourceNotFoundError extends Error {
  code = "SOURCE_NOT_FOUND";
  statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "SourceNotFoundError";
  }
}

export class YamlParseError extends Error {
  code = "YAML_PARSE_ERROR";
  statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = "YamlParseError";
  }
}

type SchemaFile = {
  conn: string;
  schema: string;
  relPath: string;
  absPath: string;
  mtime: Date;
};

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function authoredText(value: unknown): AuthoredText {
  const record = valueAsRecord(value);
  return {
    db: stringValue(record.db),
    ai: stringValue(record.ai),
    human: stringValue(record.human)
  };
}

function hasDescription(value: AuthoredText): boolean {
  return Boolean(value.human?.trim() || value.ai?.trim());
}

function normalizeColumn(value: unknown): Column | null {
  const record = valueAsRecord(value);
  const name = stringValue(record.name);
  if (!name) {
    return null;
  }

  const type = stringValue(record.type);
  return {
    name,
    type: type === "number" || type === "time" || type === "boolean" ? type : "string",
    pk: booleanValue(record.pk),
    nullable: booleanValue(record.nullable),
    descriptions: authoredText(record.descriptions)
  };
}

function normalizeJoin(value: unknown): Join | null {
  const record = valueAsRecord(value);
  const to = stringValue(record.to);
  const on = stringValue(record.on);
  const relationship = stringValue(record.relationship);
  if (!to || !on) {
    return null;
  }
  return {
    to,
    on,
    relationship:
      relationship === "one_to_many" || relationship === "one_to_one" || relationship === "many_to_one"
        ? relationship
        : "many_to_one",
    alias: stringValue(record.alias),
    source: record.source === "manual" || record.source === "candidate" ? record.source : "formal"
  };
}

function normalizeMeasure(value: unknown): Measure | null {
  const record = valueAsRecord(value);
  const name = stringValue(record.name);
  const expr = stringValue(record.expr);
  if (!name || !expr) {
    return null;
  }
  return {
    name,
    expr,
    filter: stringValue(record.filter),
    description: stringValue(record.description)
  };
}

function normalizeSegment(value: unknown): Segment | null {
  const record = valueAsRecord(value);
  const name = stringValue(record.name);
  const expr = stringValue(record.expr);
  if (!name || !expr) {
    return null;
  }
  return {
    name,
    expr,
    description: stringValue(record.description)
  };
}

function compact<T>(values: (T | null)[] | undefined): T[] {
  return values?.filter((value): value is T => value !== null) ?? [];
}

function mapKeys(node: ParsedNode | null | undefined): string[] {
  if (!isMap(node)) {
    return [];
  }
  return node.items
    .map((item) => (typeof item.key?.toJSON === "function" ? item.key.toJSON() : undefined))
    .filter((key): key is string => typeof key === "string");
}

function tableNodeFromDocument(doc: Document, table: string): ParsedNode | null {
  const node = doc.getIn(["tables", table], true);
  return node && typeof node === "object" ? (node as ParsedNode) : null;
}

function requireTableNode(doc: Document, table: string) {
  const node = tableNodeFromDocument(doc, table);
  if (!node || !isMap(node)) {
    throw new SourceNotFoundError(`Source table ${table} was not found`);
  }
  return node;
}

function setNodeIn(node: ParsedNode, pathParts: unknown[], value: unknown): void {
  if (!isMap(node)) {
    throw new YamlParseError("Expected YAML map node while applying patch");
  }
  node.setIn(pathParts, value);
}

function joinsNode(joins: Join[]): YAMLSeq {
  const seq = new YAMLSeq();
  for (const join of joins) {
    const map = new YAMLMap();
    map.set("to", join.to);
    const onKey = new Scalar("on");
    onKey.type = Scalar.QUOTE_DOUBLE;
    map.set(onKey, join.on);
    map.set("relationship", join.relationship);
    if (join.alias) {
      map.set("alias", join.alias);
    }
    map.set("source", "formal");
    seq.add(map);
  }
  return seq;
}

function columnsNode(tableNode: ParsedNode): ParsedNode[] {
  if (!isMap(tableNode)) {
    return [];
  }
  const node = tableNode.get("columns", true);
  if (!node || typeof node !== "object" || !("items" in node) || !Array.isArray(node.items)) {
    return [];
  }
  return node.items.filter((item): item is ParsedNode => typeof item === "object" && item !== null);
}

function tableYaml(doc: Document, schema: string, table: string, overlay: Record<string, unknown> = {}): string {
  const node = tableNodeFromDocument(doc, table);
  if (!node) {
    return "";
  }
  const value = valueAsRecord(node.toJSON());
  if ("grain" in overlay) {
    value.grain = stringArray(overlay.grain) ?? [];
  }
  if (Array.isArray(overlay.measures)) {
    value.measures = overlay.measures;
  }
  if (Array.isArray(overlay.segments)) {
    value.segments = overlay.segments;
  }
  // Publishable semantic overlay shape (Lucy upload + KTX SourceColumn contract).
  const published: Record<string, unknown> = {
    ...value,
    name: table,
    table: typeof value.table === "string" && value.table.trim() ? value.table : `${schema}.${table}`
  };
  if (Array.isArray(published.columns)) {
    published.columns = stripManifestOnlyColumnKeys(published.columns).columns;
  }
  return new Document(published).toString({ lineWidth: 0 });
}

function parseYaml(text: string, source: string): Document {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new YamlParseError(`Failed to parse ${source}: ${doc.errors[0].message}`);
  }
  return doc;
}

function assertSafeSegment(value: string, label: string): void {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === ".." || value.includes("..")) {
    throw new ForbiddenPathError(`${label} contains an unsafe path segment`);
  }
}

function schemaRelPath(conn: string, schema: string): string {
  assertSafeSegment(conn, "connection");
  assertSafeSegment(schema, "schema");
  return path.posix.join("semantic-layer", conn, "_schema", `${schema}.yaml`);
}

async function readYamlDocument(projectRoot: string, relPath: string): Promise<{ doc: Document; text: string }> {
  const paths = await loadContentPaths();
  const absPath = await assertReadable(paths, projectRoot, relPath);
  const text = await readFile(absPath, "utf8");
  countEntryPerf(relPath.includes("/_schema/") ? "manifestParses" : "overlayReads");
  return { doc: parseYaml(text, relPath), text };
}

async function listSchemaFiles(projectRoot: string): Promise<SchemaFile[]> {
  const base = (await loadContentPaths()).semanticLayer;
  const connections = await readdir(base, { withFileTypes: true }).catch(() => []);
  const files: SchemaFile[] = [];

  for (const connection of connections) {
    if (!connection.isDirectory()) {
      continue;
    }
    // Skip Lucy/KTX-internal hidden dirs (e.g. legacy `.lucy-history`).
    if (connection.name.startsWith(".")) {
      continue;
    }
    const schemaDir = path.join(base, connection.name, "_schema");
    const schemas = await readdir(schemaDir, { withFileTypes: true }).catch(() => []);
    for (const schema of schemas) {
      if (!schema.isFile() || !schema.name.endsWith(".yaml")) {
        continue;
      }
      const relPath = path.posix.join("semantic-layer", connection.name, "_schema", schema.name);
      const absPath = path.join(schemaDir, schema.name);
      const fileStat = await stat(absPath);
      files.push({
        conn: connection.name,
        schema: schema.name.replace(/\.yaml$/, ""),
        relPath,
        absPath,
        mtime: fileStat.mtime
      });
    }
  }

  return files.sort((a, b) => `${a.conn}/${a.schema}`.localeCompare(`${b.conn}/${b.schema}`));
}

async function readOverlay(projectRoot: string, conn: string, table: string): Promise<Record<string, unknown>> {
  const relPath = path.posix.join("semantic-layer", conn, `${table}.yaml`);
  try {
    const { doc } = await readYamlDocument(projectRoot, relPath);
    return valueAsRecord(doc.toJSON());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function statOverlay(projectRoot: string, conn: string, table: string): Promise<Date | null> {
  const absPath = path.join((await loadContentPaths()).semanticLayer, conn, `${table}.yaml`);
  try {
    const s = await stat(absPath);
    return s.mtime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

type AuthorizedCountInput = {
  conn: string;
  schema: string;
  table: string;
};

export type AuthorizedCountsState = "ok" | "partial" | "unavailable";

/**
 * Counts enabled Agents whose effective permissions include each source via
 * one read-only permission batch (Spec 174 §3.1). Matches
 * `connectionId === conn && schema === schema && sourceName === table`.
 * Disabled Agents are skipped. Missing / malformed access.yaml keeps the
 * legacy numeric 0 fallback but reports `unavailable` — never throws.
 */
async function computeAuthorizedAgentCounts(
  projectRoot: string,
  sources: AuthorizedCountInput[]
): Promise<{ counts: Map<string, number>; state: AuthorizedCountsState; policyInputs: DisplayPolicyInputs | null }> {
  const snapshot = await readAccessSnapshot(projectRoot);
  const enabledUserIds = enabledUserIdsFromRaw(snapshot);
  try {
    const batch = await resolvePermissionBatch(snapshot, enabledUserIds);
    const { counts, state } = authorizedCountsFromBatch(snapshot, batch, enabledUserIds, sources);
    return { counts, state, policyInputs: batch.policyInputs };
  } catch {
    const counts = new Map(sources.map((source) => [sourceCountKey(source.conn, source.schema, source.table), 0]));
    return { counts, state: "unavailable", policyInputs: null };
  }
}

function modelFromTable(
  conn: string,
  schema: string,
  table: string,
  filePath: string,
  tableValue: unknown,
  tableNode: ParsedNode | null,
  overlay: Record<string, unknown>
): TableModel {
  const record = valueAsRecord(tableValue);
  const columns = compact((Array.isArray(record.columns) ? record.columns : []).map(normalizeColumn));
  const joins = compact((Array.isArray(record.joins) ? record.joins : []).map(normalizeJoin));
  const grain = stringArray(overlay.grain) ?? stringArray(record.grain);
  const measures = compact((Array.isArray(overlay.measures) ? overlay.measures : record.measures as unknown[] | undefined)?.map(normalizeMeasure));
  const segments = compact((Array.isArray(overlay.segments) ? overlay.segments : record.segments as unknown[] | undefined)?.map(normalizeSegment));
  const unknownKeys = mapKeys(tableNode).filter((key) => !TABLE_KEYS.has(key));

  return {
    conn,
    schema,
    table,
    filePath,
    qualifiedName: stringValue(record.table),
    descriptions: authoredText(record.descriptions),
    grain,
    columns,
    measures,
    segments,
    joins,
    unknownKeys
  };
}

type ParsedSchemaFile = { file: SchemaFile; doc: Document; tables: Record<string, unknown> };

async function readSchemaFiles(projectRoot: string): Promise<ParsedSchemaFile[]> {
  const parsed: ParsedSchemaFile[] = [];
  for (const file of await listSchemaFiles(projectRoot)) {
    const { doc } = await readYamlDocument(projectRoot, file.relPath);
    const root = valueAsRecord(doc.toJSON());
    parsed.push({ file, doc, tables: valueAsRecord(root.tables) });
  }
  return parsed;
}

function manifestSchemaSummaries(files: ParsedSchemaFile[]): ManifestSchemaSummary[] {
  return files.map(({ file, tables }) => ({
    conn: file.conn,
    schema: file.schema,
    filePath: file.relPath,
    tableCount: Object.keys(tables).length,
    mtime: file.mtime.toISOString()
  }));
}

export type SourcesListing = {
  tables: SourceSummary[];
  manifestSchemas: ManifestSchemaSummary[];
  authorizedCountsState: AuthorizedCountsState;
  /** Compile inputs; runtimeConsistency is evaluated against the live runtime per response. */
  policyInputs: DisplayPolicyInputs | null;
};

/** Spec 174 §3.1 — tables and manifestSchemas derived from one Manifest scan. */
export async function listSourcesWithManifests(projectRoot: string): Promise<SourcesListing> {
  type Pending = {
    file: SchemaFile;
    table: string;
    tableValue: unknown;
    tableNode: ParsedNode | null;
    overlay: Record<string, unknown>;
    overlayMtime: Date | null;
  };

  const pending: Pending[] = [];
  const authorizedInputs: AuthorizedCountInput[] = [];

  let enabledByConnection = new Map<string, Set<string>>();
  let driverByConnection = new Map<string, string | undefined>();
  try {
    const connections = await readConnections(projectRoot);
    enabledByConnection = new Map(
      connections.map((conn) => [conn.id, new Set(conn.enabledTables)])
    );
    driverByConnection = new Map(connections.map((conn) => [conn.id, conn.driver]));
  } catch {
    // Missing / unreadable ktx.yaml: treat every Manifest table as not enabled.
    enabledByConnection = new Map();
    driverByConnection = new Map();
  }

  const schemaFiles = await timeAsync("manifest", () => readSchemaFiles(projectRoot));
  await timeAsync("overlay", async () => {
    for (const { file, doc, tables } of schemaFiles) {
      for (const [table, tableValue] of Object.entries(tables)) {
        const overlayMtime = await statOverlay(projectRoot, file.conn, table);
        const overlay = overlayMtime ? await readOverlay(projectRoot, file.conn, table) : {};
        pending.push({
          file,
          table,
          tableValue,
          tableNode: tableNodeFromDocument(doc, table),
          overlay,
          overlayMtime
        });
        authorizedInputs.push({ conn: file.conn, schema: file.schema, table });
      }
    }
  });

  const authorized = await timeAsync("permissions", () => computeAuthorizedAgentCounts(projectRoot, authorizedInputs));
  const authorizedCounts = authorized.counts;

  const summaries: SourceSummary[] = pending.map((entry) => {
    const manifestMtime = entry.file.mtime;
    const overlayMtime = entry.overlayMtime;
    const useOverlay = overlayMtime !== null && overlayMtime.getTime() > manifestMtime.getTime();
    const semanticUpdatedAt = (useOverlay ? overlayMtime : manifestMtime)!.toISOString();
    const semanticUpdatedAtSource: SourceSummary["semanticUpdatedAtSource"] = useOverlay ? "overlay" : "manifest";

    const model = modelFromTable(
      entry.file.conn,
      entry.file.schema,
      entry.table,
      entry.file.relPath,
      entry.tableValue,
      entry.tableNode,
      entry.overlay
    );

    const logicalName = `${entry.file.schema}.${entry.table}`;
    const qualifiedName = model.qualifiedName?.trim() || logicalName;
    const enabledNames = enabledByConnection.get(entry.file.conn);
    const enabled = enabledNames
      ? manifestTableIsEnabled(
          [...enabledNames],
          logicalName,
          qualifiedName,
          isSqlServerDriver(driverByConnection.get(entry.file.conn))
        )
      : false;

    return {
      conn: entry.file.conn,
      schema: entry.file.schema,
      table: entry.table,
      qualifiedName,
      filePath: entry.file.relPath,
      columnCount: model.columns.length,
      columnNames: model.columns.map((column) => column.name),
      hasTableDesc: hasDescription(model.descriptions),
      hasGrain: Boolean(model.grain?.length),
      measureCount: model.measures?.length ?? 0,
      joinCount: model.joins?.length ?? 0,
      wikiRefCount: 0,
      completion: computeCompletion(model),
      mtime: manifestMtime.toISOString(),
      enabled,
      authorizedAgentCount: authorizedCounts.get(sourceCountKey(entry.file.conn, entry.file.schema, entry.table)) ?? 0,
      semanticUpdatedAt,
      semanticUpdatedAtSource
    };
  });

  return {
    tables: summaries.sort((a, b) => `${a.conn}/${a.schema}/${a.table}`.localeCompare(`${b.conn}/${b.schema}/${b.table}`)),
    manifestSchemas: manifestSchemaSummaries(schemaFiles),
    authorizedCountsState: authorized.state,
    policyInputs: authorized.policyInputs
  };
}

/** Spec 174 §3.3 — additive `data.meta` for `/api/sources` (no secrets / absolute paths). */
export type SourcesDisplayMeta = {
  snapshotVersion: string;
  generatedAt: string;
  authorizedCountsState: AuthorizedCountsState;
  runtimeConsistency: "matched" | "unconfirmed";
};

/** The response version covers the cached snapshot *and* the runtime state it is reported against. */
export function sourcesDisplayMeta(
  base: Pick<SourcesDisplayMeta, "snapshotVersion" | "generatedAt" | "authorizedCountsState">,
  runtimeConsistency: SourcesDisplayMeta["runtimeConsistency"]
): SourcesDisplayMeta {
  return {
    snapshotVersion: createHash("sha256").update(`${base.snapshotVersion}:${runtimeConsistency}`).digest("hex").slice(0, 16),
    generatedAt: base.generatedAt,
    authorizedCountsState: base.authorizedCountsState,
    runtimeConsistency
  };
}

export async function listSources(projectRoot: string): Promise<SourceSummary[]> {
  return (await listSourcesWithManifests(projectRoot)).tables;
}

export async function listManifestSchemas(projectRoot: string): Promise<ManifestSchemaSummary[]> {
  return manifestSchemaSummaries(await readSchemaFiles(projectRoot));
}

export async function readSource(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string
): Promise<{ model: TableModel; rawYaml: string; completion: ReturnType<typeof computeCompletion> }> {
  assertSafeSegment(table, "table");
  const relPath = schemaRelPath(conn, schema);
  const { doc, text } = await readYamlDocument(projectRoot, relPath);
  const root = valueAsRecord(doc.toJSON());
  const tables = valueAsRecord(root.tables);
  const tableValue = tables[table];
  if (!tableValue) {
    throw new SourceNotFoundError(`Source ${conn}/${schema}/${table} was not found`);
  }

  const overlay = await readOverlay(projectRoot, conn, table);
  const model = modelFromTable(conn, schema, table, relPath, tableValue, tableNodeFromDocument(doc, table), overlay);
  return {
    model,
    rawYaml: tableYaml(doc, schema, table, overlay),
    completion: computeCompletion(model)
  };
}

async function readYamlRecordIfPresent(
  projectRoot: string,
  relPath: string
): Promise<Record<string, unknown> | null> {
  try {
    const { doc } = await readYamlDocument(projectRoot, relPath);
    return valueAsRecord(doc.toJSON());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Raw `columns` from the changed source's overlay yaml and from its
 * `_schema/<schema>.yaml` table. Types are not coerced, so `float` stays
 * `float` for the column-type contract check.
 */
export async function readChangedSourceColumnContracts(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string
): Promise<Array<{ filePath: string; columns: unknown }>> {
  assertSafeSegment(table, "table");
  const contracts: Array<{ filePath: string; columns: unknown }> = [];
  const manifestPath = schemaRelPath(conn, schema);
  const overlayPath = path.posix.join("semantic-layer", conn, `${table}.yaml`);
  const overlay = await readYamlRecordIfPresent(projectRoot, overlayPath);
  if (overlay && Array.isArray(overlay.columns)) {
    contracts.push({ filePath: overlayPath, columns: overlay.columns });
  }
  const manifest = await readYamlRecordIfPresent(projectRoot, manifestPath);
  if (manifest) {
    const tables = valueAsRecord(manifest.tables);
    const tableValue = valueAsRecord(tables[table]);
    if (Array.isArray(tableValue.columns)) {
      contracts.push({ filePath: manifestPath, columns: tableValue.columns });
    }
  }
  return contracts;
}

export function applyPatch(doc: Document, table: string, patch: TablePatch): Document {
  const tableNode = requireTableNode(doc, table);

  if (patch.tableDescription !== undefined) {
    setNodeIn(tableNode, ["descriptions", "human"], patch.tableDescription);
  }

  if (patch.columns) {
    const nodes = columnsNode(tableNode);
    for (const columnPatch of patch.columns) {
      if (columnPatch.description === undefined) {
        continue;
      }
      const columnNode = nodes.find((node) => {
        if (!isMap(node)) {
          return false;
        }
        const nameNode = node.get("name", true);
        return nameNode && typeof nameNode === "object" && "toJSON" in nameNode
          ? nameNode.toJSON() === columnPatch.name
          : false;
      });
      if (columnNode) {
        setNodeIn(columnNode, ["descriptions", "human"], columnPatch.description);
      }
    }
  }

  if (patch.joins) {
    const formalJoins = patch.joins
      .filter((join) => join.source === "formal" || join.source === "manual")
      .map((join) => ({ ...join, source: "formal" as const }));
    setNodeIn(tableNode, ["joins"], joinsNode(formalJoins));
  }

  return doc;
}

export function serialize(doc: Document): string {
  return doc.toString({ lineWidth: 0 });
}

export type SourcePreview = {
  diff: string;
  proposedYaml: string;
  files: Array<{
    filePath: string;
    diff: string;
    proposedYaml: string;
  }>;
};

export async function buildSourcePatchPreview(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  patch: TablePatch
): Promise<SourcePreview> {
  assertSafeSegment(table, "table");
  const relPath = schemaRelPath(conn, schema);
  const { doc, text } = await readYamlDocument(projectRoot, relPath);
  if (!valueAsRecord(valueAsRecord(doc.toJSON()).tables)[table]) {
    throw new SourceNotFoundError(`Source ${conn}/${schema}/${table} was not found`);
  }

  const hasSchemaPatch = patch.tableDescription !== undefined || patch.columns !== undefined || patch.joins !== undefined;
  const files = [];
  if (hasSchemaPatch) {
    applyPatch(doc, table, patch);
    const schemaProposed = serialize(doc);
    const schemaDiff = previewDiff(text, schemaProposed, relPath);
    if (schemaDiff) {
      files.push({
        filePath: relPath,
        diff: schemaDiff,
        proposedYaml: schemaProposed
      });
    }
  }

  const overlayPreview = await previewOverlayUpdate(projectRoot, conn, table, {
    grain: patch.grain,
    measures: patch.measures,
    segments: patch.segments
  });
  if (overlayPreview) {
    files.push({
      filePath: overlayPreview.relPath,
      diff: previewDiff(overlayPreview.oldText, overlayPreview.proposedText, overlayPreview.relPath),
      proposedYaml: overlayPreview.proposedText
    });
  }

  return {
    diff: files.map((file) => file.diff).filter(Boolean).join("\n"),
    proposedYaml: files.map((file) => `# ${file.filePath}\n${file.proposedYaml}`).join("\n"),
    files
  };
}

export async function previewSourcePatch(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  patch: TablePatch
): Promise<SourcePreview> {
  return buildSourcePatchPreview(projectRoot, conn, schema, table, patch);
}

/**
 * Spec 195 §4 — the display scopes of the files a semantic write really
 * touches. A Manifest feeds D and P (the permission display derives its
 * source map from Manifests); a plain overlay feeds D only.
 */
async function scopesForSourceFiles(
  projectRoot: string,
  files: ReadonlyArray<{ filePath: string }>
): Promise<DisplayScope[]> {
  if (files.length === 0) return [];
  const paths = await loadContentPaths();
  const context = scopeContextFor(projectRoot, paths.semanticLayer);
  const scopes = new Set<DisplayScope>();
  for (const file of files) {
    for (const scope of scopesForPath(path.join(paths.configDir, file.filePath), context)) scopes.add(scope);
  }
  return [...scopes];
}

export async function writeSourcePatch(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  patch: TablePatch,
  actor?: TrustedActor
): Promise<SourcePreview> {
  // Lucy v0.25 (L25-11 D4) — the preview is built INSIDE the publish window.
  //
  // Building it outside would let two concurrent edits of different tables
  // that share one Manifest both compute their patch against the same old
  // baseline; the later write would then replace the whole file and silently
  // erase the first edit. Rebuilding under the lock means the second writer
  // sees the first writer's result.
  let preview: SourcePreview | undefined;
  // Spec 174 §3.2 — one barrier over the multi-file write (partial failure still invalidates).
  // Lucy v0.25 (L25-11 D4) — the single-table save shares the publish window with the
  // manifest upload, the batch import, the manual reindex and the access.yaml writers.
  await withPublishCoordinator(
    "semantic_table_save",
    () =>
      withDisplayWriteBarrier(["D"], async (token) => {
        preview = await buildSourcePatchPreview(projectRoot, conn, schema, table, patch);
        if (preview.files.length > 0) {
          // Spec 195 §4 — the outer barrier covers the scopes of the files this
          // write really touches. A Manifest write also feeds the permission
          // display (P); a plain overlay only feeds D. The scope is widened
          // BEFORE the first file is written.
          expandDisplayWrite(token, await scopesForSourceFiles(projectRoot, preview.files));
          const opened = await openPromotingContentRelease({
            projectRoot,
            actor: actor?.actorId ?? "local-admin",
            targets: preview.files.map((file) => ({
              targetPath: file.filePath,
              expectedNewDigest: createHash("sha256").update(file.proposedYaml, "utf8").digest("hex"),
              assetKind: file.filePath.includes("/_schema/") ? "manifest" : "overlay",
              identity: { connectionId: conn, schema, table }
            }))
          });
          const journal = await createRecoveryJournal(projectRoot, {
            releaseId: opened.releaseId,
            operationId: opened.releaseId,
            actor: actor?.actorId ?? "local-admin",
            instanceId: await readOrCreateSemanticInstanceId(projectRoot),
            targets: preview.files.map((file) => ({
              targetPath: file.filePath,
              identity: { connectionId: conn, schema, table },
              newContent: file.proposedYaml
            }))
          });
          try {
            for (const file of preview.files) {
              await auditedWriteFile(projectRoot, file.filePath, file.proposedYaml, {
                enabled: true,
                changeType: "semantic_table_save",
                assetKind: "semantic",
                ...auditActorFields(actor),
                source: "semantic_layer_patch_api",
                targetId: `${conn}:${schema}:${table}`,
                diff: file.diff,
                operation: "save"
              });
            }
            await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
            // L25-15 — the batch has to reach a terminal state inside the
            // publish window. A record left at `promoting` blocks every later
            // content write.
            await closeContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              attemptId: opened.attemptId,
              actor: actor?.actorId ?? "local-admin",
              journalId: journal.journalId,
              changeType: "semantic_table_save_terminal",
              source: "semantic_layer_patch_api",
              targetId: `${conn}:${schema}:${table}`,
              operation: "save_terminal",
              newSummary: { connectionId: conn, schema, table, fileCount: preview.files.length }
            });
          } catch (error) {
            // Spec 174 §3.2 / IM-02: a partial failure after touching disk
            // still invalidates the cache and leaves the written content in
            // place. Rolling a landed write back would contradict that
            // contract, so the batch settles with the files as they are.
            await failContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              journalId: journal.journalId,
              keepLandedWrites: true
            });
            throw error;
          }
        }
      }),
    { projectRoot }
  );
  if (!preview) {
    // The coordinator always runs the callback; this guard only satisfies the
    // type checker and can never be reached in practice.
    throw new Error("semantic_table_save did not produce a preview");
  }
  return preview;
}

type ParsedImportedTable = {
  value: Record<string, unknown>;
  /** True when the YAML root is a Schema Manifest (`tables:`), not a flat source/overlay. */
  fromSchemaManifest: boolean;
};

function parseImportedTable(importedYaml: string, table: string): ParsedImportedTable {
  const doc = parseYaml(importedYaml, "imported table YAML");
  const json = doc.toJSON();
  const root = valueAsRecord(json);
  if (root.tables && typeof root.tables === "object" && !Array.isArray(root.tables)) {
    const value = valueAsRecord(root.tables)[table];
    if (!value) {
      throw new SourceNotFoundError(`Imported YAML does not contain table ${table}`);
    }
    return { value: valueAsRecord(value), fromSchemaManifest: true };
  }
  if ("table" in root || "descriptions" in root || "columns" in root || "grain" in root) {
    return { value: root, fromSchemaManifest: false };
  }
  throw new YamlParseError("Imported YAML must be a table YAML snippet or a schema YAML with tables");
}

const SCHEMA_IMPORT_KEYS = ["table", "descriptions", "columns", "joins"] as const;
/** Manifest-only column keys that standalone/source YAML must not wipe on merge (P1). */
const MANIFEST_ONLY_COLUMN_KEYS = ["pk", "nullable"] as const;

function hasMeaningfulSchemaImport(imported: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(imported, "columns") ||
    Object.prototype.hasOwnProperty.call(imported, "descriptions") ||
    Object.prototype.hasOwnProperty.call(imported, "joins")
  );
}

/** Flat source/standalone with business keys — table-page import must not patch Manifest (P0). */
function isBusinessSourceImport(imported: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(imported, "grain") ||
    Object.prototype.hasOwnProperty.call(imported, "measures") ||
    Object.prototype.hasOwnProperty.call(imported, "segments")
  );
}

function mergeManifestColumns(existing: unknown, incoming: unknown): unknown {
  if (!Array.isArray(incoming)) {
    return incoming;
  }
  const existingByName = new Map<string, Record<string, unknown>>();
  if (Array.isArray(existing)) {
    for (const column of existing) {
      const record = valueAsRecord(column);
      if (typeof record.name === "string" && record.name.length > 0) {
        existingByName.set(record.name, record);
      }
    }
  }
  return incoming.map((column) => {
    const record = valueAsRecord(column);
    const name = record.name;
    if (typeof name !== "string" || name.length === 0) {
      return column;
    }
    const previous = existingByName.get(name);
    if (!previous) {
      return column;
    }
    const merged: Record<string, unknown> = { ...record };
    for (const key of MANIFEST_ONLY_COLUMN_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(merged, key) && Object.prototype.hasOwnProperty.call(previous, key)) {
        merged[key] = previous[key];
      }
    }
    return merged;
  });
}

/**
 * L25-16 — 一次 YAML 导入对【共享内容文件】的增量（不落盘）。
 *
 * 共享内容文件只有两类（Spec §6.3 / F07）：
 * - Manifest：`semantic-layer/<conn>/_schema/<schema>.yaml`（按连接 + Schema 共享）；
 * - Overlay：`semantic-layer/<conn>/<table>.yaml`（**路径不含 Schema**，故同连接不同 Schema
 *   的同名表也写同一文件）。
 *
 * 返回增量而不是整份文件内容，是为了让**同组多目标合并成一次文件写入**：
 * 多个目标的 Manifest 增量作用在同一份文档上，最后只写一次。
 */
export type SourceYamlImportDelta = {
  /** 会改的 Manifest 文件。 */
  manifest?: { relPath: string; table: string; merged: Record<string, unknown> };
  /** 会改的 Overlay 文件。 */
  overlay?: { relPath: string; grain: string[]; measures: Measure[]; segments: Segment[] };
};

export async function planSourceYamlImport(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  yaml: string
): Promise<SourceYamlImportDelta> {
  assertSafeSegment(table, "table");
  const relPath = schemaRelPath(conn, schema);
  const { doc } = await readYamlDocument(projectRoot, relPath);
  const existingTables = valueAsRecord(valueAsRecord(doc.toJSON()).tables);
  const existingTable = valueAsRecord(existingTables[table]);
  if (!existingTables[table]) {
    throw new SourceNotFoundError(`Source ${conn}/${schema}/${table} was not found`);
  }

  const { value: importedValue, fromSchemaManifest } = parseImportedTable(yaml, table);
  // Spec 114 + P0/P1 (2026-08-25):
  // - Overlay-only: never touch Manifest.
  // - Flat business source/standalone (grain|measures|segments): overlay only; do not
  //   patch Manifest columns (avoids wiping pk after a normal Manifest-then-source upload).
  // - Schema Manifest doc or structure-only snippet: merge into Manifest; P1 keeps
  //   existing pk/nullable when the incoming column omits them.
  const shouldPatchManifest =
    hasMeaningfulSchemaImport(importedValue) && (fromSchemaManifest || !isBusinessSourceImport(importedValue));
  let manifest: SourceYamlImportDelta["manifest"];
  if (shouldPatchManifest) {
    const schemaPatch: Record<string, unknown> = {};
    for (const key of SCHEMA_IMPORT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(importedValue, key)) {
        schemaPatch[key] = importedValue[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(schemaPatch, "columns")) {
      schemaPatch.columns = mergeManifestColumns(existingTable.columns, schemaPatch.columns);
    }
    const merged: Record<string, unknown> = { ...existingTable, ...schemaPatch };
    delete merged.name;
    delete merged.grain;
    delete merged.measures;
    delete merged.segments;
    manifest = { relPath, table, merged };
  }

  const hasOverlayImport =
    Object.prototype.hasOwnProperty.call(importedValue, "grain") ||
    Object.prototype.hasOwnProperty.call(importedValue, "measures") ||
    Object.prototype.hasOwnProperty.call(importedValue, "segments");

  const overlay = hasOverlayImport
    ? {
        relPath: path.posix.join("semantic-layer", conn, `${table}.yaml`),
        grain: stringArray(importedValue.grain) ?? [],
        measures: compact(
          (Array.isArray(importedValue.measures) ? importedValue.measures : []).map(normalizeMeasure)
        ),
        segments: compact(
          (Array.isArray(importedValue.segments) ? importedValue.segments : []).map(normalizeSegment)
        )
      }
    : undefined;

  return { manifest, overlay };
}

/**
 * L25-16 — 把**同一 Manifest 文件**上的多个导入增量合并成**一次**文件写入。
 *
 * 同连接同 Schema 的多表共享 `semantic-layer/<conn>/_schema/<schema>.yaml`——
 * 逐表 read-modify-write 会让后写者抹掉先写者的改动（D7 / G16）。这里在**一份文档**
 * 上依次应用各目标的增量，最后只产出一份内容。
 */
export async function applySourceYamlImportDeltas(
  projectRoot: string,
  manifestRelPath: string,
  deltas: ReadonlyArray<{ table: string; merged: Record<string, unknown> }>
): Promise<string> {
  const { doc } = await readYamlDocument(projectRoot, manifestRelPath);
  for (const delta of deltas) {
    doc.setIn(["tables", delta.table], doc.createNode(delta.merged));
  }
  return serialize(doc);
}

export async function previewSourceYamlImport(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  yaml: string
): Promise<SourcePreview> {
  assertSafeSegment(table, "table");
  const relPath = schemaRelPath(conn, schema);
  const { doc, text } = await readYamlDocument(projectRoot, relPath);
  const existingTables = valueAsRecord(valueAsRecord(doc.toJSON()).tables);
  if (!existingTables[table]) {
    throw new SourceNotFoundError(`Source ${conn}/${schema}/${table} was not found`);
  }

  // 增量计算只有这一处实现（控制面与既有 REST 入口共用）。
  const delta = await planSourceYamlImport(projectRoot, conn, schema, table, yaml);

  let proposedYaml = text;
  let diff = "";
  if (delta.manifest) {
    doc.setIn(["tables", delta.manifest.table], doc.createNode(delta.manifest.merged));
    proposedYaml = serialize(doc);
    diff = previewDiff(text, proposedYaml, relPath);
  }

  const overlayPreview = delta.overlay
    ? await previewOverlayUpdate(projectRoot, conn, table, {
        grain: delta.overlay.grain,
        measures: delta.overlay.measures,
        segments: delta.overlay.segments
      })
    : null;
  const files = [];
  if (diff) {
    files.push({
      filePath: relPath,
      diff,
      proposedYaml
    });
  }
  if (overlayPreview) {
    const overlayDiff = previewDiff(overlayPreview.oldText, overlayPreview.proposedText, overlayPreview.relPath);
    if (overlayDiff) {
      files.push({
        filePath: overlayPreview.relPath,
        diff: overlayDiff,
        proposedYaml: overlayPreview.proposedText
      });
    }
  }
  return {
    diff: files.map((file) => file.diff).filter(Boolean).join("\n"),
    proposedYaml: files.map((file) => `# ${file.filePath}\n${file.proposedYaml}`).join("\n"),
    files
  };
}

export async function writeSourceYamlImport(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  yaml: string,
  actor?: TrustedActor
): Promise<SourcePreview> {
  const preview = await previewSourceYamlImport(projectRoot, conn, schema, table, yaml);
  // L25-16 N05 / G17 — 旧的源表导入写入口接入**同一把** ktx.yaml 写锁。
  // 锁顺序与控制面批量服务一致：withKtxYamlWriteLock → withDisplayWriteBarrier → 写。
  await withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["D"], async (token) => {
      // Spec 195 §4 — the outer barrier covers the scopes of the files this
      // write really touches (the preview is already known here).
      expandDisplayWrite(token, await scopesForSourceFiles(projectRoot, preview.files));
      return withPublishCoordinator(
        "semantic_table_save",
        async () => {
          if (preview.files.length === 0) return;
          const opened = await openPromotingContentRelease({
            projectRoot,
            actor: actor?.actorId ?? "local-admin",
            targets: preview.files.map((file) => ({
              targetPath: file.filePath,
              expectedNewDigest: createHash("sha256").update(file.proposedYaml, "utf8").digest("hex"),
              assetKind: file.filePath.includes("/_schema/") ? "manifest" : "overlay",
              identity: { connectionId: conn, schema, table }
            }))
          });
          const journal = await createRecoveryJournal(projectRoot, {
            releaseId: opened.releaseId,
            operationId: opened.releaseId,
            actor: actor?.actorId ?? "local-admin",
            instanceId: await readOrCreateSemanticInstanceId(projectRoot),
            targets: preview.files.map((file) => ({
              targetPath: file.filePath,
              identity: { connectionId: conn, schema, table },
              newContent: file.proposedYaml
            }))
          });
          try {
            for (const file of preview.files) {
              await auditedWriteFile(projectRoot, file.filePath, file.proposedYaml, {
                enabled: true,
                changeType: "semantic_table_import",
                assetKind: "semantic",
                ...auditActorFields(actor),
                source: "semantic_layer_import_api",
                targetId: `${conn}:${schema}:${table}`,
                diff: file.diff,
                operation: "import"
              });
            }
            await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
            await closeContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              attemptId: opened.attemptId,
              actor: actor?.actorId ?? "local-admin",
              journalId: journal.journalId,
              changeType: "semantic_table_import_terminal",
              source: "semantic_layer_import_api",
              targetId: `${conn}:${schema}:${table}`,
              operation: "import_terminal",
              newSummary: { connectionId: conn, schema, table, fileCount: preview.files.length }
            });
          } catch (error) {
            // Spec 174 §3.2 / IM-02: a partial failure after touching disk
            // still invalidates the cache and leaves the written content in
            // place. Rolling a landed write back would contradict that
            // contract, so the batch settles with the files as they are.
            await failContentBatch(projectRoot, {
              releaseId: opened.releaseId,
              journalId: journal.journalId,
              keepLandedWrites: true
            });
            throw error;
          }
        },
        { projectRoot }
      );
    })
  );
  return preview;
}
