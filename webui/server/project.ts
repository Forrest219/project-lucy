import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMap, isScalar, isSeq, parse, parseDocument, stringify, type Document, type Node, YAMLMap, YAMLSeq } from "yaml";
import { execFile } from "node:child_process";
import { KtxCliError, testConnection } from "./ktx";
import { formatConnectionErrorMessage } from "./connection-errors";
import {
  ForbiddenPathError,
  safeRemove,
  safeRemoveSecretPasswordIfExists,
  safeWrite,
  safeWriteNewSecretPassword
} from "./fs-safe";
import { resolveMcpEndpoint } from "./runtime-config";
import type {
  AddSchemaPreview,
  AddSchemaResult,
  ConnectionInfo,
  CreateConnectionPreview,
  CreateConnectionResult,
  DeleteConnectionPreview,
  DeleteConnectionResult,
  ProbeConnectionResult,
  ProjectInfo,
  RemoveSchemaPreview,
  RemoveSchemaResult
} from "./model";
import { previewDiff } from "./diff";
import type { ConnectionTestResult } from "./ktx";

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

/**
 * Flow mappings (`{ key: value }`) cannot contain block lists. Lucy writers
 * must keep `connections.*` as block maps so later `enabled_tables` patches
 * stay valid YAML. Empty `connections: {}` is a flow map; children inherit it.
 */
function forceBlockYamlMaps(node: unknown): void {
  if (isMap(node)) {
    node.flow = false;
    for (const pair of node.items) {
      forceBlockYamlMaps(pair.value);
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      forceBlockYamlMaps(item);
    }
  }
}

function assertKtxYamlParses(text: string, context: string): void {
  const check = parseDocument(text);
  if (check.errors.length > 0) {
    throw new KtxYamlParseError(`${context}: ${check.errors[0]?.message ?? "unknown error"}`);
  }
}

function connectionsHaveFlowMap(node: unknown): boolean {
  if (isMap(node)) {
    if (node.flow) return true;
    return node.items.some((pair) => connectionsHaveFlowMap(pair.value));
  }
  if (isSeq(node)) {
    return node.items.some((item) => connectionsHaveFlowMap(item));
  }
  return false;
}

/**
 * Convert flow-style `connections` mappings to block style.
 * Already-block files are returned unchanged so enabled_tables line patches
 * stay byte-local.
 */
export function ktxYamlWithBlockConnections(yamlText: string): string {
  const doc = parseDocument(yamlText, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new KtxYamlParseError(`Failed to parse ktx.yaml: ${doc.errors[0]?.message ?? "unknown error"}`);
  }
  const conns = doc.get("connections", true);
  if (!isMap(conns) || !connectionsHaveFlowMap(conns)) {
    return yamlText;
  }
  forceBlockYamlMaps(conns);
  const serialized = doc.toString();
  assertKtxYamlParses(serialized, "Failed to serialize ktx.yaml");
  return serialized;
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

export class SchemaNotFoundError extends Error {
  code = "SCHEMA_NOT_FOUND";
  statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "SchemaNotFoundError";
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

/** Spec 124: `connections.<id>` key naming. */
export const CONNECTION_ID_PATTERN = "^[a-z][a-z0-9_-]{1,63}$";
const CONNECTION_ID_RE = new RegExp(CONNECTION_ID_PATTERN);

export class ConnectionIdInvalidError extends Error {
  code = "CONNECTION_ID_INVALID";
  statusCode = 400;
  detail: { pattern: string };

  constructor(message: string) {
    super(message);
    this.name = "ConnectionIdInvalidError";
    this.detail = { pattern: CONNECTION_ID_PATTERN };
  }
}

export class ConnectionAlreadyExistsError extends Error {
  code = "CONNECTION_ALREADY_EXISTS";
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "ConnectionAlreadyExistsError";
  }
}

export class ConnectionPasswordRequiredError extends Error {
  code = "CONNECTION_PASSWORD_REQUIRED";
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ConnectionPasswordRequiredError";
  }
}

export class ConnectionCreateValidationError extends Error {
  code = "CONNECTION_CREATE_INVALID";
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ConnectionCreateValidationError";
  }
}

/** Spec 127: deleteSecret requested but password is not the conventional file. */
export class ConnectionDeleteSecretNotEligibleError extends Error {
  code = "CONNECTION_DELETE_SECRET_NOT_ELIGIBLE";
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ConnectionDeleteSecretNotEligibleError";
  }
}

export function connectionSecretRelPath(connId: string): string {
  if (!CONNECTION_ID_RE.test(connId)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${connId}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  return `.ktx/secrets/${connId}-password`;
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
  const conns = doc.get("connections", true);
  if (isMap(conns)) forceBlockYamlMaps(conns);
  const serialized = doc.toString();
  assertKtxYamlParses(serialized, "Failed to serialize ktx.yaml");
  if (!opts.dryRun) {
    await safeWrite(root, "ktx.yaml", serialized);
  }
  return { doc, serialized, oldText };
}

// ─── addSchema (M6 · ADR-11) ──────────────────────────────────────────────────

export const SCHEMA_NAME_PATTERN = "^[a-zA-Z_][a-zA-Z0-9_]{0,62}$";
const SCHEMA_NAME_RE = new RegExp(SCHEMA_NAME_PATTERN);

/** Path segment for conn/table under semantic-layer (blocks traversal). */
const SAFE_PATH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isSafePathSegment(value: string): boolean {
  return typeof value === "string" && SAFE_PATH_SEGMENT_RE.test(value);
}

function overlayRelPath(connId: string, tableName: string): string | null {
  if (!isSafePathSegment(connId) || !isSafePathSegment(tableName)) {
    return null;
  }
  return `semantic-layer/${connId}/${tableName}.yaml`;
}

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
        const rawValue = isScalar(pair.value) ? String(pair.value.value ?? "") : "";
        // Spec 124: keep file:/env: references in previews; strip inline secrets only.
        if (
          rawValue.startsWith("file:") ||
          rawValue.startsWith("env:") ||
          rawValue.includes("${")
        ) {
          continue;
        }
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

// ─── removeSchema (Spec 117) ──────────────────────────────────────────────────

export type RemoveSchemaOptions = {
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  listWikiFn?: typeof import("./wiki").listWiki;
  deleteManifest?: boolean;
  deleteOverlays?: boolean;
};

function locateEnabledTables(
  doc: ReturnType<typeof parseDocument>,
  connId: string
): import("yaml").YAMLSeq | undefined {
  const conns = doc.get("connections", true);
  if (!isMap(conns)) return undefined;
  const conn = conns.get(connId, true);
  if (!isMap(conn)) return undefined;
  const node = conn.get("enabled_tables", true);
  if (!node || !isSeq(node)) return undefined;
  return node;
}

function enabledTablesList(node: import("yaml").YAMLSeq | undefined): string[] {
  if (!node) return [];
  return node.items
    .map((item) => {
      if (typeof item === "string") return item;
      if (isScalar(item) && typeof item.value === "string") return item.value;
      return null;
    })
    .filter((v): v is string => v !== null);
}

export function removeSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: true,
  options?: RemoveSchemaOptions
): Promise<RemoveSchemaPreview>;
export function removeSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: false,
  options?: RemoveSchemaOptions
): Promise<RemoveSchemaResult>;
export function removeSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: boolean,
  options?: RemoveSchemaOptions
): Promise<RemoveSchemaPreview | RemoveSchemaResult>;
export async function removeSchema(
  root: string,
  connId: string,
  schema: string,
  dryRun: boolean,
  options: RemoveSchemaOptions = {}
): Promise<RemoveSchemaPreview | RemoveSchemaResult> {
  if (typeof schema !== "string" || !SCHEMA_NAME_RE.test(schema)) {
    throw new SchemaNameInvalidError(
      `Schema name '${schema}' does not match pattern ${SCHEMA_NAME_PATTERN}`
    );
  }

  // Read current state to check existence and gather old values.
  const ktxPath = path.join(root, "ktx.yaml");
  const currentText = await readFile(ktxPath, "utf8");
  const currentDoc = parseDocument(currentText, { keepSourceTokens: true });
  if (currentDoc.errors.length > 0) {
    throw new KtxYamlParseError(`Failed to parse ktx.yaml: ${currentDoc.errors[0]?.message ?? "unknown error"}`);
  }

  const { oldSchemas } = locateSchemas(currentDoc, connId);
  const etSeq = locateEnabledTables(currentDoc, connId);
  const currentEnabledTables = enabledTablesList(etSeq);
  const prefix = `${schema}.`;
  const removedEnabledTables = currentEnabledTables.filter((t) => t.startsWith(prefix));

  const inSchemas = oldSchemas.includes(schema);
  const inEnabled = removedEnabledTables.length > 0;
  if (!inSchemas && !inEnabled) {
    throw new SchemaNotFoundError(
      `Schema '${schema}' not found in schemas list or enabled_tables for connection '${connId}'`
    );
  }

  // Build the mutator: remove from schemas seq + prune enabled_tables.
  const mutator = (doc: ReturnType<typeof parseDocument>) => {
    // Remove from schemas list if present.
    const { seq } = locateSchemas(doc, connId);
    if (seq) {
      for (let i = seq.items.length - 1; i >= 0; i--) {
        const item = seq.items[i];
        const val = typeof item === "string" ? item : isScalar(item) && typeof item.value === "string" ? item.value : null;
        if (val === schema) {
          seq.items.splice(i, 1);
        }
      }
    }
    // Prune enabled_tables.
    const etNode = locateEnabledTables(doc, connId);
    if (etNode) {
      for (let i = etNode.items.length - 1; i >= 0; i--) {
        const item = etNode.items[i];
        const val = typeof item === "string" ? item : isScalar(item) && typeof item.value === "string" ? item.value : null;
        if (val && val.startsWith(prefix)) {
          etNode.items.splice(i, 1);
        }
      }
    }
  };

  const preview = await writeKtxYaml(root, mutator, { dryRun: true });
  const newSchemas = schemasFromSerialized(preview.serialized, connId);
  const safeOldText = redactKtxYamlForPreview(preview.oldText);
  const safeProposedYaml = redactKtxYamlForPreview(preview.serialized);
  const diff = previewDiff(safeOldText, safeProposedYaml, "ktx.yaml");

  // Impact collection.
  const manifestPath = `semantic-layer/${connId}/_schema/${schema}.yaml`;
  const manifestAbsPath = path.join(root, manifestPath);
  let hasManifest = false;
  let manifestTableNames: string[] = [];
  try {
    const manifestText = await readFile(manifestAbsPath, "utf8");
    hasManifest = true;
    const manifestDoc = parse(manifestText) as Record<string, unknown> | null;
    const tables = manifestDoc && typeof manifestDoc === "object" && manifestDoc.tables && typeof manifestDoc.tables === "object"
      ? manifestDoc.tables as Record<string, unknown>
      : {};
    manifestTableNames = Object.keys(tables);
  } catch {
    hasManifest = false;
  }

  // Overlay paths: union of manifest table names + removedEnabledTables table names.
  // Reject unsafe path segments (e.g. `../ktx`) before join / existence probe / delete.
  const tableNamesForOverlay = new Set<string>([
    ...manifestTableNames,
    ...removedEnabledTables.map((t) => t.slice(prefix.length))
  ]);
  const overlayPaths: string[] = [];
  for (const tableName of tableNamesForOverlay) {
    const relPath = overlayRelPath(connId, tableName);
    if (!relPath) continue;
    try {
      await readFile(path.join(root, relPath), "utf8");
      overlayPaths.push(relPath);
    } catch {
      // File does not exist; skip.
    }
  }

  // Wiki refs.
  let wikiRefCount = 0;
  let wikiSamplePaths: string[] = [];
  try {
    const listWikiFn = options.listWikiFn ?? (await import("./wiki")).listWiki;
    const wikiPages = await listWikiFn(root);
    const slRefPrefix = `${connId}/${schema}/`;
    const matching = wikiPages.filter((page) =>
      page.slRefs.some((ref) => ref.startsWith(slRefPrefix))
    );
    wikiRefCount = matching.length;
    // listWiki keys are already relative under wiki/ and usually end with `.md`
    // (e.g. `global/playbook.md`). Do not append another `.md`.
    wikiSamplePaths = matching.slice(0, 5).map((page) =>
      page.key.startsWith("wiki/") ? page.key : `wiki/${page.key}`
    );
  } catch {
    wikiRefCount = 0;
    wikiSamplePaths = [];
  }

  const impact = {
    hasManifest,
    manifestPath: hasManifest ? manifestPath : null,
    overlayPaths,
    wikiRefCount,
    wikiSamplePaths
  };

  if (dryRun) {
    return {
      diff,
      proposedYaml: safeProposedYaml,
      oldSchemas,
      newSchemas,
      removedEnabledTables,
      impact
    };
  }

  // Write path. Preflight optional deletes so we fail closed before mutating ktx.yaml.
  if (options.deleteManifest && hasManifest) {
    if (!isSafePathSegment(connId) || !isSafePathSegment(schema)) {
      throw new ForbiddenPathError("connectionId or schema is not a safe path segment for Manifest delete");
    }
  }
  if (options.deleteOverlays) {
    for (const overlayPath of overlayPaths) {
      // Already filtered by overlayRelPath; double-check no traversal slipped in.
      if (overlayPath.includes("..") || !overlayPath.startsWith(`semantic-layer/${connId}/`)) {
        throw new ForbiddenPathError(`Refusing to delete unsafe overlay path ${overlayPath}`);
      }
    }
  }

  await writeKtxYaml(root, mutator, { dryRun: false });

  const deletedFiles: string[] = [];

  // Optional: delete manifest (safeRemove no-ops ENOENT).
  if (options.deleteManifest && hasManifest) {
    await safeRemove(root, manifestPath);
    deletedFiles.push(manifestPath);
  }

  // Optional: delete overlays.
  if (options.deleteOverlays) {
    for (const overlayPath of overlayPaths) {
      await safeRemove(root, overlayPath);
      deletedFiles.push(overlayPath);
    }
  }

  let auditId: number | undefined;
  if (options.recordConfigChange) {
    auditId = await options.recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "schema_remove",
      targetId: `${connId}:${schema}`,
      oldSummary: { schemas: oldSchemas, removedEnabledTables },
      newSummary: { schemas: newSchemas, removedEnabledTables },
      diff
    });
  }

  return {
    written: true,
    auditId,
    oldSchemas,
    newSchemas,
    removedEnabledTables,
    deletedFiles
  };
}

// ─── removeConnection (Spec 127) ──────────────────────────────────────────────

export type RemoveConnectionOptions = {
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  listWikiFn?: typeof import("./wiki").listWiki;
  deleteSecret?: boolean;
  deleteAssets?: boolean;
};

function yamlScalarString(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (isScalar(item) && typeof item.value === "string") return item.value;
  return null;
}

function locateConnectionMap(
  doc: ReturnType<typeof parseDocument>,
  connId: string
): import("yaml").YAMLMap {
  const conns = doc.get("connections", true);
  if (!isMap(conns)) {
    throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
  }
  const conn = conns.get(connId, true);
  if (!isMap(conn)) {
    throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
  }
  return conn;
}

function conventionalSecretRelPathIfEligible(
  root: string,
  connId: string,
  passwordValue: string | null
): string | null {
  if (!passwordValue || !passwordValue.startsWith("file:")) return null;
  const expectedRel = connectionSecretRelPath(connId);
  const expectedAbs = path.resolve(path.join(root, expectedRel));
  const referencedAbs = path.resolve(passwordValue.slice("file:".length));
  return referencedAbs === expectedAbs ? expectedRel : null;
}

async function listConnectionYamlAssets(root: string, connId: string): Promise<string[]> {
  if (!isSafePathSegment(connId)) return [];
  const relDir = `semantic-layer/${connId}`;
  return walkYamlFiles(path.join(root, relDir), relDir);
}

async function walkYamlFiles(absDir: string, relDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "." || entry.name === ".." || entry.name.includes("..") || entry.name.includes("/") || entry.name.includes("\\")) {
      continue;
    }
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!isSafePathSegment(entry.name)) continue;
      out.push(...(await walkYamlFiles(path.join(absDir, entry.name), relPath)));
      continue;
    }
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    out.push(relPath);
  }
  return out;
}

async function collectAclRoleIds(root: string, connId: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const roles = (parsed as Record<string, unknown>).roles;
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return [];
  const ids: string[] = [];
  for (const [roleId, roleValue] of Object.entries(roles as Record<string, unknown>)) {
    if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
    const allow = (roleValue as Record<string, unknown>).allow;
    if (!allow || typeof allow !== "object" || Array.isArray(allow)) continue;
    const connections = (allow as Record<string, unknown>).connections;
    const listed = Array.isArray(connections)
      ? connections.some((item) => item === connId)
      : false;
    const selectors = (allow as Record<string, unknown>).tableSelectors;
    const inSelectors = Array.isArray(selectors)
      ? selectors.some(
          (row) =>
            row &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            (row as Record<string, unknown>).connection === connId
        )
      : false;
    if (listed || inSelectors) ids.push(roleId);
  }
  return ids;
}

function connectionDeleteMutatorFactory(connId: string) {
  return (doc: ReturnType<typeof parseDocument>) => {
    const conns = doc.get("connections", true);
    if (!isMap(conns) || !conns.has(connId)) {
      throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
    }
    conns.delete(connId);

    const setup = doc.get("setup", true);
    if (!isMap(setup)) return;
    const ids = setup.get("database_connection_ids", true);
    if (!isSeq(ids)) return;
    for (let i = ids.items.length - 1; i >= 0; i--) {
      if (yamlScalarString(ids.items[i]) === connId) {
        ids.items.splice(i, 1);
      }
    }
  };
}

export function removeConnection(
  root: string,
  connId: string,
  dryRun: true,
  options?: RemoveConnectionOptions
): Promise<DeleteConnectionPreview>;
export function removeConnection(
  root: string,
  connId: string,
  dryRun: false,
  options?: RemoveConnectionOptions
): Promise<DeleteConnectionResult>;
export function removeConnection(
  root: string,
  connId: string,
  dryRun: boolean,
  options?: RemoveConnectionOptions
): Promise<DeleteConnectionPreview | DeleteConnectionResult>;
export async function removeConnection(
  root: string,
  connId: string,
  dryRun: boolean,
  options: RemoveConnectionOptions = {}
): Promise<DeleteConnectionPreview | DeleteConnectionResult> {
  if (!CONNECTION_ID_RE.test(connId)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${connId}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }

  const ktxPath = path.join(root, "ktx.yaml");
  const currentText = await readFile(ktxPath, "utf8");
  const currentDoc = parseDocument(currentText, { keepSourceTokens: true });
  if (currentDoc.errors.length > 0) {
    throw new KtxYamlParseError(
      `Failed to parse ktx.yaml: ${currentDoc.errors[0]?.message ?? "unknown error"}`
    );
  }

  const conn = locateConnectionMap(currentDoc, connId);
  const { oldSchemas } = locateSchemas(currentDoc, connId);
  const enabledTables = enabledTablesList(locateEnabledTables(currentDoc, connId));
  const passwordValue = yamlScalarString(conn.get("password"));
  const secretRelPath = conventionalSecretRelPathIfEligible(root, connId, passwordValue);
  const canDeleteSecret = secretRelPath !== null;

  const mutator = connectionDeleteMutatorFactory(connId);
  const preview = await writeKtxYaml(root, mutator, { dryRun: true });
  const safeOldText = redactKtxYamlForPreview(preview.oldText);
  const safeProposedYaml = redactKtxYamlForPreview(preview.serialized);
  const diff = previewDiff(safeOldText, safeProposedYaml, "ktx.yaml");

  const yamlAssetPaths = await listConnectionYamlAssets(root, connId);
  const aclRoleIds = await collectAclRoleIds(root, connId);

  let wikiRefCount = 0;
  let wikiSamplePaths: string[] = [];
  try {
    const listWikiFn = options.listWikiFn ?? (await import("./wiki")).listWiki;
    const wikiPages = await listWikiFn(root);
    const slRefPrefix = `${connId}/`;
    const matching = wikiPages.filter((page) =>
      page.slRefs.some((ref) => ref === connId || ref.startsWith(slRefPrefix))
    );
    wikiRefCount = matching.length;
    wikiSamplePaths = matching.slice(0, 5).map((page) =>
      page.key.startsWith("wiki/") ? page.key : `wiki/${page.key}`
    );
  } catch {
    wikiRefCount = 0;
    wikiSamplePaths = [];
  }

  const impact = {
    canDeleteSecret,
    secretRelPath,
    yamlAssetPaths,
    aclRoleIds,
    wikiRefCount,
    wikiSamplePaths
  };

  if (dryRun) {
    return {
      diff,
      proposedYaml: safeProposedYaml,
      connectionId: connId,
      schemas: oldSchemas,
      enabledTables,
      impact
    };
  }

  if (options.deleteSecret && !canDeleteSecret) {
    throw new ConnectionDeleteSecretNotEligibleError(
      `Password for '${connId}' is not the conventional .ktx/secrets/${connId}-password file`
    );
  }

  if (options.deleteAssets) {
    for (const assetPath of yamlAssetPaths) {
      if (assetPath.includes("..") || !assetPath.startsWith(`semantic-layer/${connId}/`)) {
        throw new ForbiddenPathError(`Refusing to delete unsafe YAML asset path ${assetPath}`);
      }
    }
  }

  await writeKtxYaml(root, mutator, { dryRun: false });

  const deletedFiles: string[] = [];
  if (options.deleteSecret && secretRelPath) {
    try {
      await safeRemoveSecretPasswordIfExists(root, secretRelPath);
      deletedFiles.push(secretRelPath);
    } catch {
      // yaml already committed; leftover secret is recoverable by hand
    }
  }
  if (options.deleteAssets) {
    for (const assetPath of yamlAssetPaths) {
      try {
        await safeRemove(root, assetPath);
        deletedFiles.push(assetPath);
      } catch {
        // leftover YAML assets are recoverable by hand
      }
    }
  }

  let auditId: number | undefined;
  if (options.recordConfigChange) {
    auditId = await options.recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "connection_delete",
      targetId: connId,
      oldSummary: { connectionId: connId, schemas: oldSchemas, enabledTables },
      newSummary: { connectionId: connId, deleted: true, deletedFiles },
      diff
    });
  }

  return {
    written: true,
    auditId,
    connectionId: connId,
    deletedFiles
  };
}

// ─── createConnection (Spec 124 Phase A) ──────────────────────────────────────

export type CreateConnectionInput = {
  id: string;
  driver: "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite";
  engine?: string;
  wireProtocol?: string;
  readonly?: boolean;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  /** Required when dryRun is false (except sqlite without password); ignored for dryRun preview. */
  password?: string;
  schemas?: string[];
};

export type CreateConnectionOptions = {
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  testConnectionFn?: typeof testConnection;
  execFileImpl?: Parameters<typeof testConnection>[2];
};

function requiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConnectionCreateValidationError(`${field} is required`);
  }
  return value.trim();
}

const VALID_CREATE_DRIVERS = new Set(["mysql", "postgres", "sqlserver", "oracle", "sqlite"]);

function validateCreateConnectionInput(input: CreateConnectionInput): CreateConnectionInput {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!CONNECTION_ID_RE.test(id)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${id}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  if (!VALID_CREATE_DRIVERS.has(input.driver)) {
    throw new ConnectionCreateValidationError("driver must be mysql, postgres, sqlserver, oracle, or sqlite");
  }
  const isSqlite = input.driver === "sqlite";
  const database = requiredNonEmptyString(input.database, "database");

  let host = "";
  let username = "";
  let port: number | undefined;

  if (!isSqlite) {
    host = requiredNonEmptyString(input.host, "host");
    username = requiredNonEmptyString(input.username, "username");
    if (typeof input.port !== "number" || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new ConnectionCreateValidationError("port must be an integer between 1 and 65535");
    }
    port = input.port;
  } else {
    host = typeof input.host === "string" ? input.host.trim() : "";
    username = typeof input.username === "string" ? input.username.trim() : "";
    if (typeof input.port === "number" && Number.isInteger(input.port) && input.port >= 1 && input.port <= 65535) {
      port = input.port;
    }
  }

  const schemas = Array.isArray(input.schemas) ? input.schemas : [];
  for (const schema of schemas) {
    if (typeof schema !== "string" || !SCHEMA_NAME_RE.test(schema)) {
      throw new SchemaNameInvalidError(
        `Schema name '${schema}' does not match pattern ${SCHEMA_NAME_PATTERN}`
      );
    }
  }
  const engine =
    typeof input.engine === "string" && input.engine.trim() ? input.engine.trim() : undefined;
  const wireProtocol =
    typeof input.wireProtocol === "string" && input.wireProtocol.trim()
      ? input.wireProtocol.trim()
      : undefined;
  return {
    id,
    driver: input.driver,
    ...(engine ? { engine } : {}),
    ...(wireProtocol ? { wireProtocol } : {}),
    readonly: input.readonly !== false,
    host,
    ...(port != null ? { port } : {}),
    database,
    username,
    ...(typeof input.password === "string" ? { password: input.password } : {}),
    schemas
  };
}

function passwordFileRef(projectRoot: string, connId: string): string {
  return `file:${path.join(projectRoot, ".ktx", "secrets", `${connId}-password`)}`;
}

function connectionCreateMutatorFactory(input: CreateConnectionInput, passwordRef?: string) {
  return (doc: ReturnType<typeof parseDocument>) => {
    let conns = doc.get("connections", true);
    if (!conns) {
      conns = new YAMLMap();
      doc.set("connections", conns);
    }
    if (!isMap(conns)) {
      throw new KtxYamlParseError("connections is not a mapping in ktx.yaml");
    }
    forceBlockYamlMaps(conns);
    if (conns.has(input.id)) {
      throw new ConnectionAlreadyExistsError(`Connection '${input.id}' already exists in ktx.yaml`);
    }

    const conn = new YAMLMap();
    conn.flow = false;
    conn.set("driver", input.driver);
    if (input.engine) {
      conn.set("engine", input.engine);
    }
    if (input.wireProtocol) {
      conn.set("wire_protocol", input.wireProtocol);
    }
    conn.set("readonly", input.readonly !== false);
    const enabledTables = new YAMLSeq();
    conn.set("enabled_tables", enabledTables);
    if (input.host) {
      conn.set("host", input.host);
    }
    if (input.port != null) {
      conn.set("port", input.port);
    }
    conn.set("database", input.database);
    if (input.username) {
      conn.set("username", input.username);
    }
    if (passwordRef) {
      conn.set("password", passwordRef);
    }
    const schemas = new YAMLSeq();
    for (const schema of input.schemas ?? []) {
      schemas.items.push(schema);
    }
    conn.set("schemas", schemas);
    conns.set(input.id, conn);

    let setup = doc.get("setup", true);
    if (!setup) {
      setup = new YAMLMap();
      doc.set("setup", setup);
    }
    if (isMap(setup)) {
      let ids = setup.get("database_connection_ids", true);
      if (!ids) {
        ids = new YAMLSeq();
        setup.set("database_connection_ids", ids);
      }
      if (isSeq(ids)) {
        const existing = schemasList(ids);
        if (!existing.includes(input.id)) {
          ids.items.push(input.id);
        }
      }
    }
  };
}

function connectionInfoFromInput(
  input: CreateConnectionInput,
  passwordSource?: ConnectionInfo["passwordSource"]
): ConnectionInfo {
  const engine = input.engine?.toLowerCase();
  let wireProtocol: ConnectionInfo["wireProtocol"] = "unknown";
  if (input.wireProtocol === "mysql" || input.wireProtocol === "mysql-wire") {
    wireProtocol = "mysql";
  } else if (input.wireProtocol === "postgres" || input.wireProtocol === "postgresql") {
    wireProtocol = "postgres";
  } else if (engine === "doris" || engine === "starrocks" || input.driver === "mysql") {
    wireProtocol = "mysql";
  } else if (input.driver === "postgres") {
    wireProtocol = "postgres";
  }
  return {
    id: input.id,
    driver: input.driver,
    engine,
    wireProtocol,
    r1Target: engine === "doris",
    readOnlyExpected: input.readonly !== false,
    ...(passwordSource ? { passwordSource } : {}),
    ...(input.host ? { host: input.host } : {}),
    ...(input.port != null ? { port: String(input.port) } : {}),
    database: input.database,
    schemas: [...(input.schemas ?? [])].sort(),
    enabledTables: []
  };
}

export function createConnection(
  root: string,
  input: CreateConnectionInput,
  dryRun: true,
  options?: CreateConnectionOptions
): Promise<CreateConnectionPreview>;
export function createConnection(
  root: string,
  input: CreateConnectionInput,
  dryRun: false,
  options?: CreateConnectionOptions
): Promise<CreateConnectionResult>;
export function createConnection(
  root: string,
  input: CreateConnectionInput,
  dryRun: boolean,
  options?: CreateConnectionOptions
): Promise<CreateConnectionPreview | CreateConnectionResult>;
export async function createConnection(
  root: string,
  rawInput: CreateConnectionInput,
  dryRun: boolean,
  options: CreateConnectionOptions = {}
): Promise<CreateConnectionPreview | CreateConnectionResult> {
  const input = validateCreateConnectionInput(rawInput);
  const isSqlite = input.driver === "sqlite";
  const hasPasswordInput = typeof input.password === "string" && input.password.length > 0;
  const secretRelPath = connectionSecretRelPath(input.id);
  const passwordRef = hasPasswordInput || !isSqlite ? passwordFileRef(root, input.id) : undefined;
  const mutator = connectionCreateMutatorFactory(input, passwordRef);
  const preview = await writeKtxYaml(root, mutator, { dryRun: true });
  const safeOldText = redactKtxYamlForPreview(preview.oldText);
  const safeProposedYaml = redactKtxYamlForPreview(preview.serialized);
  const diff = previewDiff(safeOldText, safeProposedYaml, "ktx.yaml");
  const connection = connectionInfoFromInput(input, passwordRef ? "file" : undefined);

  if (dryRun) {
    return {
      diff,
      proposedYaml: safeProposedYaml,
      secretRelPath,
      connection
    };
  }

  if (!isSqlite && !hasPasswordInput) {
    throw new ConnectionPasswordRequiredError("password is required when dryRun is false");
  }

  // Write secret then yaml. Connectivity is best-effort: a failed test must not
  // roll back a successfully written connection (ops may save while the DB is down).
  let secretWritten = false;
  let yamlWritten = false;
  try {
    if (hasPasswordInput) {
      await safeWriteNewSecretPassword(root, secretRelPath, input.password!);
      secretWritten = true;
    }
    await writeKtxYaml(root, mutator, { dryRun: false });
    yamlWritten = true;
  } catch (error) {
    if (yamlWritten) {
      await safeWrite(root, "ktx.yaml", preview.oldText);
    }
    if (secretWritten) {
      await safeRemoveSecretPasswordIfExists(root, secretRelPath);
    }
    throw error;
  }

  const testFn = options.testConnectionFn ?? testConnection;
  const execFileImpl = options.execFileImpl ?? execFile;
  let testStatus: "ok" | "error" = "ok";
  let testMessage: string | undefined;
  let durationMs: number | undefined;
  try {
    const testResult: ConnectionTestResult = await testFn(root, input.id, execFileImpl);
    durationMs = testResult.latencyMs;
    if (testResult.status === "ok") {
      testMessage = testResult.detail;
    } else {
      testStatus = "error";
      testMessage = testResult.reason?.trim() || "连接失败";
    }
  } catch (error) {
    testStatus = "error";
    testMessage =
      error instanceof KtxCliError
        ? "无法执行连通测试：未找到 ktx CLI"
        : error instanceof Error
          ? error.message
          : "连通测试失败";
  }

  let auditId: number | undefined;
  if (options.recordConfigChange) {
    auditId = await options.recordConfigChange({
      filePath: "ktx.yaml",
      changeType: "connection_create",
      targetId: input.id,
      oldSummary: { connections: "unchanged" },
      newSummary: {
        connectionId: input.id,
        secretRelPath,
        passwordBytes: Buffer.byteLength(input.password, "utf8"),
        driver: input.driver,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        testStatus
      },
      diff
    });
  }

  return {
    written: true,
    auditId,
    secretRelPath,
    connection,
    test: {
      status: testStatus,
      message: testMessage,
      durationMs
    }
  };
}

const PROBE_CONNECTION_ID = "probe";

export async function probeConnection(
  rawInput: Omit<CreateConnectionInput, "id" | "schemas">,
  options: CreateConnectionOptions = {}
): Promise<ProbeConnectionResult> {
  const input = validateCreateConnectionInput({
    ...rawInput,
    id: PROBE_CONNECTION_ID,
    schemas: []
  });
  const isSqlite = input.driver === "sqlite";
  const hasPasswordInput = typeof input.password === "string" && input.password.length > 0;
  if (!isSqlite && !hasPasswordInput) {
    throw new ConnectionPasswordRequiredError("password is required to test the connection");
  }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-conn-probe-"));
  try {
    const secretRelPath = connectionSecretRelPath(PROBE_CONNECTION_ID);
    const secretAbs = path.join(tmpRoot, secretRelPath);
    let passwordRef: string | undefined;
    if (hasPasswordInput) {
      await mkdir(path.dirname(secretAbs), { recursive: true });
      await writeFile(secretAbs, input.password!, { encoding: "utf8", mode: 0o600 });
      passwordRef = `file:${secretAbs}`;
    }

    const conn: Record<string, unknown> = {
      driver: input.driver,
      readonly: input.readonly !== false,
      database: input.database,
      schemas: [],
      enabled_tables: []
    };
    if (input.host) conn.host = input.host;
    if (input.port != null) conn.port = input.port;
    if (input.username) conn.username = input.username;
    if (passwordRef) conn.password = passwordRef;
    if (input.engine) conn.engine = input.engine;
    if (input.wireProtocol) conn.wire_protocol = input.wireProtocol;

    await writeFile(
      path.join(tmpRoot, "ktx.yaml"),
      stringify({ connections: { [PROBE_CONNECTION_ID]: conn } }),
      "utf8"
    );

    const testFn = options.testConnectionFn ?? testConnection;
    const execFileImpl = options.execFileImpl ?? execFile;
    const testResult: ConnectionTestResult = await testFn(tmpRoot, PROBE_CONNECTION_ID, execFileImpl);
    if (testResult.status === "ok") {
      return {
        status: "ok",
        latencyMs: testResult.latencyMs,
        message: "连接成功"
      };
    }
    return {
      status: "error",
      latencyMs: testResult.latencyMs,
      message: formatConnectionErrorMessage(testResult.reason?.trim() || "连接失败")
    };
  } catch (error) {
    if (error instanceof KtxCliError) {
      return {
        status: "error",
        message: "无法执行连通测试：未找到 ktx CLI"
      };
    }
    throw error;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}
