import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isMap, parseDocument, Scalar, YAMLMap, YAMLSeq, type Document, type ParsedNode } from "yaml";
import { computeCompletion } from "./completion";
import { previewDiff } from "./diff";
import { assertReadable, ForbiddenPathError, safeWrite } from "./fs-safe";
import type { AuthoredText, Column, Join, Measure, Segment, SourceSummary, TableModel, TablePatch } from "./model";
import { previewOverlayUpdate } from "./overlay";

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

function tableYaml(doc: Document, table: string, sourceText: string): string {
  const node = tableNodeFromDocument(doc, table);
  if (!node) {
    return "";
  }
  const range = node.range;
  if (Array.isArray(range) && typeof range[0] === "number") {
    return sourceText.slice(range[0], range[2] ?? range[1]);
  }
  return node.toString();
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
  const summaries: SourceSummary[] = [];
  for (const file of await listSchemaFiles(projectRoot)) {
    const { doc } = await readYamlDocument(projectRoot, file.relPath);
    const root = valueAsRecord(doc.toJSON());
    const tables = valueAsRecord(root.tables);

    for (const [table, tableValue] of Object.entries(tables)) {
      const overlay = await readOverlay(projectRoot, file.conn, table);
      const model = modelFromTable(
        file.conn,
        file.schema,
        table,
        file.relPath,
        tableValue,
        tableNodeFromDocument(doc, table),
        overlay
      );
      summaries.push({
        conn: file.conn,
        schema: file.schema,
        table,
        filePath: file.relPath,
        columnCount: model.columns.length,
        columnNames: model.columns.map((column) => column.name),
        hasTableDesc: hasDescription(model.descriptions),
        hasGrain: Boolean(model.grain?.length),
        measureCount: model.measures?.length ?? 0,
        joinCount: model.joins?.length ?? 0,
        wikiRefCount: 0,
        completion: computeCompletion(model),
        mtime: file.mtime.toISOString()
      });
    }
  }

  return summaries.sort((a, b) => `${a.conn}/${a.schema}/${a.table}`.localeCompare(`${b.conn}/${b.schema}/${b.table}`));
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
    rawYaml: tableYaml(doc, table, text),
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
    await safeWrite(projectRoot, file.filePath, file.proposedYaml);
  }
  return preview;
}
