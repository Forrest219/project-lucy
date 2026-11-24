/**
 * REQ-030-012 / P0-A — Source-level field exposure (库存 ≠ 暴露).
 *
 * 落点冻结（Plan 前置未齐时的可测最小实现，登记于此）：
 * - 台账：`semantic-layer/<conn>/_exposure/<source>.yaml`（Spec D3 首选）。
 *   发布种类 `field_exposure` 不参与 KTX 上传；KTX loader 对 `_exposure/` 未核实，
 *   若日后证实会当 source 加载，迁移到 contentRoot/exposure/（扩 CONTENT_DIR_NAMES）。
 * - 期望集合：`<projectRoot>/.ktx-ui/field-exposure/expected-ledgers.json`（Spec D19／S2c 候选）。
 * - 执行代次：`<projectRoot>/.ktx-ui/field-exposure/serving-generation.json`。
 * - 上游绑定：Strat-B（STOP_ADMISSION → DRAIN → mutate → RESUME／失败回滚或保持 STOP）。
 *   首期无 staging 索引指针；开放准入时强制 `upstreamExecutionGenerationId == generationId`。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { loadContentPaths } from "../paths.js";

// ─── Reason codes (Spec D13) ────────────────────────────────────────────────

export const FIELD_NOT_EXPOSED = "field_not_exposed";
export const FIELD_EXPOSURE_UNAVAILABLE = "field_exposure_unavailable";

export const FIELD_EXPOSURE_LEDGER_VERSION = 1;
export const EXPECTED_SET_SCHEMA_VERSION = 1;
export const KNOWN_EMPTY_EXPECTED_DIGEST = "sha256:expected-empty-v1";

/** Passthrough tools under D26 first-period fail-closed (SC-30). */
export const PASSTHROUGH_TOOLS = [
  "entity_details",
  "sl_validate",
  "dictionary_search",
  "discover_data"
] as const;
export type PassthroughTool = (typeof PASSTHROUGH_TOOLS)[number];

export const SENSITIVE_META_PASSTHROUGH_TOOLS = new Set<string>([
  "dictionary_search",
  "discover_data"
]);
export const TABLE_TOUCHING_PASSTHROUGH_TOOLS = new Set<string>([
  "entity_details",
  "sl_validate"
]);

/** Tools that hit upstream semantic execution under AdmissionMode STOP. */
export const UPSTREAM_SEMANTIC_TOOLS = new Set<string>([
  "lucy_query",
  "lucy_read_source",
  "entity_details",
  "sl_validate",
  "dictionary_search",
  "discover_data"
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExposureState = "unconfigured" | "configured" | "unavailable";
export type ExposureMode = "unconfigured" | "full_expose" | "trimmed";
export type ExpectedSetState = "ready" | "unavailable";
export type AdmissionMode = "OPEN" | "STOP_ADMISSION" | "DRAINING";

export type SourceRef = {
  connectionId: string;
  schema: string;
  sourceName: string;
};

export type ExposureSet = {
  excluded: Set<string>;
  state: ExposureState;
  mode: ExposureMode | null;
  version: number | null;
  digest: string | null;
  reason?: string;
};

export type ExpectedSetLoad = {
  state: ExpectedSetState;
  set: Set<string>;
  digest: string | null;
  generationId: string | null;
  reason?: string;
  expectedSetRequired: boolean;
};

export type FieldExposureLedger = {
  version: number;
  source: SourceRef;
  excluded_columns: string[];
  updated_at: string;
};

export type ExecutionGeneration = {
  generationId: string;
  /** Absolute paths keyed by sourceKey → ledger yaml text (activated view). */
  exposureLedgersBySource: Map<string, string>;
  exposureDigestPerSource: Map<string, string>;
  expectedSetLoad: ExpectedSetLoad;
  /** Opaque definition view handle for same-gen resolution (may be empty in unit tests). */
  semanticDefinitionView: { generationId: string; digest: string };
  indexConsumptionVersion: { boundGenerationId: string; digest: string };
  upstreamExecutionGenerationId: string;
  activatedAt: string;
};

export type ActivatedSnapshot = ExecutionGeneration & {
  admissionMode: AdmissionMode;
};

export type ExposureDecision =
  | { allow: true; fullInventory: true; mode: ExposureMode; excluded?: undefined }
  | { allow: true; fullInventory: false; mode: "trimmed"; excluded: Set<string> }
  | { allow: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE; source?: SourceRef };

export type FieldRefCarrier =
  | "dimensions"
  | "filters"
  | "order_by"
  | "measures"
  | "segments";

export type NamedFieldRef = {
  raw: string;
  carrier: FieldRefCarrier;
  /** Column-ish token after last `.` when source-qualified; else whole raw. */
  columnHint: string;
};

export type ResolveRefResult =
  | { kind: "IDENTITY_COLUMN"; conn: string; schema: string; sourceName: string; column: string }
  | { kind: "UNPARSEABLE" }
  | { kind: "AMBIGUOUS" }
  | { kind: "LEGAL_ZERO_COLUMN_SOURCE" };

export type QueryExposureVerdict =
  | { denyReason: null; exposureDigest?: string | null }
  | {
      denyReason: typeof FIELD_NOT_EXPOSED | typeof FIELD_EXPOSURE_UNAVAILABLE;
      attribution: Record<string, unknown>;
      exposureDigest?: string | null;
    };

export type PassthroughScope = {
  unavailable: boolean;
  touchesTrimmed: boolean;
  involved: SourceRef[] | "INSTANCE_WIDE" | "UNKNOWN";
};

export type PassthroughAdmit =
  | { allow: true }
  | { allow: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE };

/** Evidence registry: tool → payloads proven to contain no field names (S3c). */
const evidenceNoFieldNames = new Map<PassthroughTool, boolean>();

export function setPassthroughEvidenceNoFieldNames(
  tool: PassthroughTool,
  value: boolean
): void {
  evidenceNoFieldNames.set(tool, value);
}

export function getPassthroughEvidenceNoFieldNames(tool: string): boolean {
  return evidenceNoFieldNames.get(tool as PassthroughTool) === true;
}

export function resetPassthroughEvidenceForTests(): void {
  evidenceNoFieldNames.clear();
}

// ─── Normalize / keys ───────────────────────────────────────────────────────

export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizeColumnNames(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    const n = normalizeColumnName(name);
    if (n) out.add(n);
  }
  return out;
}

export function sourceKey(conn: string, schema: string, sourceName: string): string {
  return `${normalizeColumnName(conn)}\0${normalizeColumnName(schema)}\0${normalizeColumnName(sourceName)}`;
}

export function sourceKeyFromRef(ref: SourceRef): string {
  return sourceKey(ref.connectionId, ref.schema, ref.sourceName);
}

export function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

export const FIELD_EXPOSURE_UI_DIR = ".ktx-ui/field-exposure";
export const EXPECTED_LEDGERS_FILENAME = "expected-ledgers.json";
export const SERVING_GENERATION_FILENAME = "serving-generation.json";

export async function fieldExposureUiDir(projectRoot?: string): Promise<string> {
  const root = projectRoot ?? (await resolveProjectRoot());
  return path.join(root, FIELD_EXPOSURE_UI_DIR);
}

export function ledgerRelPath(connectionId: string, sourceName: string): string {
  return path.posix.join(
    "semantic-layer",
    connectionId,
    "_exposure",
    `${sourceName}.yaml`
  );
}

export async function ledgerAbsolutePath(
  connectionId: string,
  sourceName: string
): Promise<string> {
  const paths = await loadContentPaths();
  return path.join(paths.semanticLayer, connectionId, "_exposure", `${sourceName}.yaml`);
}

export function isFieldExposureLogicalPath(logicalPath: string): boolean {
  const parts = logicalPath.split("/");
  // semantic-layer/<conn>/_exposure/<source>.yaml
  return (
    parts[0] === "semantic-layer" &&
    parts.length >= 4 &&
    parts[2] === "_exposure" &&
    /\.ya?ml$/i.test(parts[parts.length - 1] ?? "")
  );
}

// ─── Expected set (D19／D25) ────────────────────────────────────────────────

export type ExpectedLedgersDocument = {
  schemaVersion: number;
  generationId: string;
  expectedSetRequired: boolean;
  sources: Array<{ connectionId: string; schema: string; sourceName: string }>;
};

export function trustedEmptyExpectedSet(generationId: string | null = null): ExpectedSetLoad {
  return {
    state: "ready",
    set: new Set(),
    digest: KNOWN_EMPTY_EXPECTED_DIGEST,
    generationId,
    expectedSetRequired: false
  };
}

export function parseExpectedSetDocument(
  raw: string,
  servingGenerationId: string | null
): ExpectedSetLoad {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: "expected_set_corrupt",
      expectedSetRequired: true
    };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: "expected_set_corrupt",
      expectedSetRequired: true
    };
  }
  const record = doc as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (schemaVersion !== EXPECTED_SET_SCHEMA_VERSION) {
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: typeof record.generationId === "string" ? record.generationId : null,
      reason: "expected_set_unsupported_version",
      expectedSetRequired: true
    };
  }
  const generationId = typeof record.generationId === "string" ? record.generationId : null;
  if (servingGenerationId && generationId && generationId !== servingGenerationId) {
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId,
      reason: "expected_set_generation_mismatch",
      expectedSetRequired: true
    };
  }
  const expectedSetRequired = record.expectedSetRequired === true;
  const sources = Array.isArray(record.sources) ? record.sources : null;
  if (!sources) {
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId,
      reason: "expected_set_corrupt",
      expectedSetRequired: true
    };
  }
  const set = new Set<string>();
  for (const entry of sources) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.connectionId !== "string" ||
      typeof e.schema !== "string" ||
      typeof e.sourceName !== "string"
    ) {
      return {
        state: "unavailable",
        set: new Set(),
        digest: null,
        generationId,
        reason: "expected_set_corrupt",
        expectedSetRequired: true
      };
    }
    set.add(sourceKey(e.connectionId, e.schema, e.sourceName));
  }
  return {
    state: "ready",
    set,
    digest: digestText(raw),
    generationId,
    expectedSetRequired
  };
}

export async function loadExpectedSetFromDisk(
  uiDir: string,
  servingGenerationId: string | null
): Promise<ExpectedSetLoad> {
  const filePath = path.join(uiDir, EXPECTED_LEDGERS_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Trusted empty sentinel when feature never enabled (D25).
      return trustedEmptyExpectedSet(servingGenerationId);
    }
    return {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: "expected_set_unreadable",
      expectedSetRequired: true
    };
  }
  return parseExpectedSetDocument(raw, servingGenerationId);
}

export async function writeExpectedSetDocument(
  uiDir: string,
  doc: ExpectedLedgersDocument
): Promise<void> {
  await mkdir(uiDir, { recursive: true });
  const payload = `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(path.join(uiDir, EXPECTED_LEDGERS_FILENAME), payload, "utf8");
}

// ─── Ledger parse ───────────────────────────────────────────────────────────

export function parseLedgerYaml(
  text: string,
  expected: SourceRef
): ExposureSet {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: null,
      digest: null,
      reason: "ledger_corrupt"
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: null,
      digest: null,
      reason: "ledger_corrupt"
    };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== FIELD_EXPOSURE_LEDGER_VERSION) {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: typeof record.version === "number" ? record.version : null,
      digest: null,
      reason: "ledger_unsupported_version"
    };
  }
  const source = record.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: FIELD_EXPOSURE_LEDGER_VERSION,
      digest: null,
      reason: "ledger_source_mismatch"
    };
  }
  const src = source as Record<string, unknown>;
  if (
    normalizeColumnName(String(src.connectionId ?? "")) !== normalizeColumnName(expected.connectionId) ||
    normalizeColumnName(String(src.schema ?? "")) !== normalizeColumnName(expected.schema) ||
    normalizeColumnName(String(src.sourceName ?? "")) !== normalizeColumnName(expected.sourceName)
  ) {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: FIELD_EXPOSURE_LEDGER_VERSION,
      digest: null,
      reason: "ledger_source_mismatch"
    };
  }
  const excludedRaw = Array.isArray(record.excluded_columns)
    ? record.excluded_columns.filter((c): c is string => typeof c === "string")
    : null;
  if (!excludedRaw) {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: FIELD_EXPOSURE_LEDGER_VERSION,
      digest: null,
      reason: "ledger_corrupt"
    };
  }
  const excluded = normalizeColumnNames(excludedRaw);
  const mode: ExposureMode = excluded.size === 0 ? "full_expose" : "trimmed";
  return {
    excluded,
    state: "configured",
    mode,
    version: FIELD_EXPOSURE_LEDGER_VERSION,
    digest: digestText(text)
  };
}

export function serializeLedger(ledger: FieldExposureLedger): string {
  return stringifyYaml(ledger);
}

export function loadExposureSet(
  conn: string,
  schema: string,
  sourceName: string,
  snapshot: Pick<ActivatedSnapshot, "expectedSetLoad" | "exposureLedgersBySource">
): ExposureSet {
  if (snapshot.expectedSetLoad.state === "unavailable") {
    return {
      excluded: new Set(),
      state: "unavailable",
      mode: null,
      version: null,
      digest: null,
      reason: snapshot.expectedSetLoad.reason ?? "expected_set_unavailable"
    };
  }
  const key = sourceKey(conn, schema, sourceName);
  const expected = snapshot.expectedSetLoad.set.has(key);
  const text = snapshot.exposureLedgersBySource.get(key);
  if (text === undefined) {
    if (expected) {
      return {
        excluded: new Set(),
        state: "unavailable",
        mode: null,
        version: null,
        digest: "missing-after-expected",
        reason: "expected_ledger_missing"
      };
    }
    return {
      excluded: new Set(),
      state: "unconfigured",
      mode: "unconfigured",
      version: null,
      digest: null
    };
  }
  return parseLedgerYaml(text, { connectionId: conn, schema, sourceName });
}

export function exposureDecision(
  exposureSet: ExposureSet,
  _toolName?: string,
  sourceRef?: SourceRef
): ExposureDecision {
  if (exposureSet.state === "unavailable") {
    return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE, source: sourceRef };
  }
  if (exposureSet.mode === "unconfigured" || exposureSet.mode === "full_expose") {
    return { allow: true, fullInventory: true, mode: exposureSet.mode! };
  }
  return {
    allow: true,
    fullInventory: false,
    mode: "trimmed",
    excluded: exposureSet.excluded
  };
}

export function snapshotHasAnyTrimmed(snapshot: Pick<ActivatedSnapshot, "exposureLedgersBySource" | "expectedSetLoad">): boolean {
  if (snapshot.expectedSetLoad.state === "unavailable") return false;
  for (const [key, text] of snapshot.exposureLedgersBySource) {
    const [conn, schema, sourceName] = key.split("\0");
    if (!conn || !schema || !sourceName) continue;
    const set = parseLedgerYaml(text, { connectionId: conn, schema, sourceName });
    if (set.state === "configured" && set.mode === "trimmed") return true;
  }
  return false;
}

export function snapshotHasAnyExpectedFault(
  snapshot: Pick<ActivatedSnapshot, "expectedSetLoad">
): boolean {
  return snapshot.expectedSetLoad.state === "unavailable";
}

export function snapshotHasAnyTrimmedOrExpectedFault(
  snapshot: Pick<ActivatedSnapshot, "exposureLedgersBySource" | "expectedSetLoad">
): boolean {
  return snapshotHasAnyExpectedFault(snapshot) || snapshotHasAnyTrimmed(snapshot);
}

// ─── Serving generation / AdmissionMode (Strat-B) ───────────────────────────

type DurableServingRecord = {
  generationId: string;
  upstreamExecutionGenerationId: string;
  activatedAt: string;
  admissionMode: AdmissionMode;
  expectedSetRequired: boolean;
  semanticDefinitionDigest: string;
  indexConsumptionDigest: string;
  /** sourceKey → ledger yaml */
  ledgers: Record<string, string>;
};

let cachedServing: ActivatedSnapshot | null = null;
let servingLoadError: string | null = null;

/**
 * Strat-B DRAIN in-flight tracker (first-period).
 * Enter/Leave wraps upstream semantic tools/call bodies when wired; beginAdmissionDrain
 * waits until zero or `waitMs` elapses. Timeout does **not** cancel in-flight work.
 */
let upstreamSemanticInFlight = 0;

export function trackUpstreamSemanticEnter(): void {
  upstreamSemanticInFlight += 1;
}

export function trackUpstreamSemanticLeave(): void {
  upstreamSemanticInFlight = Math.max(0, upstreamSemanticInFlight - 1);
}

export function getUpstreamSemanticInFlightForTests(): number {
  return upstreamSemanticInFlight;
}

/** Production default grace; Vitest / NODE_ENV=test → 0 so unit suites stay fast. */
export function defaultAdmissionDrainWaitMs(): number {
  if (typeof process !== "undefined") {
    const override = process.env.LUCY_ADMISSION_DRAIN_WAIT_MS;
    if (override !== undefined && override !== "" && Number.isFinite(Number(override))) {
      return Math.max(0, Number(override));
    }
    if (process.env.VITEST || process.env.NODE_ENV === "test") return 0;
  }
  return 500;
}

export function resetFieldExposureRuntimeForTests(): void {
  cachedServing = null;
  servingLoadError = null;
  evidenceNoFieldNames.clear();
  upstreamSemanticInFlight = 0;
}

function buildSnapshotFromDurable(
  record: DurableServingRecord,
  expected: ExpectedSetLoad
): ActivatedSnapshot {
  const ledgers = new Map<string, string>(Object.entries(record.ledgers ?? {}));
  const digests = new Map<string, string>();
  for (const [key, text] of ledgers) {
    digests.set(key, digestText(text));
  }
  return {
    generationId: record.generationId,
    exposureLedgersBySource: ledgers,
    exposureDigestPerSource: digests,
    expectedSetLoad: expected,
    semanticDefinitionView: {
      generationId: record.generationId,
      digest: record.semanticDefinitionDigest
    },
    indexConsumptionVersion: {
      boundGenerationId: record.generationId,
      digest: record.indexConsumptionDigest
    },
    upstreamExecutionGenerationId: record.upstreamExecutionGenerationId,
    activatedAt: record.activatedAt,
    admissionMode: record.admissionMode
  };
}

/** Bootstrap: never-enabled feature → OPEN + trusted empty expected. */
export function bootstrapEmptyServingGeneration(
  generationId = "gen-bootstrap"
): ActivatedSnapshot {
  return {
    generationId,
    exposureLedgersBySource: new Map(),
    exposureDigestPerSource: new Map(),
    expectedSetLoad: trustedEmptyExpectedSet(generationId),
    semanticDefinitionView: { generationId, digest: digestText("empty-def") },
    indexConsumptionVersion: { boundGenerationId: generationId, digest: digestText("empty-idx") },
    upstreamExecutionGenerationId: generationId,
    activatedAt: new Date(0).toISOString(),
    admissionMode: "OPEN"
  };
}

export async function loadServingGeneration(
  options: { projectRoot?: string; forceReload?: boolean } = {}
): Promise<ActivatedSnapshot> {
  if (cachedServing && !options.forceReload) return cachedServing;
  const uiDir = await fieldExposureUiDir(options.projectRoot);
  const filePath = path.join(uiDir, SERVING_GENERATION_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const boot = bootstrapEmptyServingGeneration();
      cachedServing = boot;
      servingLoadError = null;
      return boot;
    }
    servingLoadError = "serving_generation_unreadable";
    const fail = bootstrapEmptyServingGeneration("gen-unresolvable");
    fail.expectedSetLoad = {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: servingLoadError,
      expectedSetRequired: true
    };
    fail.admissionMode = "STOP_ADMISSION";
    cachedServing = fail;
    return fail;
  }
  let record: DurableServingRecord;
  try {
    record = JSON.parse(raw) as DurableServingRecord;
  } catch {
    servingLoadError = "serving_generation_corrupt";
    const fail = bootstrapEmptyServingGeneration("gen-unresolvable");
    fail.expectedSetLoad = {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: servingLoadError,
      expectedSetRequired: true
    };
    fail.admissionMode = "STOP_ADMISSION";
    cachedServing = fail;
    return fail;
  }
  if (
    !record.generationId ||
    !record.upstreamExecutionGenerationId ||
    !record.admissionMode
  ) {
    servingLoadError = "serving_generation_corrupt";
    const fail = bootstrapEmptyServingGeneration("gen-unresolvable");
    fail.expectedSetLoad = {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: null,
      reason: servingLoadError,
      expectedSetRequired: true
    };
    fail.admissionMode = "STOP_ADMISSION";
    cachedServing = fail;
    return fail;
  }
  // Transition / binding mismatch → keep STOP until recovered (SC-26).
  if (
    record.admissionMode === "OPEN" &&
    record.upstreamExecutionGenerationId !== record.generationId
  ) {
    record = { ...record, admissionMode: "STOP_ADMISSION" };
  }
  const expected = await loadExpectedSetFromDisk(uiDir, record.generationId);
  // If expectedSetRequired was true historically but file missing → unavailable already.
  if (record.expectedSetRequired && expected.state === "ready" && !expected.expectedSetRequired && expected.set.size === 0) {
    // Durable says required but disk returned trusted-empty sentinel (missing file).
    const unavailable: ExpectedSetLoad = {
      state: "unavailable",
      set: new Set(),
      digest: null,
      generationId: record.generationId,
      reason: "expected_set_missing",
      expectedSetRequired: true
    };
    const snap = buildSnapshotFromDurable(record, unavailable);
    cachedServing = snap;
    servingLoadError = null;
    return snap;
  }
  const snap = buildSnapshotFromDurable(record, expected);
  cachedServing = snap;
  servingLoadError = null;
  return snap;
}

export function pinServingGeneration(snapshot: ActivatedSnapshot): ActivatedSnapshot {
  cachedServing = snapshot;
  return snapshot;
}

export async function persistServingGeneration(
  snapshot: ActivatedSnapshot,
  options: { projectRoot?: string } = {}
): Promise<void> {
  const uiDir = await fieldExposureUiDir(options.projectRoot);
  await mkdir(uiDir, { recursive: true });
  const record: DurableServingRecord = {
    generationId: snapshot.generationId,
    upstreamExecutionGenerationId: snapshot.upstreamExecutionGenerationId,
    activatedAt: snapshot.activatedAt,
    admissionMode: snapshot.admissionMode,
    expectedSetRequired: snapshot.expectedSetLoad.expectedSetRequired,
    semanticDefinitionDigest: snapshot.semanticDefinitionView.digest,
    indexConsumptionDigest: snapshot.indexConsumptionVersion.digest,
    ledgers: Object.fromEntries(snapshot.exposureLedgersBySource)
  };
  await writeFile(
    path.join(uiDir, SERVING_GENERATION_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  // Keep expected set in sync when ready.
  if (snapshot.expectedSetLoad.state === "ready") {
    const sources: ExpectedLedgersDocument["sources"] = [];
    for (const key of snapshot.expectedSetLoad.set) {
      const [connectionId, schema, sourceName] = key.split("\0");
      if (connectionId && schema && sourceName) {
        sources.push({ connectionId, schema, sourceName });
      }
    }
    await writeExpectedSetDocument(uiDir, {
      schemaVersion: EXPECTED_SET_SCHEMA_VERSION,
      generationId: snapshot.generationId,
      expectedSetRequired: snapshot.expectedSetLoad.expectedSetRequired,
      sources
    });
  }
  cachedServing = snapshot;
}

/**
 * Strat-B activation helper: STOP → install generation → set upstream=gen → OPEN.
 * Callers that cannot keep old upstream must stop admission before mutating shared index.
 */
export async function activateExecutionGenerationStratB(
  next: Omit<ActivatedSnapshot, "admissionMode"> & { admissionMode?: AdmissionMode },
  options: { projectRoot?: string } = {}
): Promise<ActivatedSnapshot> {
  const stopped: ActivatedSnapshot = {
    ...next,
    admissionMode: "STOP_ADMISSION",
    upstreamExecutionGenerationId: next.upstreamExecutionGenerationId
  };
  await persistServingGeneration(stopped, options);
  // Drain is a no-op barrier in-process for unit tests; production waits on in-flight.
  const open: ActivatedSnapshot = {
    ...next,
    admissionMode: "OPEN",
    upstreamExecutionGenerationId: next.generationId
  };
  await persistServingGeneration(open, options);
  return open;
}

/**
 * SC-26 — 索引已跑新定义但暴露激活确认失败时，强制 STOP，禁止「上游 V2 + serving V1 + OPEN」。
 * 注意：本函数**不**改写 `upstreamExecutionGenerationId`。索引 mutate 成功后须改用
 * `markUpstreamIndexAdvanced`／`settle(index_succeeded_keep_stop)`，否则后续
 * `index_failed`→`forceResumeAdmission` 会因标签仍相等而误 OPEN。
 */
export async function forceStopAdmission(
  options: { projectRoot?: string } = {}
): Promise<ActivatedSnapshot> {
  const current = await loadServingGeneration({
    projectRoot: options.projectRoot,
    forceReload: true
  });
  const stopped: ActivatedSnapshot = {
    ...current,
    admissionMode: "STOP_ADMISSION"
  };
  await persistServingGeneration(stopped, options);
  return stopped;
}

/** Durable sentinel prefix：共享索引已消费新于 serving 的定义（OPEN 前禁 RESUME）。 */
export const UPSTREAM_INDEX_ADVANCED_PREFIX = "index-advanced:";

export function isUpstreamAheadOfServing(
  snapshot: Pick<ActivatedSnapshot, "upstreamExecutionGenerationId" | "generationId">
): boolean {
  return snapshot.upstreamExecutionGenerationId !== snapshot.generationId;
}

/**
 * 共享索引 mutate 成功后、激活／align 确认前：耐久写入
 * `upstreamExecutionGenerationId ≠ generationId`（或保留已有错位），并 STOP。
 * 之后任意 `forceResumeAdmission`／`settle(index_failed)` 见此态只 STOP，
 * 直至 `align`／激活成功或显式回滚上游。
 */
export async function markUpstreamIndexAdvanced(
  options: { projectRoot?: string; advancedId?: string } = {}
): Promise<ActivatedSnapshot> {
  const current = await loadServingGeneration({
    projectRoot: options.projectRoot,
    forceReload: true
  });
  const advancedId =
    options.advancedId ??
    (isUpstreamAheadOfServing(current)
      ? current.upstreamExecutionGenerationId
      : `${UPSTREAM_INDEX_ADVANCED_PREFIX}${Date.now().toString(36)}`);
  const next: ActivatedSnapshot = {
    ...current,
    admissionMode: "STOP_ADMISSION",
    upstreamExecutionGenerationId: advancedId
  };
  await persistServingGeneration(next, options);
  return next;
}

/**
 * Strat-B 可观测排空窗：在 STOP 之后、改写共享索引之前切到 DRAINING。
 * 与 STOP 一样拒绝触达上游语义执行的新请求；供发布窗口探针断言「非 OPEN」。
 *
 * First-period minimal barrier (documented):
 * 1. Persist `DRAINING` immediately (observable; new upstream tools denied).
 * 2. Bounded wait for tracked in-flight (`trackUpstreamSemanticEnter/Leave`) until
 *    zero or `waitMs` elapses (default via `defaultAdmissionDrainWaitMs`).
 * 3. Does **not** cancel in-flight upstream work after timeout; caller may still
 *    mutate the shared index while DRAINING/STOP continues to reject new admission.
 */
export async function beginAdmissionDrain(
  options: { projectRoot?: string; waitMs?: number } = {}
): Promise<ActivatedSnapshot> {
  const current = await loadServingGeneration({
    projectRoot: options.projectRoot,
    forceReload: true
  });
  const draining: ActivatedSnapshot = {
    ...current,
    admissionMode: "DRAINING"
  };
  await persistServingGeneration(draining, options);
  const waitMs = options.waitMs ?? defaultAdmissionDrainWaitMs();
  if (waitMs > 0) {
    const deadline = Date.now() + waitMs;
    let observedInFlight = upstreamSemanticInFlight > 0;
    while (Date.now() < deadline) {
      if (upstreamSemanticInFlight > 0) observedInFlight = true;
      if (observedInFlight && upstreamSemanticInFlight === 0) break;
      if (!observedInFlight) {
        // Registry unused: full bounded grace so DRAIN is still a real wait window.
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return draining;
}

/**
 * Strat-B：共享索引未成功切到新代（reindex 失败）时恢复 OPEN。
 * 若 upstream≠serving（含 `index-advanced:*` 哨兵／激活失败半通）则保持 STOP，
 * 禁止「真实上游已新代 + serving 旧代 + OPEN」。
 */
export async function forceResumeAdmission(
  options: { projectRoot?: string } = {}
): Promise<ActivatedSnapshot> {
  const current = await loadServingGeneration({
    projectRoot: options.projectRoot,
    forceReload: true
  });
  if (isUpstreamAheadOfServing(current)) {
    return forceStopAdmission(options);
  }
  const open: ActivatedSnapshot = {
    ...current,
    admissionMode: "OPEN"
  };
  await persistServingGeneration(open, options);
  return open;
}

/**
 * Arm Strat-B before any shared-index mutate (publish `runReindex` + manual reindex).
 * On failure keeps STOP and returns false — caller must not call reindex.
 */
export async function armSharedIndexMutationBarrier(
  options: { projectRoot?: string; waitMs?: number } = {}
): Promise<boolean> {
  try {
    await forceStopAdmission(options);
    await beginAdmissionDrain(options);
    return true;
  } catch {
    await forceStopAdmission(options).catch(() => undefined);
    return false;
  }
}

/**
 * After a successful shared-index mutate: advance ExecutionGeneration so
 * `upstreamExecutionGenerationId == generationId` and OPEN.
 * Used by manual reindex and by publish when there is no fieldExposure ledger to merge
 * (avoids silently leaving DRAINING).
 */
export async function alignServingGenerationAfterSharedIndexSuccess(
  options: { projectRoot?: string; generationId: string }
): Promise<ActivatedSnapshot> {
  const previous = await loadServingGeneration({
    projectRoot: options.projectRoot,
    forceReload: true
  });
  const generationId = options.generationId;
  const next: ActivatedSnapshot = {
    ...previous,
    generationId,
    expectedSetLoad: {
      ...previous.expectedSetLoad,
      generationId:
        previous.expectedSetLoad.state === "ready"
          ? generationId
          : previous.expectedSetLoad.generationId,
      digest:
        previous.expectedSetLoad.state === "ready"
          ? `sha256:expected-${generationId}`
          : previous.expectedSetLoad.digest
    },
    semanticDefinitionView: {
      generationId,
      digest: previous.semanticDefinitionView.digest
    },
    indexConsumptionVersion: {
      boundGenerationId: generationId,
      digest: previous.indexConsumptionVersion.digest
    },
    upstreamExecutionGenerationId: generationId,
    activatedAt: new Date().toISOString(),
    admissionMode: "OPEN"
  };
  return activateExecutionGenerationStratB(next, { projectRoot: options.projectRoot });
}

/**
 * Settle Strat-B after shared-index mutate.
 * - index_failed → RESUME only when upstream==serving (else STOP；含 index-advanced 哨兵)
 * - index_succeeded_keep_stop → STOP + 耐久 upstream≠serving（禁后续 index_failed 误 OPEN）
 * - index_succeeded_align → advance generation + OPEN
 */
export async function settleSharedIndexMutationBarrier(
  options: {
    projectRoot?: string;
    outcome: "index_failed" | "index_succeeded_keep_stop" | "index_succeeded_align";
    generationId?: string;
  }
): Promise<ActivatedSnapshot> {
  if (options.outcome === "index_failed") {
    return forceResumeAdmission(options);
  }
  if (options.outcome === "index_succeeded_keep_stop") {
    return markUpstreamIndexAdvanced(options);
  }
  const generationId =
    options.generationId ?? `gen-reindex-${Date.now().toString(36)}`;
  return alignServingGenerationAfterSharedIndexSuccess({
    projectRoot: options.projectRoot,
    generationId
  });
}

export function requestWouldHitUpstreamSemanticExecution(toolName: string): boolean {
  return UPSTREAM_SEMANTIC_TOOLS.has(toolName);
}

export function admitToolsCallEntry(
  toolName: string,
  snapshot: ActivatedSnapshot
): { allow: true } | { allow: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE } {
  if (
    (snapshot.admissionMode === "STOP_ADMISSION" || snapshot.admissionMode === "DRAINING") &&
    requestWouldHitUpstreamSemanticExecution(toolName)
  ) {
    return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
  if (
    snapshot.admissionMode === "OPEN" &&
    snapshot.upstreamExecutionGenerationId !== snapshot.generationId
  ) {
    return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
  return { allow: true };
}

// ─── Discovery trim (D21／D22) ───────────────────────────────────────────────

export type CarrierKind = "read_source_columns" | "hive_columns" | "generic_columns";

export function stripUnexposedColumnsFromArray(
  columns: unknown,
  excluded: Set<string>
): { ok: true; columns: unknown } | { ok: false; reason: string } {
  if (!Array.isArray(columns)) {
    return { ok: false, reason: "columns_not_array" };
  }
  const next: unknown[] = [];
  for (const col of columns) {
    if (typeof col === "string") {
      if (!excluded.has(normalizeColumnName(col))) next.push(col);
      continue;
    }
    if (col && typeof col === "object" && !Array.isArray(col)) {
      const record = col as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.column === "string"
            ? record.column
            : typeof record.field === "string"
              ? record.field
              : null;
      if (name === null) {
        return { ok: false, reason: "column_missing_name" };
      }
      if (!excluded.has(normalizeColumnName(name))) next.push(col);
      continue;
    }
    return { ok: false, reason: "column_unrecognized_shape" };
  }
  return { ok: true, columns: next };
}

export function applyDiscoveryTrim(
  payload: unknown,
  decision: Extract<ExposureDecision, { allow: true }>,
  carrierKind: CarrierKind
):
  | { ok: true; payload: unknown }
  | { ok: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE } {
  if (decision.fullInventory) {
    return { ok: true, payload };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
  try {
    const root = payload as Record<string, unknown>;
    // Common shapes: { columns: [...] } or nested result.content / structuredContent.
    const tryTrim = (obj: Record<string, unknown>): boolean => {
      if ("columns" in obj) {
        const trimmed = stripUnexposedColumnsFromArray(obj.columns, decision.excluded);
        if (!trimmed.ok) throw new Error(trimmed.reason);
        obj.columns = trimmed.columns;
        return true;
      }
      return false;
    };
    if (tryTrim(root)) return { ok: true, payload: root };
    // MCP tool result envelope
    const result = root.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      if (tryTrim(r)) return { ok: true, payload: root };
      const structured = r.structuredContent;
      if (structured && typeof structured === "object" && !Array.isArray(structured)) {
        if (tryTrim(structured as Record<string, unknown>)) return { ok: true, payload: root };
      }
      // text content JSON blob
      if (Array.isArray(r.content)) {
        for (const item of r.content) {
          if (!item || typeof item !== "object") continue;
          const entry = item as Record<string, unknown>;
          if (entry.type === "text" && typeof entry.text === "string") {
            try {
              const inner = JSON.parse(entry.text) as unknown;
              if (inner && typeof inner === "object" && !Array.isArray(inner)) {
                const copy = { ...(inner as Record<string, unknown>) };
                if (tryTrim(copy)) {
                  entry.text = JSON.stringify(copy);
                  return { ok: true, payload: root };
                }
              }
            } catch {
              // fall through
            }
          }
        }
      }
    }
    // Unknown shape with trim required → fail-closed (D22); never pass original.
    void carrierKind;
    return { ok: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  } catch {
    return { ok: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
}

export function admitSourceForDiscovery(
  src: SourceRef,
  snapshot: ActivatedSnapshot,
  toolName = "lucy_read_source"
):
  | { allow: true; exposure: ExposureSet; decision: Extract<ExposureDecision, { allow: true }> }
  | { allow: false; reason: typeof FIELD_EXPOSURE_UNAVAILABLE } {
  const exposure = loadExposureSet(src.connectionId, src.schema, src.sourceName, snapshot);
  const decision = exposureDecision(exposure, toolName, src);
  if (!decision.allow) {
    return { allow: false, reason: decision.reason };
  }
  return { allow: true, exposure, decision };
}

/**
 * Rewrite catalog.examples so they do not name excluded columns (SC-21).
 * Conservative: drop any example that mentions `<source>.<excludedCol>` for a trimmed source.
 */
export function rewriteExamples(
  examples: string[],
  snapshot: ActivatedSnapshot
): string[] {
  if (!snapshotHasAnyTrimmed(snapshot)) return examples;
  const excludedBySource = new Map<string, Set<string>>();
  for (const [key, text] of snapshot.exposureLedgersBySource) {
    const [conn, schema, sourceName] = key.split("\0");
    if (!conn || !schema || !sourceName) continue;
    const set = parseLedgerYaml(text, { connectionId: conn, schema, sourceName });
    if (set.state === "configured" && set.mode === "trimmed") {
      excludedBySource.set(normalizeColumnName(sourceName), set.excluded);
    }
  }
  return examples.filter((example) => {
    for (const [sourceName, excluded] of excludedBySource) {
      for (const col of excluded) {
        const needle = `${sourceName}.${col}`;
        if (example.toLowerCase().includes(needle)) return false;
      }
    }
    return true;
  });
}

// ─── Query field validation (D10／D20／D24) ──────────────────────────────────

export function collectNamedFieldRefs(args: unknown): NamedFieldRef[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const a = args as Record<string, unknown>;
  const refs: NamedFieldRef[] = [];

  const pushField = (raw: string, carrier: FieldRefCarrier) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(".");
    const columnHint = parts.length >= 2 ? parts[parts.length - 1]! : trimmed;
    refs.push({ raw: trimmed, carrier, columnHint });
  };

  for (const d of (a.dimensions as Array<{ field?: string }> | undefined) ?? []) {
    if (d?.field) pushField(d.field, "dimensions");
  }

  const orderKeys = ["order_by", "orderBy"] as const;
  for (const key of orderKeys) {
    for (const o of (a[key] as Array<{ field?: string }> | undefined) ?? []) {
      if (o?.field) pushField(o.field, "order_by");
    }
  }

  const filters = a.filters;
  if (Array.isArray(filters)) {
    for (const f of filters) {
      if (typeof f === "string") {
        // Best-effort: extract source.column tokens from string filters.
        let matched = 0;
        for (const match of f.matchAll(/\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b/g)) {
          matched += 1;
          pushField(`${match[1]}.${match[2]}`, "filters");
        }
        // Non-empty string filter with zero extractable refs → unparseable marker (SC-20).
        if (matched === 0 && f.trim()) {
          refs.push({ raw: f.trim(), carrier: "filters", columnHint: "" });
        }
      } else if (f && typeof f === "object" && !Array.isArray(f)) {
        const fr = f as Record<string, unknown>;
        if (typeof fr.field === "string") pushField(fr.field, "filters");
      }
    }
  }

  const measures = a.measures;
  if (Array.isArray(measures)) {
    for (const m of measures) {
      if (typeof m === "string") {
        pushField(m, "measures");
      } else if (m && typeof m === "object" && !Array.isArray(m)) {
        const mr = m as Record<string, unknown>;
        if (typeof mr.expr === "string" && mr.expr.trim()) {
          for (const match of mr.expr.matchAll(/\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b/g)) {
            pushField(`${match[1]}.${match[2]}`, "measures");
          }
        }
      }
    }
  }

  const segments = a.segments;
  if (Array.isArray(segments)) {
    for (const s of segments) {
      if (typeof s === "string") pushField(s, "segments");
    }
  }

  return refs;
}

export type SourceMapLookup = {
  /** Resolve sourceName (+ optional connection) to identity; null if unknown. */
  resolveSource?: (
    sourceName: string,
    connectionId?: string
  ) => { connectionId: string; schema: string; sourceName: string } | null;
};

export function resolveRefToIdentityAndColumn(
  ref: NamedFieldRef,
  argsConnectionId: string | undefined,
  lookup: SourceMapLookup,
  _definitionView?: ActivatedSnapshot["semanticDefinitionView"]
): ResolveRefResult {
  const parts = ref.raw.split(".");
  if (parts.length < 2) {
    // Bare column / segment name — cannot attribute without richer map.
    return { kind: "UNPARSEABLE" };
  }
  const sourceName = parts[0]!;
  const column = parts.slice(1).join(".");
  const resolved = lookup.resolveSource?.(sourceName, argsConnectionId);
  if (!resolved) {
    // Unknown source: treat as unparseable for exposure purposes.
    return { kind: "UNPARSEABLE" };
  }
  return {
    kind: "IDENTITY_COLUMN",
    conn: resolved.connectionId,
    schema: resolved.schema,
    sourceName: resolved.sourceName,
    column
  };
}

export function resolveInvolvedSources(
  args: unknown,
  lookup: SourceMapLookup
): SourceRef[] | "EMPTY" {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "EMPTY";
  const a = args as Record<string, unknown>;
  const connectionId = firstString(a, ["connectionId", "connection_id", "connection", "database"]);
  const found = new Map<string, SourceRef>();

  const addSourceName = (name: string | undefined) => {
    if (!name || typeof name !== "string") return;
    const resolved = lookup.resolveSource?.(name.trim(), connectionId);
    if (!resolved) return;
    const key = sourceKeyFromRef(resolved);
    found.set(key, resolved);
  };

  addSourceName(
    typeof a.sourceName === "string"
      ? a.sourceName
      : typeof a.source_name === "string"
        ? a.source_name
        : typeof a.source === "string"
          ? a.source
          : typeof a.table === "string"
            ? a.table
            : undefined
  );

  for (const ref of collectNamedFieldRefs(args)) {
    const parts = ref.raw.split(".");
    if (parts.length >= 2) addSourceName(parts[0]);
  }

  if (found.size === 0) return "EMPTY";
  return [...found.values()];
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function validateQueryFieldsAgainstExposure(
  args: unknown,
  lookup: SourceMapLookup,
  snapshot: ActivatedSnapshot
): QueryExposureVerdict {
  const involved = resolveInvolvedSources(args, lookup);
  if (involved === "EMPTY") {
    if (snapshotHasAnyTrimmedOrExpectedFault(snapshot)) {
      return {
        denyReason: FIELD_EXPOSURE_UNAVAILABLE,
        attribution: { kind: "unresolvable_sources" }
      };
    }
    return { denyReason: null };
  }

  let trimmedScope = false;
  let lastDigest: string | null = null;
  for (const src of involved) {
    const exposure = loadExposureSet(src.connectionId, src.schema, src.sourceName, snapshot);
    const decision = exposureDecision(exposure, "lucy_query", src);
    if (!decision.allow) {
      return {
        denyReason: decision.reason,
        attribution: { kind: "exposure_unavailable", source: src },
        exposureDigest: exposure.digest
      };
    }
    if (decision.mode === "trimmed") trimmedScope = true;
    if (exposure.digest) lastDigest = exposure.digest;
  }

  const argsRecord = args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
  const connectionId = firstString(argsRecord, ["connectionId", "connection_id", "connection", "database"]);

  for (const ref of collectNamedFieldRefs(args)) {
    const resolved = resolveRefToIdentityAndColumn(
      ref,
      connectionId,
      lookup,
      snapshot.semanticDefinitionView
    );
    if (resolved.kind === "LEGAL_ZERO_COLUMN_SOURCE") continue;
    if (resolved.kind === "AMBIGUOUS") {
      if (trimmedScope || snapshotHasAnyTrimmed(snapshot)) {
        return {
          denyReason: FIELD_EXPOSURE_UNAVAILABLE,
          attribution: { kind: "ambiguous_ref", ref: ref.raw },
          exposureDigest: lastDigest
        };
      }
      continue;
    }
    if (resolved.kind === "UNPARSEABLE") {
      if (trimmedScope || snapshotHasAnyTrimmed(snapshot)) {
        return {
          denyReason: FIELD_NOT_EXPOSED,
          attribution: { kind: "unresolvable_ref", ref: ref.raw, carrier: ref.carrier },
          exposureDigest: lastDigest
        };
      }
      continue;
    }

    const exposure = loadExposureSet(
      resolved.conn,
      resolved.schema,
      resolved.sourceName,
      snapshot
    );
    const decision = exposureDecision(exposure, "lucy_query", {
      connectionId: resolved.conn,
      schema: resolved.schema,
      sourceName: resolved.sourceName
    });
    if (!decision.allow) {
      return {
        denyReason: decision.reason,
        attribution: { kind: "exposure_unavailable", column: resolved.column },
        exposureDigest: exposure.digest
      };
    }
    if (decision.fullInventory) continue;
    if (decision.excluded.has(normalizeColumnName(resolved.column))) {
      return {
        denyReason: FIELD_NOT_EXPOSED,
        attribution: {
          carrier: ref.carrier,
          column: resolved.column,
          source: resolved.sourceName
        },
        exposureDigest: exposure.digest
      };
    }
  }
  return { denyReason: null, exposureDigest: lastDigest };
}

// ─── Passthrough scope (D26／R3c) ───────────────────────────────────────────

export function extractPassthroughSources(
  toolName: string,
  args: unknown,
  lookup: SourceMapLookup
): SourceRef[] | "INSTANCE_WIDE" | "EMPTY" | "UNRESOLVABLE" {
  if (toolName === "dictionary_search" || toolName === "discover_data") {
    return "INSTANCE_WIDE";
  }
  if (toolName === "entity_details" || toolName === "sl_validate") {
    if (!args || typeof args !== "object" || Array.isArray(args)) return "EMPTY";
    const a = args as Record<string, unknown>;
    const connectionId = firstString(a, ["connectionId", "connection_id", "connection", "database"]);
    const found = new Map<string, SourceRef>();
    const add = (name: unknown) => {
      if (typeof name !== "string" || !name.trim()) return;
      const resolved = lookup.resolveSource?.(name.trim(), connectionId);
      if (!resolved) return;
      found.set(sourceKeyFromRef(resolved), resolved);
    };
    add(a.sourceName ?? a.source_name ?? a.source ?? a.table);
    // entity_details may carry entities list
    if (Array.isArray(a.entities)) {
      for (const ent of a.entities) {
        if (typeof ent === "string") add(ent);
        else if (ent && typeof ent === "object") {
          const er = ent as Record<string, unknown>;
          add(er.sourceName ?? er.source ?? er.table ?? er.name);
        }
      }
    }
    if (found.size === 0) return "EMPTY";
    return [...found.values()];
  }
  return "EMPTY";
}

export function resolvePassthroughScope(
  toolName: string,
  args: unknown,
  snapshot: ActivatedSnapshot,
  lookup: SourceMapLookup = {}
): PassthroughScope {
  if (
    snapshot.expectedSetLoad.state === "unavailable" ||
    snapshot.admissionMode !== "OPEN"
  ) {
    return { unavailable: true, touchesTrimmed: false, involved: "UNKNOWN" };
  }

  let involved = extractPassthroughSources(toolName, args, lookup);
  // R3c: EMPTY → INSTANCE_WIDE (forbid empty-loop allow).
  if (involved === "EMPTY") {
    involved = "INSTANCE_WIDE";
  }

  if (involved === "INSTANCE_WIDE") {
    if (snapshotHasAnyExpectedFault(snapshot)) {
      return { unavailable: true, touchesTrimmed: false, involved: "INSTANCE_WIDE" };
    }
    return {
      unavailable: false,
      touchesTrimmed: snapshotHasAnyTrimmed(snapshot),
      involved: "INSTANCE_WIDE"
    };
  }

  if (involved === "UNRESOLVABLE") {
    if (snapshotHasAnyTrimmedOrExpectedFault(snapshot)) {
      return { unavailable: true, touchesTrimmed: false, involved: "UNKNOWN" };
    }
    return { unavailable: false, touchesTrimmed: false, involved: "UNKNOWN" };
  }

  let touches = false;
  for (const src of involved) {
    const exp = loadExposureSet(src.connectionId, src.schema, src.sourceName, snapshot);
    if (exp.state === "unavailable") {
      return { unavailable: true, touchesTrimmed: false, involved };
    }
    if (exp.mode === "trimmed") touches = true;
  }
  return { unavailable: false, touchesTrimmed: touches, involved };
}

export function admitPassthroughForExposure(
  toolName: string,
  args: unknown,
  snapshot: ActivatedSnapshot,
  lookup: SourceMapLookup = {}
): PassthroughAdmit {
  const scope = resolvePassthroughScope(toolName, args, snapshot, lookup);
  if (scope.unavailable) {
    return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
  if (scope.touchesTrimmed && !getPassthroughEvidenceNoFieldNames(toolName)) {
    return { allow: false, reason: FIELD_EXPOSURE_UNAVAILABLE };
  }
  return { allow: true };
}

/**
 * After-auth hook for path A (sensitiveMetadata) and path B (tableTouching).
 * Must be invoked on BOTH authorizeAndRewrite exits (SC-30 insertion lock).
 */
export function afterAuthFieldExposureHook(
  toolName: string,
  args: unknown,
  snapshot: ActivatedSnapshot,
  lookup: SourceMapLookup = {}
): PassthroughAdmit | { allow: true; skip: true } {
  if (
    !SENSITIVE_META_PASSTHROUGH_TOOLS.has(toolName) &&
    !TABLE_TOUCHING_PASSTHROUGH_TOOLS.has(toolName)
  ) {
    return { allow: true, skip: true };
  }
  return admitPassthroughForExposure(toolName, args, snapshot, lookup);
}

// ─── Draft exposure (S6b：保存未发布不生效) ──────────────────────────────────

export type DraftExposureDoc = {
  connectionId: string;
  schema: string;
  sourceName: string;
  excluded_columns: string[];
  updated_at: string;
};

export async function draftExposurePath(
  connectionId: string,
  sourceName: string,
  projectRoot?: string
): Promise<string> {
  const uiDir = await fieldExposureUiDir(projectRoot);
  return path.join(uiDir, "drafts", connectionId, `${sourceName}.json`);
}

/** Workbench save → draft only；ServingGeneration 不变（SC-13／S6b）。 */
export async function writeDraftExposure(
  draft: DraftExposureDoc,
  options: { projectRoot?: string } = {}
): Promise<void> {
  const filePath = await draftExposurePath(draft.connectionId, draft.sourceName, options.projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

export async function readDraftExposure(
  connectionId: string,
  sourceName: string,
  options: { projectRoot?: string } = {}
): Promise<DraftExposureDoc | null> {
  const filePath = await draftExposurePath(connectionId, sourceName, options.projectRoot);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as DraftExposureDoc;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** SC-14 fixed copy — 业务暴露裁剪 ≠ 列级安全（工作台／帮助／发布说明三处复用）。 */
export const FIELD_EXPOSURE_NOT_COLUMN_SECURITY_COPY =
  "业务暴露裁剪 ≠ 列级安全：字段暴露控制 Agent 数据面可见与可查范围，不提供列级 ACL／脱敏／按角色分列。";
