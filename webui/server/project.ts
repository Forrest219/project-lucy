import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMap, isScalar, isSeq, parse, parseDocument, Scalar, stringify, type Document, type Node, YAMLMap, YAMLSeq } from "yaml";
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
import { loadContentPaths, invalidateContentPathsCache, resolveContentPaths } from "./paths";
import { invalidateAccessConfigCache } from "./proxy/identity.js";
import type {
  AddSchemaPreview,
  AddSchemaResult,
  Blocker,
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
import { assertEndpointGate, type EndpointFlags } from "./connection-endpoint-gate.js";
import { withKtxYamlWriteLock } from "./ktx-yaml-write-lock.js";
import type { ConnectionTestResult } from "./ktx";
import { withDisplayWriteBarrier, type DisplayScope } from "./display-generation";
import { connectionDeleteBlockText } from "../src/lib/deleteConnectionGuard.js";

const KTX_YAML_DISPLAY_SCOPES: DisplayScope[] = ["C", "D", "P", "L"];

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

/** Spec 179 §3: confirmation rejected because references still exist; deletes stay rolled-back. */
export class ConnectionReferencesRemainError extends Error {
  code = "connection_references_remain";
  statusCode = 409;
  detail: { blockers: import("./model").Blocker[] };

  constructor(message: string, blockers: import("./model").Blocker[]) {
    super(message);
    this.name = "ConnectionReferencesRemainError";
    this.detail = { blockers };
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
  if (explicit === "sqlserver" || explicit === "mssql") return "sqlserver";
  if (explicit === "oracle") return "oracle";
  if (explicit === "native") return "native";
  const driver = normalizedString(conn.driver);
  if (engine === "doris" || engine === "starrocks") return "mysql";
  if (driver?.includes("mysql")) return "mysql";
  if (driver?.includes("postgres")) return "postgres";
  if (driver?.includes("sqlserver") || driver?.includes("mssql")) return "sqlserver";
  if (driver?.includes("oracle")) return "oracle";
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
    const driverName = normalizedString(conn.driver);
    const explicitSchemas = driverName === "athena" ? stringArray(conn.databases) : stringArray(conn.schemas);
    const enabledTables = stringArray(conn.enabled_tables);
    const enabledSchemas = driverName === "athena"
      ? []
      : enabledTables.map((table) => table.split(".")[0]).filter(Boolean);
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
      database: displayString(
        driverName === "sqlite"
          ? (conn.path ?? conn.database ?? conn.db ?? conn.dbname)
          : (conn.database ?? conn.db ?? conn.dbname)
      ),
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
  /** Internal re-entry marker for callers already holding withKtxYamlWriteLock. */
  lockHeld?: boolean;
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
  if (!opts.dryRun && !opts.lockHeld) {
    return withKtxYamlWriteLock(() =>
      withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES, () =>
        writeKtxYaml(root, mutator, { ...opts, lockHeld: true })
      )
    );
  }
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
    const paths = await loadContentPaths();
    await safeWrite(paths, root, "ktx.yaml", serialized);
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
  const driverNode = conn.get("driver", true);
  const driver = isScalar(driverNode) && typeof driverNode.value === "string"
    ? driverNode.value.trim().toLowerCase()
    : "";
  const scopeKey = driver === "athena" ? "databases" : "schemas";
  const schemasNode = conn.get(scopeKey, true);
  if (!schemasNode) {
    return { seq: undefined, oldSchemas: [] };
  }
  if (!isSeq(schemasNode)) {
    throw new KtxYamlParseError(`connections.${connId}.${scopeKey} is not a sequence`);
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
    const driverNode = conn.get("driver", true);
    const driver = isScalar(driverNode) && typeof driverNode.value === "string"
      ? driverNode.value.trim().toLowerCase()
      : "";
    const newSeq = new YAMLSeq();
    newSeq.items.push(schema);
    conn.set(driver === "athena" ? "databases" : "schemas", newSeq);
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
  // Spec 174 §3.2 — the display barrier spans the whole confirmed transaction (incl. rollback).
  if (dryRun) return addSchemaUnbarriered(root, connId, schema, dryRun, options);
  return withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES, () => addSchemaUnbarriered(root, connId, schema, dryRun, options));
}

async function addSchemaUnbarriered(
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
  // Spec 174 §3.2 — the display barrier spans the whole confirmed transaction (incl. rollback).
  if (dryRun) return removeSchemaUnbarriered(root, connId, schema, dryRun, options);
  return withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES, () => removeSchemaUnbarriered(root, connId, schema, dryRun, options));
}

async function removeSchemaUnbarriered(
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
  const paths = await loadContentPaths();
  const manifestAbsPath = path.join(paths.semanticLayer, connId, "_schema", `${schema}.yaml`);
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
      await readFile(path.join(paths.semanticLayer, connId, `${tableName}.yaml`), "utf8");
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
    await safeRemove(paths, root, manifestPath);
    deletedFiles.push(manifestPath);
  }

  // Optional: delete overlays.
  if (options.deleteOverlays) {
    for (const overlayPath of overlayPaths) {
      await safeRemove(paths, root, overlayPath);
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
  const paths = await loadContentPaths();
  const relDir = `semantic-layer/${connId}`;
  return walkYamlFiles(path.join(paths.semanticLayer, connId), relDir);
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

async function readAccessConfigIfExists(root: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(root, "webui", "config", "access.yaml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

type RoleConnectionKind = "role_connection" | "role_selector";

async function collectRoleReferenceRolesByKind(
  config: Record<string, unknown> | null,
  connId: string
): Promise<Record<RoleConnectionKind, string[]>> {
  const out: Record<RoleConnectionKind, string[]> = {
    role_connection: [],
    role_selector: []
  };
  if (!config) return out;
  const roles = config.roles;
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return out;
  for (const [roleId, roleValue] of Object.entries(roles as Record<string, unknown>)) {
    if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
    const allow = (roleValue as Record<string, unknown>).allow;
    if (!allow || typeof allow !== "object" || Array.isArray(allow)) continue;
    const allowRecord = allow as Record<string, unknown>;
    const connections = allowRecord.connections;
    if (
      Array.isArray(connections) &&
      connections.some((item) => item === connId)
    ) {
      out.role_connection.push(roleId);
      continue;
    }
    const selectors = allowRecord.tableSelectors;
    if (
      Array.isArray(selectors) &&
      selectors.some(
        (row) =>
          row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          (row as Record<string, unknown>).connection === connId
      )
    ) {
      out.role_selector.push(roleId);
    }
  }
  return out;
}

function collectIdentityUsersByRole(
  config: Record<string, unknown> | null,
  roleIds: ReadonlySet<string>
): string[] {
  if (!config || roleIds.size === 0) return [];
  const users = config.users;
  if (!Array.isArray(users)) return [];
  const out: string[] = [];
  for (const user of users) {
    if (!user || typeof user !== "object" || Array.isArray(user)) continue;
    const userRecord = user as Record<string, unknown>;
    const role = userRecord.role;
    const id = userRecord.id;
    if (typeof role === "string" && typeof id === "string" && roleIds.has(role)) {
      out.push(id);
    }
  }
  return out;
}

/**
 * Spec 179 §2: report Wiki pages whose `sl_refs` equal the connection id
 * or start with `<connId>/`. Returns each page's relative-to-root key
 * (prefixed with `wiki/` when missing) so Admin callers can show a path
 * the operator already understands.
 */
async function collectWikiBlockingPages(
  root: string,
  connId: string,
  listWikiFn?: typeof import("./wiki").listWiki
): Promise<string[]> {
  try {
    const fn = listWikiFn ?? (await import("./wiki")).listWiki;
    const pages = await fn(root);
    const prefix = `${connId}/`;
    const matching = pages.filter((page) =>
      page.slRefs.some((ref) => ref === connId || ref.startsWith(prefix))
    );
    return matching.map((page) =>
      page.key.startsWith("wiki/") ? page.key : `wiki/${page.key}`
    );
  } catch {
    return [];
  }
}

async function collectAclRoleIds(root: string, connId: string): Promise<string[]> {
  // Kept for callers that only need the flat role-id summary; the new
  // removeConnection flow uses collectRoleReferenceRolesByKind directly
  // so it can distinguish `role_connection` from `role_selector` blockers.
  const config = await readAccessConfigIfExists(root);
  const byKind = await collectRoleReferenceRolesByKind(config, connId);
  return [...byKind.role_connection, ...byKind.role_selector];
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
  // Spec 174 §3.2 — the display barrier spans the whole confirmed transaction (incl. rollback).
  if (dryRun) return removeConnectionUnbarriered(root, connId, dryRun, options);
  return withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES, () => removeConnectionUnbarriered(root, connId, dryRun, options));
}

async function removeConnectionUnbarriered(
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
  const accessConfig = await readAccessConfigIfExists(root);
  const rolesByKind = await collectRoleReferenceRolesByKind(accessConfig, connId);
  const aclRoleIds = [...rolesByKind.role_connection, ...rolesByKind.role_selector];
  // Users (identities) inherit any role reference; report each user id once
  // per matched role so an operator can find both the role and its bearers.
  const referencedRoleIds = new Set<string>(aclRoleIds);
  const identityUserIds = collectIdentityUsersByRole(accessConfig, referencedRoleIds);

  const wikiBlockingPages = await collectWikiBlockingPages(root, connId, options.listWikiFn);
  const wikiRefCount = wikiBlockingPages.length;
  const wikiSamplePaths = wikiBlockingPages.slice(0, 5);

  // Spec 179 §2: blockers always reported; semantic_asset blockers are
  // *carried* in the response even when the missing directory is empty,
  // but only count as blocking when `deleteAssets` is not requested.
  const blockers: Blocker[] = [
    ...rolesByKind.role_connection.map<Blocker>((id) => ({ kind: "role_connection", id })),
    ...rolesByKind.role_selector.map<Blocker>((id) => ({ kind: "role_selector", id })),
    ...identityUserIds.map<Blocker>((id) => ({ kind: "identity", id })),
    ...wikiBlockingPages.map<Blocker>((id) => ({ kind: "wiki", id })),
    ...yamlAssetPaths.map<Blocker>((id) => ({ kind: "semantic_asset", id }))
  ];
  // deleteAssets:true is the only opt-out: roles/identities/wiki never
  // auto-resolve, so the deleted-them-alongside guard never weakens them.
  const semanticAssetStillBlocks = yamlAssetPaths.length > 0 && !options.deleteAssets;
  const blocked =
    rolesByKind.role_connection.length > 0 ||
    rolesByKind.role_selector.length > 0 ||
    identityUserIds.length > 0 ||
    wikiBlockingPages.length > 0 ||
    semanticAssetStillBlocks;

  const impact = {
    canDeleteSecret,
    secretRelPath,
    yamlAssetPaths,
    aclRoleIds,
    wikiRefCount,
    wikiSamplePaths,
    blockers,
    blocked
  };

  if (dryRun) {
    return {
      diff,
      proposedYaml: safeProposedYaml,
      connectionId: connId,
      schemas: oldSchemas,
      enabledTables,
      blocked,
      impact
    };
  }

  // Spec 179 §3: a confirmation with remaining references is rejected
  // before we touch ktx.yaml, secret files, semantic assets, or audit logs.
  // The pre-flight must run unconditionally — caller-supplied confirmation
  // fields can never bypass it.
  if (blocked) {
    throw new ConnectionReferencesRemainError(
      connectionDeleteBlockText(connId, blockers, Boolean(options.deleteAssets)) ??
        `无法删除连接 ${connId}。仍有引用，需要先处理后再删除。`,
      blockers
    );
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
        const paths = await loadContentPaths();
        await safeRemove(paths, root, assetPath);
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
  driver: "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite" | "athena";
  engine?: string;
  wireProtocol?: string;
  readonly?: boolean;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  /** Required when dryRun is false, except sqlite and athena. */
  password?: string;
  schemas?: string[];
  /** KTX athena: AWS region, for example eu-west-1. */
  region?: string;
  /** KTX athena: s3:// bucket prefix for query results. */
  s3StagingDir?: string;
  /** KTX athena: defaults to primary when omitted. */
  workgroup?: string;
  /** KTX athena: defaults to AwsDataCatalog when omitted. */
  catalog?: string;
};

export type CreateConnectionOptions = {
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  testConnectionFn?: typeof testConnection;
  execFileImpl?: Parameters<typeof testConnection>[2];
  endpointFlags?: EndpointFlags;
  /** Set only by the write-lock re-entry. Callers must not pass this. */
  endpointLockHeld?: boolean;
};

function requiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConnectionCreateValidationError(`${field} is required`);
  }
  return value.trim();
}

const VALID_CREATE_DRIVERS = new Set(["mysql", "postgres", "sqlserver", "oracle", "sqlite", "athena"]);
const AWS_REGION_RE = /^[a-z]{2}-[a-z]+-\d$/;

function validateCreateConnectionInput(input: CreateConnectionInput): CreateConnectionInput {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!CONNECTION_ID_RE.test(id)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${id}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  if (!VALID_CREATE_DRIVERS.has(input.driver)) {
    throw new ConnectionCreateValidationError("driver must be mysql, postgres, sqlserver, oracle, sqlite, or athena");
  }
  const isSqlite = input.driver === "sqlite";
  const isAthena = input.driver === "athena";
  const database = requiredNonEmptyString(input.database, "database");

  let host = "";
  let username = "";
  let port: number | undefined;

  let region: string | undefined;
  let s3StagingDir: string | undefined;
  let workgroup: string | undefined;
  let catalog: string | undefined;
  if (isAthena) {
    region = requiredNonEmptyString(input.region, "region");
    if (!AWS_REGION_RE.test(region)) {
      throw new ConnectionCreateValidationError("region must look like eu-west-1");
    }
    s3StagingDir = requiredNonEmptyString(input.s3StagingDir, "s3StagingDir");
    if (!s3StagingDir.startsWith("s3://") || /\s/.test(s3StagingDir)) {
      throw new ConnectionCreateValidationError("s3StagingDir must be an s3:// URI");
    }
    workgroup = typeof input.workgroup === "string" && input.workgroup.trim() ? input.workgroup.trim() : undefined;
    catalog = typeof input.catalog === "string" && input.catalog.trim() ? input.catalog.trim() : undefined;
  } else if (!isSqlite) {
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
    ...(typeof input.password === "string" && !isAthena ? { password: input.password } : {}),
    schemas,
    ...(region ? { region } : {}),
    ...(s3StagingDir ? { s3StagingDir } : {}),
    ...(workgroup ? { workgroup } : {}),
    ...(catalog ? { catalog } : {})
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
    if (input.driver === "athena") {
      conn.set("readonly", input.readonly !== false);
      const enabledTables = new YAMLSeq();
      conn.set("enabled_tables", enabledTables);
      conn.set("region", input.region);
      conn.set("s3_staging_dir", input.s3StagingDir);
      if (input.workgroup) conn.set("workgroup", input.workgroup);
      if (input.catalog) conn.set("catalog", input.catalog);
      if (input.database) conn.set("database", input.database);
      const databases = new YAMLSeq();
      for (const schema of input.schemas ?? []) {
        databases.items.push(schema);
      }
      conn.set("databases", databases);
    } else {
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
      if (input.driver === "sqlite") {
        conn.set("path", input.database);
      } else {
        conn.set("database", input.database);
      }
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
    }
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
  } else if (input.wireProtocol === "sqlserver" || input.wireProtocol === "mssql") {
    wireProtocol = "sqlserver";
  } else if (input.wireProtocol === "oracle") {
    wireProtocol = "oracle";
  } else if (engine === "doris" || engine === "starrocks" || input.driver === "mysql") {
    wireProtocol = "mysql";
  } else if (input.driver === "postgres") {
    wireProtocol = "postgres";
  } else if (input.driver === "sqlserver") {
    wireProtocol = "sqlserver";
  } else if (input.driver === "oracle") {
    wireProtocol = "oracle";
  }
  return {
    id: input.id,
    driver: input.driver,
    engine: input.driver === "athena" ? "athena" : engine,
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
  if (dryRun === false && !options.endpointLockHeld) {
    // Spec 174 §3.2 — barrier covers ktx.yaml + secret writes, audit and rollbackWrittenConnection.
    return withKtxYamlWriteLock(() =>
      withDisplayWriteBarrier(KTX_YAML_DISPLAY_SCOPES, () =>
        createConnection(root, rawInput, false, { ...options, endpointLockHeld: true })
      )
    );
  }
  const input = validateCreateConnectionInput(rawInput);
  const skipsPassword = input.driver === "sqlite" || input.driver === "athena";
  const hasPasswordInput = typeof input.password === "string" && input.password.length > 0;
  // Passwordless drivers (sqlite, athena) do not write a secret file.
  if (!dryRun && !skipsPassword && !hasPasswordInput) {
    throw new ConnectionPasswordRequiredError("password is required when dryRun is false");
  }
  const gate = await assertEndpointGate(root, input, options.endpointFlags);
  const secretRelPath = skipsPassword ? "" : connectionSecretRelPath(input.id);
  const passwordRef = hasPasswordInput || !skipsPassword ? passwordFileRef(root, input.id) : undefined;
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

  // Write secret then yaml. Anything that throws after this write, including the
  // audit summary, rolls back this call's yaml patch and any secret it created.
  let secretWritten = false;
  let yamlWritten = false;
  const rollbackWrittenConnection = async () => {
    if (yamlWritten) {
      const paths = await loadContentPaths();
      await safeWrite(paths, root, "ktx.yaml", preview.oldText);
      yamlWritten = false;
    }
    if (secretWritten) {
      await safeRemoveSecretPasswordIfExists(root, secretRelPath);
      secretWritten = false;
    }
  };
  try {
    if (hasPasswordInput && secretRelPath) {
      await safeWriteNewSecretPassword(root, secretRelPath, input.password!);
      secretWritten = true;
    }
    await writeKtxYaml(root, mutator, { dryRun: false, lockHeld: true });
    yamlWritten = true;
  } catch (error) {
    await rollbackWrittenConnection();
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
    const passwordBytes =
      typeof input.password === "string" ? Buffer.byteLength(input.password, "utf8") : 0;
    try {
      auditId = await options.recordConfigChange({
        filePath: "ktx.yaml",
        changeType: "connection_create",
        targetId: input.id,
        oldSummary: { connections: "unchanged" },
        newSummary: {
          connectionId: input.id,
          secretRelPath,
          passwordBytes,
          driver: input.driver,
          host: input.host,
          port: input.port,
          database: input.database,
          username: input.username,
          testStatus,
          ...(gate.acknowledgedSeparateEndpoint ? { acknowledgedSeparateEndpoint: true } : {}),
          ...(gate.acknowledgedDifferentDatabase ? { acknowledgedDifferentDatabase: true } : {})
        },
        diff
      });
    } catch (error) {
      await rollbackWrittenConnection();
      throw error;
    }
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
  const skipsPassword = input.driver === "sqlite" || input.driver === "athena";
  const hasPasswordInput = typeof input.password === "string" && input.password.length > 0;
  if (!skipsPassword && !hasPasswordInput) {
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

    const conn: Record<string, unknown> = input.driver === "athena"
      ? {
          driver: "athena",
          readonly: input.readonly !== false,
          region: input.region,
          s3_staging_dir: input.s3StagingDir,
          ...(input.workgroup ? { workgroup: input.workgroup } : {}),
          ...(input.catalog ? { catalog: input.catalog } : {}),
          database: input.database,
          databases: [],
          enabled_tables: []
        }
      : input.driver === "sqlite"
        ? {
            driver: "sqlite",
            readonly: input.readonly !== false,
            path: input.database,
            schemas: [],
            enabled_tables: []
          }
        : {
            driver: input.driver,
            readonly: input.readonly !== false,
            database: input.database,
            schemas: [],
            enabled_tables: []
          };
    if (input.driver !== "athena") {
      if (input.host) conn.host = input.host;
      if (input.port != null) conn.port = input.port;
      if (input.username) conn.username = input.username;
      if (passwordRef) conn.password = passwordRef;
      if (input.engine) conn.engine = input.engine;
      if (input.wireProtocol) conn.wire_protocol = input.wireProtocol;
    }

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

// ─── changeConnectionId (Spec 181 T4) ─────────────────────────────────────────

const WIKI_DIR_REL = "wiki";
const SEMANTIC_LAYER_DIR_REL = "semantic-layer";
const ACCESS_YAML_REL = "webui/config/access.yaml";

/** Spec 181 T4 §2 — one identity's source-name set change across a connection id rename. */
export type ConnectionIdChangeCapabilityDiffEntry = {
  userId: string;
  compile: "compiled" | "failed";
  /** Machine reason emitted by acl.compile on a failed identity (e.g. `role_resolution_failed:<roleId>`). */
  reason?: string;
  /** Source keys the identity had before the rename (`<connId>/<schema>/<sourceName>`). */
  before: string[];
  /** Source keys the identity has after the rename (still `<schema>/<sourceName>`, only `<connId>` swapped). */
  after: string[];
  /** Source keys added by the rename (`<toId>/...`). */
  added: string[];
  /** Source keys removed by the rename (`<fromId>/...`). */
  removed: string[];
};

/** Spec 181 T4 §2 — one wiki page whose `sl_refs` contain `fromId` or `fromId/<...>`. */
export type ConnectionIdChangeWikiPageImpact = {
  key: string;
  refsChanged: number;
  before: string[];
  after: string[];
};

/** Spec 181 T4 §2 — one role affected by the rename. */
export type ConnectionIdChangeRoleImpact = {
  roleId: string;
  hadConnections: string[];
  hasConnections: string[];
  /** Each `tableSelectors[].connection` whose value changed (or was set) in the role. */
  selectorChanges: Array<{ selectorIndex: number; from: string | undefined; to: string | undefined }>;
};

/** Spec 181 T4 §2 — dry-run preview returned by `planConnectionIdChange`. */
export type ConnectionIdChangePlan =
  | {
      ok: false;
      code: "connection_id_taken";
      fromId: string;
      toId: string;
    }
  | {
      ok: true;
      fromId: string;
      toId: string;
      /** Unified diff of ktx.yaml; secrets redacted. */
      diff: string;
      ktx: {
        fromKey: string;
        toKey: string;
        schemas: string[];
        enabledTables: string[];
      };
      access: {
        affectedRoles: ConnectionIdChangeRoleImpact[];
        /** User ids whose `role` / `roles` field references an affected role. */
        affectedUsers: string[];
      };
      semanticLayer: {
        fromDir: string;
        toDir: string;
        exists: boolean;
        fileCount: number;
      };
      wiki: {
        pages: ConnectionIdChangeWikiPageImpact[];
      };
      capabilityDiff: ConnectionIdChangeCapabilityDiffEntry[];
    };

/** Spec 181 T4 §4 — confirmed write result. */
export type ConnectionIdChangeResult = {
  written: true;
  fromId: string;
  toId: string;
  auditId?: number;
  /** Whether the semantic-layer directory was actually renamed (false when `<fromId>` did not exist). */
  renamedSemanticDir: boolean;
  /** Wiki page keys whose `sl_refs` were rewritten. */
  updatedWikiPages: string[];
  capabilityDiff: ConnectionIdChangeCapabilityDiffEntry[];
  /** Outcome of the post-write one-way sync. */
  mirror: { copied: number; skipped: number; failed: number };
};

export type ApplyConnectionIdChangeOptions = {
  /** Required `true`. The planning function never writes; this opt-in is what flips the switch. */
  write: true;
  recordConfigChange?: typeof import("./admin/audit").recordConfigChange;
  /**
   * Test hook. `before_wiki` throws after access.yaml and the semantic-layer
   * rename, and before any Wiki or ktx.yaml write, so rollback can be proven
   * at the Spec 181 injection point.
   */
  injectFailure?: "before_wiki";
};

export type PlanConnectionIdChangeOptions = {
  /** Test hook — override the wiki enumeration. */
  listWikiFn?: typeof import("./wiki").listWiki;
  /** Test hook — override identity compile (called twice: before / after). */
  compileIdentities?: typeof compileIdentityCapabilityDiffOnRoot;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function validateConnectionIdsForRename(fromId: unknown, toId: unknown): void {
  if (typeof fromId !== "string" || !CONNECTION_ID_RE.test(fromId)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${String(fromId)}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  if (typeof toId !== "string" || !CONNECTION_ID_RE.test(toId)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${String(toId)}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  if (fromId === toId) {
    throw new ConnectionIdInvalidError(
      `Connection ID rename is a no-op: '${fromId}' === '${toId}'`
    );
  }
}

/**
 * Build the ktx.yaml mutator that renames a connection key. Throws if
 * `fromId` does not exist or `toId` already exists (the latter becomes
 * `connection_id_taken` at the plan layer; we still throw early here so
 * the dry-run write path is the same as the write path).
 */
function connectionRenameMutatorFactory(fromId: string, toId: string) {
  return (doc: ReturnType<typeof parseDocument>): void => {
    const conns = doc.get("connections", true);
    if (!isMap(conns)) {
      throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
    }
    if (!conns.has(fromId)) {
      throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
    }
    const connNode = conns.get(fromId, true);
    if (!isMap(connNode)) {
      throw new KtxYamlParseError(`Connection '${fromId}' is not a mapping`);
    }
    if (conns.has(toId)) {
      const err = new ConnectionAlreadyExistsError(
        `Connection '${toId}' already exists in ktx.yaml`
      ) as Error & { renameCode?: string };
      err.renameCode = "connection_id_taken";
      throw err;
    }
    // Move every pair of the connection block under the new key while keeping
    // its relative position. The connection node itself is reused — the yaml
    // library stores the value via a Pair, so we just retarget the Pair's key
    // scalar instead of cloning.
    const originalPairIndex = conns.items.findIndex(
      (pair) => isScalar(pair.key) && String(pair.key.value ?? "") === fromId
    );
    if (originalPairIndex < 0) {
      // Defensive — `has(fromId)` already passed above, but cover the case
      // where key comparison via Scalar.value disagrees with conns.has.
      throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
    }
    const originalPair = conns.items[originalPairIndex];
    if (!originalPair) {
      throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
    }
    // Retarget the existing Pair's key scalar in place — preserves child node
    // identity and the original ordering.
    if (isScalar(originalPair.key)) {
      originalPair.key.value = toId;
    } else {
      originalPair.key = new Scalar(toId) as typeof originalPair.key;
    }
    forceBlockYamlMaps(conns);

    // Also rename inside setup.database_connection_ids.
    const setup = doc.get("setup", true);
    if (isMap(setup)) {
      const ids = setup.get("database_connection_ids", true);
      if (isSeq(ids)) {
        for (let i = 0; i < ids.items.length; i += 1) {
          if (yamlScalarString(ids.items[i]) === fromId) {
            ids.items[i] = toId;
          }
        }
      }
    }
  };
}

/**
 * Replace `fromId` with `toId` inside an access.yaml-like record. Pure
 * structural mutation — does not write. Used both for the access.yaml
 * preview and for the in-temp-copy apply that powers the capability diff.
 */
export function rewriteAccessConfigConnIds(
  config: Record<string, unknown>,
  fromId: string,
  toId: string
): { roles: ConnectionIdChangeRoleImpact[]; affectedUsers: string[] } {
  const roleImpacts: ConnectionIdChangeRoleImpact[] = [];
  const affectedRoleIds = new Set<string>();
  const affectedUsers = new Set<string>();

  const roles = config.roles;
  if (roles && typeof roles === "object" && !Array.isArray(roles)) {
    for (const [roleId, roleValue] of Object.entries(roles as Record<string, unknown>)) {
      if (!roleValue || typeof roleValue !== "object" || Array.isArray(roleValue)) continue;
      const allow = (roleValue as Record<string, unknown>).allow;
      if (!allow || typeof allow !== "object" || Array.isArray(allow)) continue;
      const allowRecord = allow as Record<string, unknown>;

      const hadConnections = Array.isArray(allowRecord.connections)
        ? (allowRecord.connections as unknown[]).filter((v): v is string => typeof v === "string")
        : [];

      let hasConnections = hadConnections;
      let touched = false;
      if (hadConnections.includes(fromId)) {
        hasConnections = hadConnections.map((c) => (c === fromId ? toId : c));
        allowRecord.connections = hasConnections;
        touched = true;
      }

      const selectorChanges: ConnectionIdChangeRoleImpact["selectorChanges"] = [];
      const selectors = allowRecord.tableSelectors;
      if (Array.isArray(selectors)) {
        selectors.forEach((selector, selectorIndex) => {
          if (!selector || typeof selector !== "object" || Array.isArray(selector)) return;
          const selRec = selector as Record<string, unknown>;
          const currentSelConn = typeof selRec.connection === "string" ? selRec.connection : undefined;
          if (currentSelConn === fromId) {
            selectorChanges.push({ selectorIndex, from: fromId, to: toId });
            selRec.connection = toId;
            touched = true;
          } else if (typeof currentSelConn === "string" && currentSelConn !== toId) {
            // Leave other connection selectors untouched; record as zero-change entry so the
            // caller can still see per-selector coverage in the preview.
            selectorChanges.push({ selectorIndex, from: currentSelConn, to: currentSelConn });
          } else {
            selectorChanges.push({ selectorIndex, from: undefined, to: currentSelConn });
          }
        });
      }

      if (touched) {
        affectedRoleIds.add(roleId);
        roleImpacts.push({
          roleId,
          hadConnections,
          hasConnections,
          selectorChanges: selectorChanges.filter(
            (change) => change.from === fromId || change.to === toId
          )
        });
      }
    }
  }

  const users = config.users;
  if (Array.isArray(users)) {
    for (const user of users) {
      if (!user || typeof user !== "object" || Array.isArray(user)) continue;
      const userRecord = user as Record<string, unknown>;
      const id = userRecord.id;
      const single = typeof userRecord.role === "string" ? userRecord.role : undefined;
      const listRaw = Array.isArray(userRecord.roles) ? userRecord.roles : [];
      const list = listRaw.filter((r): r is string => typeof r === "string");
      const all = new Set<string>([...(single ? [single] : []), ...list]);
      const hits = [...all].filter((roleId) => affectedRoleIds.has(roleId));
      if (hits.length > 0 && typeof id === "string") {
        affectedUsers.add(id);
      }
    }
  }

  return { roles: roleImpacts, affectedUsers: [...affectedUsers] };
}

/**
 * Walk `semantic-layer/<fromId>` and return the relative path + file count.
 * `exists` distinguishes "no source files yet" from "directory not present".
 */
async function inspectSemanticLayer(
  contentPaths: import("./paths").ContentPaths,
  fromId: string,
  toId: string
): Promise<{ fromDir: string; toDir: string; exists: boolean; fileCount: number }> {
  const fromDir = path.posix.join(SEMANTIC_LAYER_DIR_REL, fromId);
  const toDir = path.posix.join(SEMANTIC_LAYER_DIR_REL, toId);
  const fromAbs = path.join(contentPaths.semanticLayer, fromId);
  let fileCount = 0;
  let exists = false;
  try {
    const entries = await readdir(fromAbs, { withFileTypes: true });
    exists = true;
    for (const entry of entries) {
      if (entry.name === "." || entry.name === ".." || entry.name.startsWith(".")) continue;
      if (entry.isFile()) {
        if (/\.ya?ml$/i.test(entry.name)) fileCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const nested = await readdir(path.join(fromAbs, entry.name), { withFileTypes: true });
        for (const nestedEntry of nested) {
          if (nestedEntry.isFile() && /\.ya?ml$/i.test(nestedEntry.name)) fileCount += 1;
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }
  return { fromDir, toDir, exists, fileCount };
}

/**
 * Rename `semantic-layer/<fromId>` → `semantic-layer/<toId>`. Refuses when
 * the destination already exists (mirror drift is left to `syncContentToProjectRoot`).
 */
async function renameSemanticLayerDir(
  semanticLayerRoot: string,
  fromId: string,
  toId: string
): Promise<boolean> {
  const fromAbs = path.join(semanticLayerRoot, fromId);
  const toAbs = path.join(semanticLayerRoot, toId);
  let existed = false;
  try {
    const fromStat = await readdir(fromAbs);
    existed = fromStat.length >= 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!existed) return false;
  // Refuse overwrite — caller is expected to have validated via the dry run.
  try {
    await readdir(toAbs);
    throw new ForbiddenPathError(
      `Refusing to overwrite existing semantic-layer directory '${toId}'`
    );
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(fromAbs, toAbs);
  return true;
}

/**
 * Compute new `sl_refs` for a wiki page's frontmatter. Only `fromId` and
 * `fromId/<...>` entries are rewritten; everything else passes through.
 */
function rewriteWikiSlRefs(refs: readonly string[], fromId: string, toId: string): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    if (ref === fromId) {
      out.push(toId);
    } else if (ref.startsWith(`${fromId}/`)) {
      out.push(`${toId}${ref.slice(fromId.length)}`);
    } else {
      out.push(ref);
    }
  }
  return out;
}

/**
 * Construct the markdown for a wiki page whose `sl_refs` have been renamed,
 * preserving the page's other frontmatter fields (summary / tags / refs /
 * usage_mode / visibility / allowed_roles) and body content verbatim.
 *
 * Lives here instead of in wiki.ts so a single Spec 181 transaction can write
 * multiple pages without each save going through the version-snapshot path.
 */
async function buildRenamedWikiMarkdown(
  rawMarkdown: string,
  page: import("./wiki.js").WikiPage,
  nextRefs: string[]
): Promise<string> {
  const { parseMarkdownFrontmatter, stringifyMarkdownFrontmatter } = await import(
    "./markdown-frontmatter.js"
  );
  const parsed = parseMarkdownFrontmatter(rawMarkdown);
  const data: Record<string, unknown> = {};
  const frontmatter = page.frontmatter;
  if (typeof frontmatter.summary === "string") data.summary = frontmatter.summary;
  if (Array.isArray(frontmatter.tags) && frontmatter.tags.length > 0) {
    data.tags = [...frontmatter.tags];
  }
  data.sl_refs = [...nextRefs];
  if (Array.isArray(frontmatter.refs) && frontmatter.refs.length > 0) {
    data.refs = [...frontmatter.refs];
  }
  if (typeof frontmatter.usage_mode === "string") data.usage_mode = frontmatter.usage_mode;
  // Preserve visibility / allowed_roles verbatim — Spec §4.1 / SC-8.
  if (parsed.data && Object.prototype.hasOwnProperty.call(parsed.data, "visibility")) {
    data.visibility = parsed.data.visibility;
  }
  if (parsed.data && Object.prototype.hasOwnProperty.call(parsed.data, "allowed_roles")) {
    data.allowed_roles = parsed.data.allowed_roles;
  }
  return stringifyMarkdownFrontmatter(page.content, data);
}

/**
 * Spec 181 T4 §3 — compile identities against a given project root.
 *
 * Switches `KTX_PROJECT_ROOT` / `LUCY_CONTENT_ROOT` / `LUCY_ACCESS_CONFIG_PATH`
 * for the duration of the call, then restores them and invalidates caches on
 * the way out. Returns one entry per user id with `compile`, `before`, `after`,
 * `added`, `removed`. Failed compiles surface their machine reason and empty
 * diff arrays — the caller must not count a failed identity toward an
 * authorization widening.
 */
export async function compileIdentityCapabilityDiffOnRoot(
  projectRoot: string,
  contentRootRel: string,
  userIds: readonly string[]
): Promise<ConnectionIdChangeCapabilityDiffEntry[]> {
  const aclModule = await import("./proxy/acl.js");
  const identityModule = await import("./proxy/identity.js");

  const previous = {
    root: process.env.KTX_PROJECT_ROOT,
    content: process.env.LUCY_CONTENT_ROOT,
    access: process.env.LUCY_ACCESS_CONFIG_PATH
  };

  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = contentRootRel;
  delete process.env.LUCY_ACCESS_CONFIG_PATH;
  invalidateContentPathsCache();
  invalidateAccessConfigCache();

  try {
    await identityModule.getAccessConfig({ fresh: true });
    const out: ConnectionIdChangeCapabilityDiffEntry[] = [];
    for (const userId of userIds) {
      try {
        const resolved = await aclModule.effectivePermissions({
          userId,
          tokenLabel: "preview",
          tokenHashPrefix: "preview"
        });
        if (resolved.ok) {
          const sourceKeys = resolved.permissions.sources
            .map((s) => `${s.connectionId}/${s.schema}/${s.sourceName}`)
            .sort();
          out.push({
            userId,
            compile: "compiled",
            before: sourceKeys,
            after: sourceKeys,
            added: [],
            removed: []
          });
        } else {
          out.push({
            userId,
            compile: "failed",
            reason: resolved.reason,
            before: [],
            after: [],
            added: [],
            removed: []
          });
        }
      } catch (error) {
        out.push({
          userId,
          compile: "failed",
          reason: error instanceof Error ? error.message : String(error),
          before: [],
          after: [],
          added: [],
          removed: []
        });
      }
    }
    return out;
  } finally {
    for (const [key, value] of [
      ["KTX_PROJECT_ROOT", previous.root],
      ["LUCY_CONTENT_ROOT", previous.content],
      ["LUCY_ACCESS_CONFIG_PATH", previous.access]
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    invalidateContentPathsCache();
    invalidateAccessConfigCache();
  }
}

/**
 * Materialise the diff between two compile runs. Pure helper, no I/O.
 * Each identity's `after` set is the post-rename replacement; the union of
 * the two runs becomes `added` / `removed` keyed by full source key.
 */
function diffCapabilityEntries(
  before: ConnectionIdChangeCapabilityDiffEntry[],
  after: ConnectionIdChangeCapabilityDiffEntry[],
  fromId: string,
  toId: string
): ConnectionIdChangeCapabilityDiffEntry[] {
  const beforeByUser = new Map(before.map((entry) => [entry.userId, entry]));
  const afterByUser = new Map(after.map((entry) => [entry.userId, entry]));
  const allUserIds = new Set<string>([...beforeByUser.keys(), ...afterByUser.keys()]);
  const merged: ConnectionIdChangeCapabilityDiffEntry[] = [];
  for (const userId of allUserIds) {
    const beforeEntry = beforeByUser.get(userId);
    const afterEntry = afterByUser.get(userId);
    const beforeKeys = beforeEntry?.compile === "compiled" ? beforeEntry.before : [];
    const afterKeys = afterEntry?.compile === "compiled" ? afterEntry.after : [];
    const beforeSet = new Set(beforeKeys);
    const afterSet = new Set(afterKeys);

    let compile: "compiled" | "failed" = "compiled";
    let reason: string | undefined;
    if (beforeEntry?.compile === "failed" || afterEntry?.compile === "failed") {
      compile = "failed";
      // Spec 181 T4 — surface the machine reason. Prefer the *after* compile
      // so the operator sees what the post-rename state actually produced.
      reason = afterEntry?.reason ?? beforeEntry?.reason;
    }

    const added = afterKeys.filter((key) => !beforeSet.has(key) && key.startsWith(`${toId}/`));
    const removed = beforeKeys.filter((key) => !afterSet.has(key) && key.startsWith(`${fromId}/`));
    // Recompute after as the post-rename source set with `fromId` replaced by `toId`.
    const renameMapped = beforeKeys.map((key) =>
      key.startsWith(`${fromId}/`) ? `${toId}${key.slice(fromId.length)}` : key
    );
    const sortedAfter = [...new Set(renameMapped)].sort();
    merged.push({
      userId,
      compile,
      ...(reason ? { reason } : {}),
      before: beforeKeys,
      after: sortedAfter,
      added,
      removed
    });
  }
  return merged.sort((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * Content directory the dry-run compiler should read inside `tempRoot`.
 * When the live content root sits inside the source project, the recursive
 * copy already contains it. An external content root is copied beside the
 * temp project so the preview never renames the live tree.
 */
async function copyContentDirForRenamePreview(
  sourceRoot: string,
  tempRoot: string,
  liveConfigDir: string
): Promise<string> {
  const liveConfig = path.resolve(liveConfigDir);
  const sourceResolved = path.resolve(sourceRoot);
  const rel = path.relative(sourceResolved, liveConfig);
  const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (inside) return path.resolve(tempRoot, rel);
  const dest = path.join(tempRoot, ".lucy-rename-content");
  try {
    await cp(liveConfig, dest, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return dest;
}

// ─── planConnectionIdChange (Spec 181 T4 §2) ─────────────────────────────────

export async function planConnectionIdChange(
  projectRoot: string,
  fromId: string,
  toId: string,
  options: PlanConnectionIdChangeOptions = {}
): Promise<ConnectionIdChangePlan> {
  validateConnectionIdsForRename(fromId, toId);

  // Pre-check the source-of-truth before any write path. The mutator used by
  // `writeKtxYaml` also throws on `toId`-exists, but we want a structured
  // `{ok:false}` plan rather than a thrown error per Spec 181 T4 §2.
  const ktxPath = path.join(projectRoot, "ktx.yaml");
  const ktxOldText = await readFile(ktxPath, "utf8");
  const originalDoc = parseDocument(ktxOldText, { keepSourceTokens: true });
  if (originalDoc.errors.length > 0) {
    throw new KtxYamlParseError(
      `Failed to parse ktx.yaml: ${originalDoc.errors[0]?.message ?? "unknown error"}`
    );
  }
  const connsOriginal = originalDoc.get("connections", true);
  if (!isMap(connsOriginal) || !connsOriginal.has(fromId)) {
    throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
  }
  if (connsOriginal.has(toId)) {
    return { ok: false, code: "connection_id_taken", fromId, toId };
  }

  // Read ktx.yaml — surfaces missing source-of-truth before we touch anything.
  const ktxPreview = await writeKtxYaml(
    projectRoot,
    connectionRenameMutatorFactory(fromId, toId),
    { dryRun: true }
  );
  if ((ktxPreview as { serialized?: string }).serialized === undefined) {
    // unreachable — writeKtxYaml always returns {doc, serialized, oldText}
  }

  const safeOldYaml = redactKtxYamlForPreview(ktxPreview.oldText);
  const safeNewYaml = redactKtxYamlForPreview(ktxPreview.serialized);
  const diff = previewDiff(safeOldYaml, safeNewYaml, "ktx.yaml");

  // Pull the post-rename schemas / enabled_tables for the preview summary.
  const renamedDoc = parseDocument(ktxPreview.serialized, { keepSourceTokens: true });
  const renamedConns = renamedDoc.get("connections", true);
  const renamedConn = isMap(renamedConns) ? renamedConns.get(toId, true) : undefined;
  const ktxSummary = {
    fromKey: fromId,
    toKey: toId,
    schemas: isMap(renamedConn) ? schemasList(renamedConn.get("schemas", true) as import("yaml").YAMLSeq | undefined) : [],
    enabledTables: isMap(renamedConn)
      ? enabledTablesList(renamedConn.get("enabled_tables", true) as import("yaml").YAMLSeq | undefined)
      : []
  };

  // Read access.yaml — preferred path, but allow overrides for the test/secondary
  // layout that some suites use.
  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let accessRaw: string | null = null;
  try {
    accessRaw = await readFile(accessPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const accessConfig: Record<string, unknown> = accessRaw
    ? (parse(accessRaw) as Record<string, unknown> | null) ?? {}
    : {};
  const accessRewrite = rewriteAccessConfigConnIds(accessConfig, fromId, toId);

  const contentPaths = await resolveContentPaths(projectRoot);
  const semantic = await inspectSemanticLayer(contentPaths, fromId, toId);

  const listWikiFn = options.listWikiFn ?? (await import("./wiki.js")).listWiki;
  const wikiPages = await listWikiFn(projectRoot).catch(() => []);
  const wikiImpacts: ConnectionIdChangeWikiPageImpact[] = [];
  for (const page of wikiPages) {
    const refs = page.slRefs ?? [];
    const before = refs.filter(
      (ref) => ref === fromId || ref.startsWith(`${fromId}/`)
    );
    if (before.length === 0) continue;
    const after = rewriteWikiSlRefs(refs, fromId, toId);
    wikiImpacts.push({
      key: page.key,
      refsChanged: before.length,
      before: refs,
      after
    });
  }

  // Capability diff — compile against original, then against a temp copy with the rename applied.
  const allUserIds = Array.isArray(accessConfig.users)
    ? (accessConfig.users as unknown[])
        .filter((u): u is Record<string, unknown> => !!u && typeof u === "object" && !Array.isArray(u))
        .map((u) => (typeof u.id === "string" ? u.id : ""))
        .filter(Boolean)
    : [];
  const compileFn = options.compileIdentities ?? compileIdentityCapabilityDiffOnRoot;
  const beforeCompile = await compileFn(projectRoot, contentPaths.configDir, allUserIds);

  // Materialise a temp copy with the rename applied and compile there.
  // Content paths are resolved against that copy. Ambient `loadContentPaths()`
  // follows the live project root, so a dry run must not use it to rename.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-conn-id-rename-"));
  try {
    await cp(projectRoot, tempRoot, {
      recursive: true,
      dereference: false,
      filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`)
    });
    const tempConfigDir = await copyContentDirForRenamePreview(projectRoot, tempRoot, contentPaths.configDir);

    const tempAccessPath = path.join(tempRoot, ACCESS_YAML_REL);
    let tempAccessText: string | null = null;
    try {
      tempAccessText = await readFile(tempAccessPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (tempAccessText) {
      const tempConfig = parse(tempAccessText) as Record<string, unknown> | null;
      if (tempConfig && typeof tempConfig === "object") {
        rewriteAccessConfigConnIds(tempConfig, fromId, toId);
        await writeFile(tempAccessPath, stringify(tempConfig, { lineWidth: 0 }), "utf8");
      }
    }
    await renameSemanticLayerDir(path.join(tempConfigDir, SEMANTIC_LAYER_DIR_REL), fromId, toId);

    // Dry-run serialization only. Writing through `writeKtxYaml` would resolve
    // the live content root and can mkdir on the caller's project.
    const tempKtx = await writeKtxYaml(tempRoot, connectionRenameMutatorFactory(fromId, toId), {
      dryRun: true
    });
    await writeFile(path.join(tempRoot, "ktx.yaml"), tempKtx.serialized, "utf8");

    const afterCompile = await compileFn(tempRoot, tempConfigDir, allUserIds);
    const capabilityDiff = diffCapabilityEntries(beforeCompile, afterCompile, fromId, toId);
    // Use the "after" compile for the final capability diff entries; this is
    // the source-of-truth for which sources each identity ends up with.
    for (const entry of capabilityDiff) {
      if (entry.compile === "compiled") {
        const afterEntry = afterCompile.find((row) => row.userId === entry.userId);
        if (afterEntry?.compile === "compiled") {
          entry.after = afterEntry.after;
        }
      }
    }

    return {
      ok: true,
      fromId,
      toId,
      diff,
      ktx: ktxSummary,
      access: {
        affectedRoles: accessRewrite.roles,
        affectedUsers: accessRewrite.affectedUsers
      },
      semanticLayer: semantic,
      wiki: { pages: wikiImpacts },
      capabilityDiff
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

// ─── applyConnectionIdChange (Spec 181 T4 §4) ────────────────────────────────

export async function applyConnectionIdChange(
  projectRoot: string,
  fromId: string,
  toId: string,
  options: ApplyConnectionIdChangeOptions
): Promise<ConnectionIdChangeResult> {
  if (options?.write !== true) {
    throw new Error(
      "applyConnectionIdChange requires options.write === true; use planConnectionIdChange for the dry run"
    );
  }
  validateConnectionIdsForRename(fromId, toId);

  // Snapshot the files we may mutate so a partial failure can restore them.
  const ktxPath = path.join(projectRoot, "ktx.yaml");
  const ktxOldText = await readFile(ktxPath, "utf8");
  const ktxOriginalDoc = parseDocument(ktxOldText, { keepSourceTokens: true });
  if (ktxOriginalDoc.errors.length > 0) {
    throw new KtxYamlParseError(
      `Failed to parse ktx.yaml: ${ktxOriginalDoc.errors[0]?.message ?? "unknown error"}`
    );
  }
  const connsOriginal = ktxOriginalDoc.get("connections", true);
  if (!isMap(connsOriginal) || !connsOriginal.has(fromId)) {
    throw new ConnectionNotFoundError(`Connection '${fromId}' not found in ktx.yaml`);
  }
  if (connsOriginal.has(toId)) {
    const err = new ConnectionAlreadyExistsError(
      `Connection '${toId}' already exists in ktx.yaml`
    ) as Error & { code?: string };
    err.code = "connection_id_taken";
    throw err;
  }

  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let accessOldText: string | null = null;
  let accessOldConfig: Record<string, unknown> | null = null;
  try {
    accessOldText = await readFile(accessPath, "utf8");
    accessOldConfig = parse(accessOldText) as Record<string, unknown> | null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (accessOldText !== null && (accessOldConfig === null || typeof accessOldConfig !== "object")) {
    throw new KtxYamlParseError(`Failed to parse ${ACCESS_YAML_REL}`);
  }

  // Snapshot wiki pages with `sl_refs` matching `fromId` so we can restore them on rollback.
  const listWikiFn = (await import("./wiki.js")).listWiki;
  const wikiPages = await listWikiFn(projectRoot).catch(() => []);
  const wikiSnapshots: Array<{ key: string; raw: string }> = [];
  for (const page of wikiPages) {
    const refs = page.slRefs ?? [];
    if (!refs.some((ref) => ref === fromId || ref.startsWith(`${fromId}/`))) continue;
    const wikiModule = await import("./wiki.js");
    const full = await wikiModule.readWiki(projectRoot, page.key).catch(() => null);
    if (full) wikiSnapshots.push({ key: full.key, raw: full.rawMarkdown });
  }

  // Capture "before" compile against the real project.
  const contentPaths = await loadContentPaths();
  const contentRootRel = process.env.LUCY_CONTENT_ROOT?.trim() ?? "";
  const allUserIds = accessOldConfig && Array.isArray(accessOldConfig.users)
    ? (accessOldConfig.users as unknown[])
        .filter((u): u is Record<string, unknown> => !!u && typeof u === "object" && !Array.isArray(u))
        .map((u) => (typeof u.id === "string" ? u.id : ""))
        .filter(Boolean)
    : [];
  const beforeCompile = await compileIdentityCapabilityDiffOnRoot(
    projectRoot,
    contentRootRel || ".",
    allUserIds
  );

  // Order per Spec 181 T4 §4: access.yaml → semantic dir rename → wiki → ktx.yaml.
  let accessWritten = false;
  let semanticRenamed = false;
  let wikiUpdated: string[] = [];
  let ktxWritten = false;

  const rollback = async (reason: unknown): Promise<never> => {
    if (ktxWritten) {
      try {
        await writeFile(ktxPath, ktxOldText, "utf8");
      } catch {
        // Best-effort — failure here is a real problem but we cannot unwind further.
      }
    }
    for (const snap of wikiSnapshots) {
      try {
        const paths = await loadContentPaths();
        const relPath = path.posix.join(WIKI_DIR_REL, snap.key);
        await safeWrite(paths, projectRoot, relPath, snap.raw);
      } catch {
        // best-effort
      }
    }
    if (semanticRenamed) {
      try {
        const paths = await loadContentPaths();
        const toAbs = path.join(paths.semanticLayer, toId);
        const fromAbs = path.join(paths.semanticLayer, fromId);
        await rename(toAbs, fromAbs);
      } catch {
        // best-effort
      }
    }
    if (accessWritten && accessOldText !== null) {
      try {
        await writeFile(accessPath, accessOldText, "utf8");
      } catch {
        // best-effort
      }
    }
    throw reason;
  };

  try {
    // 1. access.yaml
    if (accessOldText !== null && accessOldConfig !== null) {
      rewriteAccessConfigConnIds(accessOldConfig, fromId, toId);
      const newAccessText = stringify(accessOldConfig, { lineWidth: 0 });
      await writeFile(accessPath, newAccessText, "utf8");
      accessWritten = true;
    }

    // 2. semantic-layer dir rename (skip if missing — Spec 181 §4 allows the rename to be a no-op when no manifests exist yet).
    const renamed = await renameSemanticLayerDir(contentPaths.semanticLayer, fromId, toId);
    semanticRenamed = renamed;

    if (options.injectFailure === "before_wiki") {
      throw new Error("injected failure before wiki write");
    }

    // 3. wiki sl_refs — write each modified page through safeWrite so the wiki allowlist guards symlinks.
    for (const snap of wikiSnapshots) {
      const wikiModule = await import("./wiki.js");
      const page = await wikiModule.readWiki(projectRoot, snap.key);
      const nextRefs = rewriteWikiSlRefs(page.frontmatter.sl_refs ?? [], fromId, toId);
      if (JSON.stringify(nextRefs) === JSON.stringify(page.frontmatter.sl_refs ?? [])) continue;
      const paths = await loadContentPaths();
      const relPath = path.posix.join(WIKI_DIR_REL, page.key);
      const proposedMarkdown = await buildRenamedWikiMarkdown(snap.raw, page, nextRefs);
      await safeWrite(paths, projectRoot, relPath, proposedMarkdown);
      wikiUpdated.push(page.key);
    }

    // 4. ktx.yaml — last so a thrown error here still leaves the other three consistent.
    await writeKtxYaml(projectRoot, connectionRenameMutatorFactory(fromId, toId), {
      dryRun: false,
      lockHeld: true
    });
    ktxWritten = true;

    // Capture "after" compile on the now-rewritten real project.
    const afterCompile = await compileIdentityCapabilityDiffOnRoot(
      projectRoot,
      contentRootRel || ".",
      allUserIds
    );
    const capabilityDiff = diffCapabilityEntries(beforeCompile, afterCompile, fromId, toId);
    // Overlay the real "after" source-key list for compiled identities.
    for (const entry of capabilityDiff) {
      if (entry.compile === "compiled") {
        const afterEntry = afterCompile.find((row) => row.userId === entry.userId);
        if (afterEntry?.compile === "compiled") {
          entry.after = afterEntry.after;
        }
      }
    }

    // 5. mirror sync (Spec 180/181) — best-effort.
    const { syncContentToProjectRoot } = await import("./content-mirror.js");
    const mirror = await syncContentToProjectRoot(projectRoot, await loadContentPaths());

    let auditId: number | undefined;
    if (options.recordConfigChange) {
      auditId = await options.recordConfigChange({
        filePath: "ktx.yaml",
        changeType: "connection_id_change",
        targetId: `${fromId}->${toId}`,
        oldSummary: { connectionId: fromId },
        newSummary: {
          connectionId: toId,
          renamedSemanticDir: semanticRenamed,
          updatedWikiPages: wikiUpdated
        },
        diff: previewDiff(
          redactKtxYamlForPreview(ktxOldText),
          redactKtxYamlForPreview(await readFile(ktxPath, "utf8")),
          "ktx.yaml"
        )
      });
    }

    return {
      written: true,
      fromId,
      toId,
      auditId,
      renamedSemanticDir: semanticRenamed,
      updatedWikiPages: wikiUpdated,
      capabilityDiff,
      mirror
    };
  } catch (error) {
    await rollback(error);
    throw error;
  }
}

// ─── planConnectionReplacement (Spec 184 T11) ────────────────────────────────
//
// Dry-run preview of replacing a connection's database / schemas / enabled_tables.
// Caller passes only the three replaceable fields; password is rejected and
// never read or returned. Capability diff compiles against a temp copy of the
// project so the live tree is never mutated.

export type ConnectionReplacementCandidate = {
  database: string;
  schemas: string[];
  enabledTables: string[];
};

/** Spec 184 T11 §2 — rejects candidates that carry fields outside {database, schemas, enabledTables}. */
export class ConnectionReplacementInvalidError extends Error {
  code = "CONNECTION_REPLACEMENT_INVALID";
  statusCode = 400;
  detail: { rejectedFields?: string[] };

  constructor(message: string, detail: ConnectionReplacementInvalidError["detail"] = {}) {
    super(message);
    this.name = "ConnectionReplacementInvalidError";
    this.detail = detail;
  }
}

/** Spec 184 T11 §2 — before/after scope comparison the operator sees in the preview. */
export type ConnectionReplacementScope = {
  before: string[];
  after: string[];
};

/** Spec 184 T11 §2 — manifest files under `semantic-layer/<connId>/_schema/*.yaml` that still resolve to this connection id. */
export type ConnectionReplacementManifestImpact = {
  /** Absolute paths to manifest files under `<connId>/_schema/`. */
  files: string[];
  /** Always true: the connection id is preserved by a replacement. */
  stillPointsToConnection: boolean;
};

/** Spec 184 T11 §2 — wiki pages whose `sl_refs` still contain the preserved connection id. */
export type ConnectionReplacementWikiImpact = {
  /** Up to 5 sample page keys with their full `sl_refs` for context. */
  pages: Array<{ key: string; refs: string[] }>;
  /** Always true: the connection id is preserved by a replacement. */
  stillPointsToConnection: boolean;
};

/** Spec 184 T11 §2 — full dry-run preview returned by `planConnectionReplacement`. */
export type ConnectionReplacementPlan = {
  connectionId: string;
  database: { before: string; after: string };
  schemas: ConnectionReplacementScope;
  enabledTables: ConnectionReplacementScope;
  /** Host comparison. Candidate never carries host; reported as true unless the existing connection had no host. */
  sameHost: boolean;
  /** True iff `database`, `schemas`, and `enabledTables` all match after sorting. Host is not considered. */
  sameObject: boolean;
  /** Unified diff of ktx.yaml with secrets redacted. */
  diff: string;
  /** Secret-redacted YAML that would be written. */
  proposedYaml: string;
  manifest: ConnectionReplacementManifestImpact;
  wiki: ConnectionReplacementWikiImpact;
  capabilityDiff: ConnectionIdChangeCapabilityDiffEntry[];
};

export type PlanConnectionReplacementOptions = {
  /** Test hook — override the wiki enumeration. */
  listWikiFn?: typeof import("./wiki").listWiki;
  /** Test hook — override identity compile (called twice: before / after). */
  compileIdentities?: typeof compileIdentityCapabilityDiffOnRoot;
};

const REPLACEMENT_CANDIDATE_ALLOWED_KEYS = new Set([
  "database",
  "schemas",
  "enabledTables"
]);

function validateReplacementCandidate(input: unknown): ConnectionReplacementCandidate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ConnectionReplacementInvalidError("candidate must be an object");
  }
  const obj = input as Record<string, unknown>;
  const rejected = Object.keys(obj).filter((key) => !REPLACEMENT_CANDIDATE_ALLOWED_KEYS.has(key));
  if (rejected.length > 0) {
    throw new ConnectionReplacementInvalidError(
      `candidate includes fields that are not replaceable: ${rejected.join(", ")}; only database, schemas, enabledTables may be set`,
      { rejectedFields: rejected }
    );
  }
  if (typeof obj.database !== "string" || obj.database.trim().length === 0) {
    throw new ConnectionReplacementInvalidError("database is required and must be a non-empty string");
  }
  const schemasRaw = Array.isArray(obj.schemas) ? obj.schemas : [];
  const schemas = schemasRaw.filter((value): value is string => typeof value === "string");
  for (const schema of schemas) {
    if (!SCHEMA_NAME_RE.test(schema)) {
      throw new SchemaNameInvalidError(
        `Schema name '${schema}' does not match pattern ${SCHEMA_NAME_PATTERN}`
      );
    }
  }
  const enabledTablesRaw = Array.isArray(obj.enabledTables) ? obj.enabledTables : [];
  const enabledTables = enabledTablesRaw.filter((value): value is string => typeof value === "string");
  return {
    database: obj.database.trim(),
    schemas: [...new Set(schemas)].sort(),
    enabledTables: [...new Set(enabledTables)].sort()
  };
}

/**
 * Spec 184 T11 — mutator that applies a replacement candidate to one
 * connection while preserving the connection id, host, port, username, and
 * password. Used both for the diff preview (against the live project) and for
 * the temp-copy compile run (against a copy).
 */
function connectionReplacementMutatorFactory(connId: string, candidate: ConnectionReplacementCandidate) {
  return (doc: ReturnType<typeof parseDocument>): void => {
    const conns = doc.get("connections", true);
    if (!isMap(conns)) {
      throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
    }
    if (!conns.has(connId)) {
      throw new ConnectionNotFoundError(`Connection '${connId}' not found in ktx.yaml`);
    }
    const conn = conns.get(connId, true);
    if (!isMap(conn)) {
      throw new KtxYamlParseError(`Connection '${connId}' is not a mapping`);
    }
    conn.set("database", candidate.database);

    const schemasSeq = new YAMLSeq();
    for (const schema of candidate.schemas) {
      schemasSeq.items.push(schema);
    }
    conn.set("schemas", schemasSeq);

    const enabledTablesSeq = new YAMLSeq();
    for (const table of candidate.enabledTables) {
      enabledTablesSeq.items.push(table);
    }
    conn.set("enabled_tables", enabledTablesSeq);
    forceBlockYamlMaps(conns);
  };
}

/**
 * Spec 184 T11 — manifest files under `semantic-layer/<connId>/_schema/*.yaml`.
 * Reports existence; the connection id is preserved by a replacement so every
 * existing manifest still points at this connection.
 */
async function listReplacementManifestFiles(
  semanticLayerRoot: string,
  connId: string
): Promise<string[]> {
  if (!isSafePathSegment(connId)) return [];
  const schemaDir = path.join(semanticLayerRoot, connId, "_schema");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(schemaDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    out.push(path.posix.join(SEMANTIC_LAYER_DIR_REL, connId, "_schema", entry.name));
  }
  return out.sort();
}

/**
 * Spec 184 T11 — wiki pages whose `sl_refs` still contain the connection id.
 * The id is preserved by a replacement, so every matching page keeps its
 * reference; this function reports them so the operator can see the scope.
 */
async function listReplacementWikiSlRefPages(
  root: string,
  connId: string,
  listWikiFn?: typeof import("./wiki").listWiki
): Promise<Array<{ key: string; refs: string[] }>> {
  try {
    const fn = listWikiFn ?? (await import("./wiki.js")).listWiki;
    const pages = await fn(root);
    const prefix = `${connId}/`;
    return pages
      .filter((page) => page.slRefs.some((ref) => ref === connId || ref.startsWith(prefix)))
      .map((page) => ({ key: page.key, refs: [...page.slRefs] }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function planConnectionReplacement(
  projectRoot: string,
  connectionId: string,
  candidate: unknown,
  options: PlanConnectionReplacementOptions = {}
): Promise<ConnectionReplacementPlan> {
  if (typeof connectionId !== "string" || !CONNECTION_ID_RE.test(connectionId)) {
    throw new ConnectionIdInvalidError(
      `Connection ID '${connectionId}' does not match pattern ${CONNECTION_ID_PATTERN}`
    );
  }
  const normalizedCandidate = validateReplacementCandidate(candidate);

  const ktxPath = path.join(projectRoot, "ktx.yaml");
  const ktxText = await readFile(ktxPath, "utf8");
  const doc = parseDocument(ktxText, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new KtxYamlParseError(
      `Failed to parse ktx.yaml: ${doc.errors[0]?.message ?? "unknown error"}`
    );
  }
  const conns = doc.get("connections", true);
  if (!isMap(conns) || !conns.has(connectionId)) {
    throw new ConnectionNotFoundError(`Connection '${connectionId}' not found in ktx.yaml`);
  }
  const conn = conns.get(connectionId, true);
  if (!isMap(conn)) {
    throw new KtxYamlParseError(`Connection '${connectionId}' is not a mapping`);
  }

  const beforeDatabase = yamlScalarString(conn.get("database")) ?? "";
  const beforeHost = yamlScalarString(conn.get("host")) ?? "";
  const beforeSchemas = schemasList(conn.get("schemas", true) as import("yaml").YAMLSeq | undefined).sort();
  const beforeEnabledTables = enabledTablesList(
    conn.get("enabled_tables", true) as import("yaml").YAMLSeq | undefined
  ).sort();

  // Diff preview against the live project — produces a sanitized YAML and a unified diff.
  const preview = await writeKtxYaml(
    projectRoot,
    connectionReplacementMutatorFactory(connectionId, normalizedCandidate),
    { dryRun: true }
  );
  const safeOldYaml = redactKtxYamlForPreview(preview.oldText);
  const safeNewYaml = redactKtxYamlForPreview(preview.serialized);
  const diff = previewDiff(safeOldYaml, safeNewYaml, "ktx.yaml");

  const contentPaths = await resolveContentPaths(projectRoot);
  const manifestFiles = await listReplacementManifestFiles(contentPaths.semanticLayer, connectionId);
  const wikiPages = await listReplacementWikiSlRefPages(projectRoot, connectionId, options.listWikiFn);

  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let accessRaw: string | null = null;
  try {
    accessRaw = await readFile(accessPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const accessConfig: Record<string, unknown> = accessRaw
    ? (parse(accessRaw) as Record<string, unknown> | null) ?? {}
    : {};
  const allUserIds = Array.isArray(accessConfig.users)
    ? (accessConfig.users as unknown[])
        .filter((u): u is Record<string, unknown> => !!u && typeof u === "object" && !Array.isArray(u))
        .map((u) => (typeof u.id === "string" ? u.id : ""))
        .filter(Boolean)
    : [];

  const compileFn = options.compileIdentities ?? compileIdentityCapabilityDiffOnRoot;
  const beforeCompile = await compileFn(projectRoot, contentPaths.configDir, allUserIds);

  // Capability compile runs only against a temp copy. The live project is
  // never mutated and the temp tree is removed in `finally`.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-conn-replacement-"));
  try {
    await cp(projectRoot, tempRoot, {
      recursive: true,
      dereference: false,
      filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`)
    });
    const tempConfigDir = await copyContentDirForRenamePreview(projectRoot, tempRoot, contentPaths.configDir);

    const tempKtxPreview = await writeKtxYaml(
      tempRoot,
      connectionReplacementMutatorFactory(connectionId, normalizedCandidate),
      { dryRun: true }
    );
    await writeFile(path.join(tempRoot, "ktx.yaml"), tempKtxPreview.serialized, "utf8");

    const afterCompile = await compileFn(tempRoot, tempConfigDir, allUserIds);
    const capabilityDiff = diffCapabilityEntries(beforeCompile, afterCompile, connectionId, connectionId);
    // Replace `before` / `after` with the real source-key sets from each compile run; the rename-style
    // diff helper only swaps the connection id, which is a no-op here.
    for (const entry of capabilityDiff) {
      if (entry.compile !== "compiled") continue;
      const beforeEntry = beforeCompile.find((row) => row.userId === entry.userId);
      const afterEntry = afterCompile.find((row) => row.userId === entry.userId);
      if (beforeEntry?.compile === "compiled") entry.before = beforeEntry.before;
      if (afterEntry?.compile === "compiled") entry.after = afterEntry.after;
    }

    const sameObject =
      beforeDatabase === normalizedCandidate.database &&
      JSON.stringify(beforeSchemas) === JSON.stringify(normalizedCandidate.schemas) &&
      JSON.stringify(beforeEnabledTables) === JSON.stringify(normalizedCandidate.enabledTables);
    // The candidate cannot change the host. A missing host is not reported as the same host.
    const sameHost = beforeHost.length > 0;

    return {
      connectionId,
      database: { before: beforeDatabase, after: normalizedCandidate.database },
      schemas: { before: beforeSchemas, after: normalizedCandidate.schemas },
      enabledTables: { before: beforeEnabledTables, after: normalizedCandidate.enabledTables },
      sameHost,
      sameObject,
      diff,
      proposedYaml: safeNewYaml,
      manifest: { files: manifestFiles, stillPointsToConnection: true },
      wiki: { pages: wikiPages, stillPointsToConnection: true },
      capabilityDiff
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
