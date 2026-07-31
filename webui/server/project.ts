import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { isMap, isScalar, isSeq, parse, parseDocument, type Document, type Node, YAMLSeq } from "yaml";
import { execFile } from "node:child_process";
import { testConnection } from "./ktx";
import { safeWrite } from "./fs-safe";
import { resolveMcpEndpoint } from "./runtime-config";
import type { AddSchemaPreview, AddSchemaResult, ConnectionInfo, ProjectInfo } from "./model";
import { previewDiff } from "./diff";

export type ProjectOptions = {
  projectRoot?: string;
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export class KtxYamlParseError extends Error {
  code = "KTX_YAML_PARSE_ERROR";
  statusCode = 500;

  constructor(message: string) {
    super(message);
    this.name = "KtxYamlParseError";
  }
}

export class ProjectError extends Error {
  code = "PROJECT_NOT_FOUND";
  statusCode = 404;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export class SchemaNameInvalidError extends Error {
  code = "SCHEMA_NAME_INVALID";
  statusCode = 400;
  detail: { pattern: string };

  constructor(message: string) {
    super(message);
    this.name = "SchemaNameInvalidError";
    this.detail = { pattern: "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$" };
  }
}

export class SchemaAlreadyExistsError extends Error {
  code = "SCHEMA_ALREADY_EXISTS";
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "SchemaAlreadyExistsError";
  }
}

export class ConnectionNotFoundError extends Error {
  code = "CONNECTION_NOT_FOUND";
  statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionTestFailedError extends Error {
  code = "CONNECTION_TEST_FAILED";
  statusCode = 400;
  detail: { stdout: string; stderr: string; reason: string };

  constructor(message: string, detail: { stdout: string; stderr: string; reason: string }) {
    super(message);
    this.name = "ConnectionTestFailedError";
    this.detail = detail;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function passwordSource(value: unknown): ConnectionInfo["passwordSource"] | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  if (value.startsWith("file:")) {
    return "file";
  }
  if (value.startsWith("env:") || value.includes("${")) {
    return "env";
  }
  return "inline";
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}

function displayString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function connectionEngine(conn: Record<string, unknown>): string | undefined {
  const explicit = normalizedString(conn.engine ?? conn.dialect ?? conn.database_engine);
  const driver = normalizedString(conn.driver);
  if (explicit) return explicit;
  if (!driver) return undefined;
  if (["doris", "apache-doris"].includes(driver)) return "doris";
  if (["starrocks", "starrocks-mysql"].includes(driver)) return "starrocks";
  if (driver.includes("postgres")) return "postgres";
  if (driver.includes("mysql")) return "mysql";
  return driver;
}

function wireProtocol(conn: Record<string, unknown>, engine?: string): ConnectionInfo["wireProtocol"] {
  const explicit = normalizedString(conn.wire_protocol ?? conn.protocol);
  if (explicit === "mysql" || explicit === "mysql-wire") return "mysql";
  if (explicit === "postgres" || explicit === "postgresql") return "postgres";
  if (explicit === "native") return "native";
  const driver = normalizedString(conn.driver);
  if (engine === "doris" || engine === "starrocks") return "mysql";
  if (driver?.includes("mysql")) return "mysql";
  if (driver?.includes("postgres")) return "postgres";
  return "unknown";
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }
  return undefined;
}

async function hasKtxYaml(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, "ktx.yaml"));
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await hasKtxYaml(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ProjectError(`Could not find ktx.yaml from ${start}`);
    }
    current = parent;
  }
}

function projectArg(argv: string[]): string | undefined {
  const index = argv.indexOf("--project");
  if (index >= 0) {
    return argv[index + 1];
  }
  const inline = argv.find((arg) => arg.startsWith("--project="));
  return inline?.slice("--project=".length);
}

export async function resolveProjectRoot(options: ProjectOptions = {}): Promise<string> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const explicit = options.projectRoot ?? projectArg(argv) ?? env.KTX_PROJECT_ROOT;
  if (explicit) {
    const root = path.resolve(explicit);
    if (!(await hasKtxYaml(root))) {
      throw new ProjectError(`Project root ${root} does not contain ktx.yaml`);
    }
    return root;
  }
  return findProjectRoot(options.cwd ?? process.cwd());
}

export async function readProject(projectRoot: string): Promise<ProjectInfo> {
  const yamlText = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  const config = valueAsRecord(parse(yamlText));
  const connectionsConfig = valueAsRecord(config.connections);
  const connections: ConnectionInfo[] = Object.entries(connectionsConfig).map(([id, raw]) => {
    const conn = valueAsRecord(raw);
    const explicitSchemas = stringArray(conn.schemas);
    const enabledTables = stringArray(conn.enabled_tables);
    const enabledSchemas = enabledTables.map((table) => table.split(".")[0]).filter(Boolean);
    const schemas = Array.from(new Set([...explicitSchemas, ...enabledSchemas])).sort();
    const engine = connectionEngine(conn);
    const readOnlyExpected = booleanValue(conn.readonly ?? conn.read_only ?? conn.readOnly) ?? true;
    return {
      id,
      driver: typeof conn.driver === "string" ? conn.driver : undefined,
      engine,
      wireProtocol: wireProtocol(conn, engine),
      r1Target: booleanValue(conn.r1_target ?? conn.r1Target) ?? engine === "doris",
      readOnlyExpected,
      passwordSource: passwordSource(conn.password),
      host: displayString(conn.host),
      port: displayString(conn.port),
      database: displayString(conn.database ?? conn.db ?? conn.dbname),
      schemas,
      enabledTables
    };
  });

  return {
    root: projectRoot,
    connections,
    ktxAvailable: true,
    mcpEndpoint: resolveMcpEndpoint()
  };
}

export async function readConnections(projectRoot: string): Promise<ConnectionInfo[]> {
  return (await readProject(projectRoot)).connections;
}

// ─── ktx.yaml in-place patch (ADR-01 / ADR-11) ────────────────────────────────
//
// Reads ktx.yaml via `parseDocument`, hands the Document to the caller for
// CST-level mutation, then serializes back via `doc.toString()` so comments,
// key order, and quoting style are preserved. Writes go through fs-safe's
// `ktx.yaml` ALLOW_FILES channel (M3.4).

export type WriteKtxYamlOptions = {
  dryRun?: boolean;
};

export type WriteKtxYamlResult = {
  doc: ReturnType<typeof parseDocument>;
  serialized: string;
  oldText: string;
};

export async function writeKtxYaml(
  root: string,
  mutator: (doc: ReturnType<typeof parseDocument>) => void,
  opts: WriteKtxYamlOptions = {}
): Promise<WriteKtxYamlResult> {
  const filePath = path.join(root, "ktx.yaml");
  const oldText = await readFile(filePath, "utf8");
  const doc = parseDocument(oldText, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    throw new KtxYamlParseError(`Failed to parse ktx.yaml: ${first?.message ?? "unknown error"}`);
  }
  mutator(doc);
  const serialized = doc.toString();
  if (!opts.dryRun) {
    await safeWrite(root, "ktx.yaml", serialized);
  }
  return { doc, serialized, oldText };
}

// ─── addSchema (M6 · ADR-11) ──────────────────────────────────────────────────

export const SCHEMA_NAME_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$";
const SCHEMA_NAME_RE = new RegExp(SCHEMA_NAME_PATTERN);

export type AddSchemaOptions = {
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  testConnectionFn?: typeof testConnection;
  execFileImpl?: Parameters<typeof testConnection>[2];
};

function schemasList(node: import("yaml").YAMLSeq | undefined): string[] {
  if (!node) return [];
  return node.items
    .map((item) => {
      if (typeof item === "string") return item;
      if (isScalar(item) && typeof item.value === "string") return item.value;
      return null;
    })
    .filter((value): value is string => value !== null);
}

function locateSchemas(
  doc: ReturnType<typeof parseDocument>,
  connId: string
): { seq: import("yaml").YAMLSeq | undefined; oldSchemas: string[] } {
  const conns = doc.get("connections", true);
  if (!isMap(conns)) {
    throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
  }
  const conn = conns.get(connId, true);
  if (!isMap(conn)) {
    throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
  }
  const schemasNode = conn.get("schemas", true);
  if (!schemasNode) {
    return { seq: undefined, oldSchemas: [] };
  }
  if (!isSeq(schemasNode)) {
    throw new KtxYamlParseError(`connections.${connId}.schemas is not a sequence`);
  }
  return { seq: schemasNode, oldSchemas: schemasList(schemasNode) };
}

function schemaAddMutatorFactory(schema: string, connId: string) {
  return (doc: ReturnType<typeof parseDocument>) => {
    const { seq, oldSchemas } = locateSchemas(doc, connId);
    if (oldSchemas.includes(schema)) {
      throw new SchemaAlreadyExistsError(
        `Schema '${schema}' already declared on connection '${connId}'`
      );
    }
    if (seq) {
      seq.items.push(schema);
      return;
    }
    // No existing `schemas:` key — create one in place so the surrounding block
    // formatting (e.g. sibling keys under the connection map) is preserved.
    const conns = doc.get("connections", true);
    if (!isMap(conns)) {
      throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
    }
    const conn = conns.get(connId, true);
    if (!isMap(conn)) {
      throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
    }
    const newSeq = new YAMLSeq();
    newSeq.items.push(schema);
    conn.set("schemas", newSeq);
  };
}

function schemasFromSerialized(yamlText: string, connId: string): string[] {
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  const { seq } = locateSchemas(doc, connId);
  return schemasList(seq);
}

const SENSITIVE_CONFIG_KEY_RE =
  /(?:password|passwd|pwd|credential|secret|token|api[-_]?key|authorization|private[-_]?key|cert)/i;

function redactSensitiveYamlNode(doc: Document, node: Node | null | undefined): void {
  if (isMap(node)) {
    for (let index = node.items.length - 1; index >= 0; index -= 1) {
      const pair = node.items[index];
      if (!pair) continue;
      const key = isScalar(pair.key) ? String(pair.key.value ?? "") : "";
      if (SENSITIVE_CONFIG_KEY_RE.test(key)) {
        node.items.splice(index, 1);
      } else {
        redactSensitiveYamlNode(doc, pair.value as Node | null | undefined);
      }
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      redactSensitiveYamlNode(doc, item as Node | null | undefined);
    }
  }
}

export function redactKtxYamlForPreview(yamlText: string): string {
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new KtxYamlParseError(
      `Failed to parse ktx.yaml for preview: ${doc.errors[0]?.message ?? "unknown error"}`
    );
  }
  redactSensitiveYamlNode(doc, doc.contents);
  return doc.toString();
}

export function addSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: true,
  options?: AddSchemaOptions
): Promise<AddSchemaPreview>;
export function addSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: false,
  options?: AddSchemaOptions
): Promise<AddSchemaResult>;
export function addSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: boolean,
  options?: AddSchemaOptions
): Promise<AddSchemaPreview | AddSchemaResult>;
export async function addSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: boolean,
  options: AddSchemaOptions = {}
): Promise<AddSchemaPreview | AddSchemaResult> {
  if (typeof schema !== "string" || !SCHEMA_NAME_RE.test(schema)) {
    throw new SchemaNameInvalidError(
      `Schema name '${schema}' does not match pattern ${SCHEMA_NAME_PATTERN}`
    );
  }

  // Phase 1 — apply the mutation in dryRun mode to compute the proposed file.
  // The mutator also doubles as the duplicate / connection-existence check.
  const mutator = schemaAddMutatorFactory(schema, connId);
  const preview = await writeKtxYaml(root, mutator, { dryRun: true });

  const oldSchemas = schemasFromSerialized(preview.oldText, connId);
  const newSchemas = schemasFromSerialized(preview.serialized, connId);
  const safeOldText = redactKtxYamlForPreview(preview.oldText);
  const safeProposedYaml = redactKtxYamlForPreview(preview.serialized);
  const diff = previewDiff(safeOldText, safeProposedYaml, "ktx.yaml");

  if (dryRun) {
    return {
      diff,
      proposedYaml: safeProposedYaml,
      oldSchemas,
      newSchemas
    };
  }

  // Phase 2 — write path. Pre-flight `ktx connection test` first; if it fails
  // we have not touched ktx.yaml yet, so no rollback is needed.
  const testFn = options.testConnectionFn ?? testConnection;
  const execFileImpl = options.execFileImpl ?? execFile;
  const testResult = await testFn(root, connId, execFileImpl);
  if (testResult.status !== "ok") {
    throw new ConnectionTestFailedError(
      `ktx connection test failed for '${connId}': ${testResult.reason ?? "unknown error"}`,
      {
        stdout: testResult.stdout ?? testResult.detail ?? "",
        stderr: testResult.stderr ?? testResult.reason ?? "",
        reason: testResult.reason ?? "Connection test failed"
      }
    );
  }

  // Phase 3 — actually persist via fs-safe. Re-run the same mutator (idempotent
  // because the doc still has the original `schemas` list — writeKtxYaml reads
  // fresh text from disk each call).
  await writeKtxYaml(root, mutator, { dryRun: false });

  let auditId: number | undefined;
  if (options.recordConfigChange) {
    auditId = await options.recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "schema_add",
      targetId: `${connId}:${schema}`,
      oldSummary: oldSchemas,
      newSummary: newSchemas,
      diff
    });
  }

  return {
    written: true,
    auditId,
    oldSchemas,
    newSchemas
  };
}
