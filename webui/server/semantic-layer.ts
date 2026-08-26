import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Document, isMap, parse, parseDocument, Scalar, YAMLMap, YAMLSeq, type ParsedNode } from "yaml";
import { computeCompletion } from "./completion";
import { previewDiff } from "./diff";
import { assertReadable, ForbiddenPathError, safeWrite } from "./fs-safe";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import type { AuthoredText, Column, Join, ManifestSchemaSummary, Measure, Segment, SourceSummary, TableModel, TablePatch } from "./model";
import { previewOverlayUpdate } from "./overlay";
import { resolveEffectivePermissionsForAdmin } from "./proxy/acl.js";
import { readConnections } from "./project";
import { stripManifestOnlyColumnKeys } from "./semantic-overlay-sanitize";

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
  const absPath = await assertReadable(projectRoot, relPath);
  const text = await readFile(absPath, "utf8");
  return { doc: parseYaml(text, relPath), text };
}

async function listSchemaFiles(projectRoot: string): Promise<SchemaFile[]> {
  const base = path.join(projectRoot, "semantic-layer");
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
  const absPath = path.join(projectRoot, "semantic-layer", conn, `${table}.yaml`);
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

function sourceKey(conn: string, schema: string, table: string): string {
  return `${conn}${schema}${table}`;
}

type AuthorizedCountInput = {
  conn: string;
  schema: string;
  table: string;
};

/**
 * Counts enabled Agents whose effective permissions include each source.
 * Matches `connectionId === conn && schema === schema && sourceName === table`.
 * Disabled Agents are skipped. Returns 0 for every source when access.yaml is
 * missing, malformed, or any per-agent resolution fails — never throws.
 */
async function computeAuthorizedAgentCounts(
  projectRoot: string,
  sources: AuthorizedCountInput[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const s of sources) {
    counts.set(sourceKey(s.conn, s.schema, s.table), 0);
  }
  const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
  let raw: string;
  try {
    raw = await readFile(accessPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return counts;
    return counts;
  }
  let users: Array<{ id?: unknown; enabled?: unknown }> = [];
  try {
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { users?: unknown }).users)) {
      users = (parsed as { users: Array<{ id?: unknown; enabled?: unknown }> }).users;
    }
  } catch {
    return counts;
  }
  const enabledUsers = users.filter((u) => u && typeof u.id === "string" && u.enabled !== false);
  const resolutions = await Promise.all(
    enabledUsers.map(async (user) => {
      try {
        const resolved = await resolveEffectivePermissionsForAdmin(user.id as string);
        if (!resolved.ok) return [];
        return resolved.permissions.sources;
      } catch {
        return [];
      }
    })
  );
  for (const sources of resolutions) {
    for (const source of sources) {
      if (!source.connectionId) continue;
      const key = sourceKey(source.connectionId, source.schema, source.sourceName);
      if (!counts.has(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
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

export async function listSources(projectRoot: string): Promise<SourceSummary[]> {
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
  try {
    const connections = await readConnections(projectRoot);
    enabledByConnection = new Map(
      connections.map((conn) => [conn.id, new Set(conn.enabledTables)])
    );
  } catch {
    // Missing / unreadable ktx.yaml: treat every Manifest table as not enabled.
    enabledByConnection = new Map();
  }

  for (const file of await listSchemaFiles(projectRoot)) {
    const { doc } = await readYamlDocument(projectRoot, file.relPath);
    const root = valueAsRecord(doc.toJSON());
    const tables = valueAsRecord(root.tables);

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

  const authorizedCounts = await computeAuthorizedAgentCounts(projectRoot, authorizedInputs);

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

    const qualifiedName = model.qualifiedName ?? `${entry.file.schema}.${entry.table}`;
    const enabled =
      enabledByConnection.get(entry.file.conn)?.has(qualifiedName) ?? false;

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
      authorizedAgentCount: authorizedCounts.get(sourceKey(entry.file.conn, entry.file.schema, entry.table)) ?? 0,
      semanticUpdatedAt,
      semanticUpdatedAtSource
    };
  });

  return summaries.sort((a, b) => `${a.conn}/${a.schema}/${a.table}`.localeCompare(`${b.conn}/${b.schema}/${b.table}`));
}

export async function listManifestSchemas(projectRoot: string): Promise<ManifestSchemaSummary[]> {
  const summaries: ManifestSchemaSummary[] = [];
  for (const file of await listSchemaFiles(projectRoot)) {
    const { doc } = await readYamlDocument(projectRoot, file.relPath);
    const root = valueAsRecord(doc.toJSON());
    const tables = valueAsRecord(root.tables);
    summaries.push({
      conn: file.conn,
      schema: file.schema,
      filePath: file.relPath,
      tableCount: Object.keys(tables).length,
      mtime: file.mtime.toISOString()
    });
  }
  return summaries;
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

export async function writeSourcePatch(
  projectRoot: string,
  conn: string,
  schema: string,
  table: string,
  patch: TablePatch
): Promise<SourcePreview> {
  const preview = await buildSourcePatchPreview(projectRoot, conn, schema, table, patch);
  for (const file of preview.files) {
    await auditedWriteFile(projectRoot, file.filePath, file.proposedYaml, {
      enabled: true,
      changeType: "semantic_table_save",
      assetKind: "semantic",
      actorType: "ui_admin",
      source: "semantic_layer_patch_api",
      targetId: `${conn}:${schema}:${table}`,
      diff: file.diff,
      operation: "save"
    });
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
  let proposedYaml = text;
  let diff = "";
  const shouldPatchManifest =
    hasMeaningfulSchemaImport(importedValue) && (fromSchemaManifest || !isBusinessSourceImport(importedValue));
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
    doc.setIn(["tables", table], doc.createNode(merged));
    proposedYaml = serialize(doc);
    diff = previewDiff(text, proposedYaml, relPath);
  }

  const hasOverlayImport =
    Object.prototype.hasOwnProperty.call(importedValue, "grain") ||
    Object.prototype.hasOwnProperty.call(importedValue, "measures") ||
    Object.prototype.hasOwnProperty.call(importedValue, "segments");

  const overlayPreview = hasOverlayImport
    ? await previewOverlayUpdate(projectRoot, conn, table, {
        grain: stringArray(importedValue.grain) ?? [],
        measures: compact(
          (Array.isArray(importedValue.measures) ? importedValue.measures : []).map(normalizeMeasure)
        ),
        segments: compact(
          (Array.isArray(importedValue.segments) ? importedValue.segments : []).map(normalizeSegment)
        )
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
  yaml: string
): Promise<SourcePreview> {
  const preview = await previewSourceYamlImport(projectRoot, conn, schema, table, yaml);
  for (const file of preview.files) {
    await auditedWriteFile(projectRoot, file.filePath, file.proposedYaml, {
      enabled: true,
      changeType: "semantic_table_import",
      assetKind: "semantic",
      actorType: "ui_admin",
      source: "semantic_layer_import_api",
      targetId: `${conn}:${schema}:${table}`,
      diff: file.diff,
      operation: "import"
    });
  }
  return preview;
}
