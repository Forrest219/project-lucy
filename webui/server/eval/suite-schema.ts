// ─── Eval Suite canonical schema (M43) ────────────────────────────────────────
// Canonical parser, validator, and hash helper for Lucy-recognized Eval YAML.
// See `webui/docs/46-eval-yaml-exchange-and-result-archive-spec.md` §5–§7.

import { createHash } from "node:crypto";
import { parseDocument, isMap, isSeq } from "yaml";
import {
  EVAL_RESULT_VERSION,
  EVAL_SUITE_KIND,
  EVAL_SUITE_SCHEMA_VERSION,
  type EvalResultImport,
  type EvalSuite,
  type EvalSuiteCase
} from "../../src/lib/types.js";

// ─── error model ──────────────────────────────────────────────────────────────

export type SuiteSchemaErrorCode =
  | "INVALID_YAML"
  | "SCHEMA_VERSION_MISMATCH"
  | "KIND_MISMATCH"
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_FIELD_TYPE"
  | "INVALID_SAFE_ID"
  | "INVALID_CASE_TYPE"
  | "INVALID_EXPECTED_SOURCE"
  | "DUPLICATE_CASE_ID"
  | "MISSING_QUESTION"
  | "MISSING_TURNS"
  | "TOO_MANY_CASES"
  | "RESULT_VERSION_MISMATCH"
  | "RESULT_REQUIRED_FIELD"
  | "RESULT_INVALID_STATUS"
  | "RESULT_INVALID_TIMESTAMP"
  | "RESULT_EMPTY"
  | "RESULT_DUPLICATE_CASE_ID"
  | "RESULT_SUITE_ID_SUSPICIOUS";

export type SuiteSchemaError = {
  code: SuiteSchemaErrorCode;
  /** JSON-pointer-ish path, e.g. `cases[3].id`. Empty for top-level errors. */
  path: string;
  message: string;
};

export const SAFE_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const SAFE_DOMAIN_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const SAFE_CASE_ID_MAX = 200;
export const MAX_CASES_PER_IMPORT = 500;
export const MAX_SUITE_BYTES = 2 * 1024 * 1024; // 2 MB per spec §10
export const MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const MAX_CASE_TEXT_BYTES = 32 * 1024;

function err(code: SuiteSchemaErrorCode, path: string, message: string): SuiteSchemaError {
  return { code, path, message };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── safe id / domain checks ──────────────────────────────────────────────────

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= SAFE_CASE_ID_MAX && SAFE_ID_REGEX.test(id);
}

export function isSafeDomain(domain: unknown): domain is string {
  return typeof domain === "string" && domain.length > 0 && SAFE_DOMAIN_REGEX.test(domain);
}

// Reject path traversal and shell-meaningful characters even if they pass isSafeId.
export function assertSafeId(id: unknown, path: string, errors: SuiteSchemaError[]): asserts id is string {
  if (typeof id !== "string") {
    errors.push(err("REQUIRED_FIELD_MISSING", path, `${path} must be a string`));
    return;
  }
  if (id.length === 0) {
    errors.push(err("REQUIRED_FIELD_MISSING", path, `${path} is required and must be non-empty`));
    return;
  }
  if (!isSafeId(id)) {
    errors.push(
      err(
        "INVALID_SAFE_ID",
        path,
        `${path} "${id}" must match ${SAFE_ID_REGEX.toString()} (lowercase ASCII letters / digits / _ / -; must start with letter or digit)`
      )
    );
  }
}

// ─── canonical parse ──────────────────────────────────────────────────────────

export type ParseEvalSuiteResult =
  | { ok: true; suite: EvalSuite }
  | { ok: false; errors: SuiteSchemaError[] };

const VALID_CASE_TYPES = new Set<EvalSuiteCase["case_type"]>(["single_turn", "multi_turn"]);
const VALID_EXPECTED_SOURCES = new Set<NonNullable<EvalSuiteCase["expected_source"]>>([
  "semantic_layer",
  "raw_sql_fallback",
  "manual_debug_only"
]);

export function parseEvalSuite(text: string): ParseEvalSuiteResult {
  const errors: SuiteSchemaError[] = [];

  if (text.length >= MAX_SUITE_BYTES) {
    errors.push(
      err(
        "INVALID_YAML",
        "",
        `Suite YAML exceeds ${MAX_SUITE_BYTES} bytes (spec §10 limit). Use a smaller suite or split.`
      )
    );
    return { ok: false, errors };
  }

  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    errors.push(err("INVALID_YAML", "", `YAML parse error: ${doc.errors[0].message}`));
    return { ok: false, errors };
  }
  const root = doc.toJSON();
  if (!isPlainObject(root)) {
    errors.push(err("INVALID_YAML", "", "Suite root must be a mapping"));
    return { ok: false, errors };
  }

  // lucy_eval_schema_version
  const schemaVersion = root.lucy_eval_schema_version;
  if (schemaVersion === undefined || schemaVersion === null) {
    errors.push(err("REQUIRED_FIELD_MISSING", "lucy_eval_schema_version", "lucy_eval_schema_version is required"));
  } else if (schemaVersion !== EVAL_SUITE_SCHEMA_VERSION) {
    errors.push(
      err(
        "SCHEMA_VERSION_MISMATCH",
        "lucy_eval_schema_version",
        `lucy_eval_schema_version must be ${EVAL_SUITE_SCHEMA_VERSION} (got ${JSON.stringify(schemaVersion)})`
      )
    );
  }

  // kind
  const kind = root.kind;
  if (kind === undefined || kind === null) {
    errors.push(err("REQUIRED_FIELD_MISSING", "kind", "kind is required"));
  } else if (kind !== EVAL_SUITE_KIND) {
    errors.push(
      err(
        "KIND_MISMATCH",
        "kind",
        `kind must be ${JSON.stringify(EVAL_SUITE_KIND)} (got ${JSON.stringify(kind)})`
      )
    );
  }

  // suite_id
  const suiteId = root.suite_id;
  if (typeof suiteId !== "string" || suiteId.length === 0) {
    errors.push(err("REQUIRED_FIELD_MISSING", "suite_id", "suite_id is required"));
  } else if (!isSafeId(suiteId)) {
    errors.push(
      err(
        "INVALID_SAFE_ID",
        "suite_id",
        `suite_id "${suiteId}" must match ${SAFE_ID_REGEX.toString()}`
      )
    );
  }

  // domain
  const domain = root.domain;
  if (typeof domain !== "string" || domain.length === 0) {
    errors.push(err("REQUIRED_FIELD_MISSING", "domain", "domain is required"));
  } else if (!isSafeDomain(domain)) {
    errors.push(
      err(
        "INVALID_SAFE_ID",
        "domain",
        `domain "${domain}" must match ${SAFE_DOMAIN_REGEX.toString()} (used as filesystem path segment)`
      )
    );
  }

  // title
  const title = root.title;
  if (typeof title !== "string" || title.length === 0) {
    errors.push(err("REQUIRED_FIELD_MISSING", "title", "title is required"));
  }

  // cases
  const casesNode = root.cases;
  if (!Array.isArray(casesNode)) {
    errors.push(err("REQUIRED_FIELD_MISSING", "cases", "cases must be an array"));
  } else if (casesNode.length === 0) {
    errors.push(err("REQUIRED_FIELD_MISSING", "cases", "cases must contain at least one case"));
  } else if (casesNode.length > MAX_CASES_PER_IMPORT) {
    errors.push(
      err(
        "TOO_MANY_CASES",
        "cases",
        `cases[] contains ${casesNode.length} entries; MVP limit is ${MAX_CASES_PER_IMPORT}`
      )
    );
  } else {
    const seenIds = new Set<string>();
    casesNode.forEach((rawCase, idx) => {
      const casePath = `cases[${idx}]`;
      if (!isPlainObject(rawCase)) {
        errors.push(err("INVALID_FIELD_TYPE", casePath, `${casePath} must be a mapping`));
        return;
      }
      const caseId = rawCase.id;
      assertSafeId(caseId, `${casePath}.id`, errors);
      if (typeof caseId === "string" && isSafeId(caseId)) {
        if (seenIds.has(caseId)) {
          errors.push(err("DUPLICATE_CASE_ID", `${casePath}.id`, `duplicate case id "${caseId}"`));
        } else {
          seenIds.add(caseId);
        }
      }
      const caseType = rawCase.case_type;
      if (typeof caseType !== "string" || !VALID_CASE_TYPES.has(caseType as EvalSuiteCase["case_type"])) {
        errors.push(
          err(
            "INVALID_CASE_TYPE",
            `${casePath}.case_type`,
            `${casePath}.case_type must be one of ${Array.from(VALID_CASE_TYPES).join(", ")}`
          )
        );
      }
      const expectedSource = rawCase.expected_source;
      if (typeof expectedSource !== "string" || !VALID_EXPECTED_SOURCES.has(expectedSource as NonNullable<EvalSuiteCase["expected_source"]>)) {
        errors.push(
          err(
            "INVALID_EXPECTED_SOURCE",
            `${casePath}.expected_source`,
            `${casePath}.expected_source must be one of ${Array.from(VALID_EXPECTED_SOURCES).join(", ")}`
          )
        );
      }
      if (caseType === "single_turn") {
        const question = rawCase.question;
        if (typeof question !== "string" || question.length === 0) {
          errors.push(
            err(
              "MISSING_QUESTION",
              `${casePath}.question`,
              `${casePath}.question is required for single_turn case`
            )
          );
        }
      } else if (caseType === "multi_turn") {
        const turns = rawCase.turns;
        if (!Array.isArray(turns) || turns.length === 0) {
          errors.push(
            err(
              "MISSING_TURNS",
              `${casePath}.turns`,
              `${casePath}.turns must be a non-empty array for multi_turn case`
            )
          );
        }
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Re-parse the document so we preserve raw scalars and unevaluated tags.
  // yaml's parseDocument preserves comments / ordering for round-trip; we only need
  // canonical JSON for hashing and a structured EvalSuite for the caller.
  const suite: EvalSuite = {
    lucy_eval_schema_version: EVAL_SUITE_SCHEMA_VERSION,
    kind: EVAL_SUITE_KIND,
    suite_id: root.suite_id as string,
    domain: root.domain as string,
    title: root.title as string,
    snapshot: isPlainObject(root.snapshot) ? (root.snapshot as EvalSuite["snapshot"]) : undefined,
    runner_hints: isPlainObject(root.runner_hints) ? (root.runner_hints as EvalSuite["runner_hints"]) : undefined,
    cases: casesNode as EvalSuiteCase[]
  };
  return { ok: true, suite };
}

// ─── legacy read (existing evals/<domain>/eval/<domain>-eval-cases.yaml) ────

export type LegacyParseResult = {
  cases: EvalSuiteCase[];
  metadata?: Record<string, unknown>;
  errors: SuiteSchemaError[];
};

export function parseLegacyEvalCases(text: string): LegacyParseResult {
  const errors: SuiteSchemaError[] = [];
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    errors.push(err("INVALID_YAML", "", `YAML parse error: ${doc.errors[0].message}`));
    return { cases: [], errors };
  }
  const root = doc.toJSON();
  if (!isPlainObject(root)) {
    errors.push(err("INVALID_YAML", "", "Legacy eval file root must be a mapping"));
    return { cases: [], errors };
  }
  const rawCases = root.cases;
  if (!Array.isArray(rawCases)) {
    errors.push(err("REQUIRED_FIELD_MISSING", "cases", "legacy file missing `cases` array"));
    return { cases: [], errors };
  }

  const seenIds = new Set<string>();
  const cases: EvalSuiteCase[] = [];
  rawCases.forEach((rawCase, idx) => {
    const path = `cases[${idx}]`;
    if (!isPlainObject(rawCase)) {
      errors.push(err("INVALID_FIELD_TYPE", path, `${path} must be a mapping`));
      return;
    }
    const caseId = rawCase.id;
    if (!isSafeId(caseId)) {
      errors.push(err("INVALID_SAFE_ID", `${path}.id`, `legacy case id "${String(caseId)}" must be a safe id`));
    } else if (seenIds.has(caseId)) {
      errors.push(err("DUPLICATE_CASE_ID", `${path}.id`, `duplicate legacy case id "${caseId}"`));
    } else {
      seenIds.add(caseId);
    }
    cases.push(rawCase as unknown as EvalSuiteCase);
  });

  return {
    cases,
    metadata: isPlainObject(root.metadata) ? (root.metadata as Record<string, unknown>) : undefined,
    errors
  };
}

export function classifyEvalYaml(text: string): "canonical" | "legacy" | "unknown" {
  // Cheap sniff: peek at the first non-blank lines to detect schema version.
  // We deliberately do NOT use parseDocument here because classify is hot and
  // needs to handle partially malformed input without throwing.
  const firstLines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(0, 12);
  const hasSchema = firstLines.some((l) => /^lucy_eval_schema_version:\s*\S+/.test(l));
  const hasKind = firstLines.some((l) => /^kind:\s*lucy_eval_suite\b/.test(l));
  if (hasSchema && hasKind) {
    return "canonical";
  }
  if (firstLines.some((l) => /^cases:\s*$/.test(l))) {
    return "legacy";
  }
  // Fallback: try canonical parse; if it has a kind but no schema_version, treat as legacy.
  try {
    const doc = parseDocument(text);
    if (!doc.errors.length) {
      const json = doc.toJSON();
      if (isPlainObject(json) && json.lucy_eval_schema_version === undefined && Array.isArray(json.cases)) {
        return "legacy";
      }
    }
  } catch {
    // ignore
  }
  return "unknown";
}

// ─── canonicalize + hash ──────────────────────────────────────────────────────

const HASH_IGNORED_TOP_KEYS = new Set(["suite_hash"]);

/**
 * Produces a deterministic JSON-shaped object suitable for sha256.
 * The output:
 *  - excludes `suite_hash` (which is the result of hashing itself)
 *  - sorts object keys recursively in lexicographic order
 *  - serializes with stable separators (no extra whitespace)
 * Hashing the canonical JSON ensures two semantically equivalent suites (e.g.
 * one with comments, different key ordering, or whitespace differences) produce
 * the same suite_hash.
 */
export function canonicalizeSuite(suite: EvalSuite): unknown {
  return canonicalizeInner(suite);
}

function canonicalizeInner(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalizeInner);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj)
      .filter((k) => !HASH_IGNORED_TOP_KEYS.has(k) || k !== "suite_hash" || Object.keys(obj).length === 1)
      .sort();
    for (const k of keys) {
      if (k === "suite_hash") continue; // always exclude self
      sorted[k] = canonicalizeInner(obj[k]);
    }
    return sorted;
  }
  return value;
}

export function computeSuiteHash(suite: EvalSuite): string {
  const canonical = canonicalizeSuite(suite);
  const json = JSON.stringify(canonical);
  const digest = createHash("sha256").update(json, "utf8").digest("hex");
  return `sha256:${digest}`;
}

// ─── Result JSON (M43 §6) ─────────────────────────────────────────────────────

const VALID_RESULT_STATUSES = new Set(["PASS", "FAIL", "SKIPPED", "ERROR"]);

export type ParseEvalResultResult =
  | { ok: true; result: EvalResultImport }
  | { ok: false; errors: SuiteSchemaError[] };

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseEvalResultImport(text: string): ParseEvalResultResult {
  const errors: SuiteSchemaError[] = [];

  if (text.length > MAX_RESULT_BYTES) {
    errors.push(err("INVALID_YAML", "", `Result JSON exceeds ${MAX_RESULT_BYTES} bytes`));
    return { ok: false, errors };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    errors.push(err("INVALID_YAML", "", `Result JSON parse error: ${(e as Error).message}`));
    return { ok: false, errors };
  }

  if (!isPlainObject(json)) {
    errors.push(err("INVALID_YAML", "", "Result JSON root must be a mapping"));
    return { ok: false, errors };
  }

  const version = json.lucy_eval_result_version;
  if (version !== EVAL_RESULT_VERSION) {
    errors.push(
      err(
        "RESULT_VERSION_MISMATCH",
        "lucy_eval_result_version",
        `lucy_eval_result_version must be ${EVAL_RESULT_VERSION} (got ${JSON.stringify(version)})`
      )
    );
  }

  for (const required of ["suite_id", "suite_hash", "domain", "runner", "started_at", "finished_at", "results"] as const) {
    if (json[required] === undefined || json[required] === null) {
      errors.push(err("RESULT_REQUIRED_FIELD", required, `${required} is required`));
    }
  }

  const suiteId = json.suite_id;
  if (typeof suiteId === "string" && !isSafeId(suiteId)) {
    errors.push(
      err(
        "RESULT_SUITE_ID_SUSPICIOUS",
        "suite_id",
        `suite_id "${suiteId}" must match ${SAFE_ID_REGEX.toString()}`
      )
    );
  }

  const suiteHash = json.suite_hash;
  if (typeof suiteHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(suiteHash)) {
    errors.push(
      err(
        "RESULT_REQUIRED_FIELD",
        "suite_hash",
        `suite_hash must match /^sha256:[a-f0-9]{64}$/ (got ${JSON.stringify(suiteHash)})`
      )
    );
  }

  for (const ts of ["started_at", "finished_at"] as const) {
    const value = json[ts];
    if (typeof value === "string" && !ISO_8601_RE.test(value)) {
      errors.push(err("RESULT_INVALID_TIMESTAMP", ts, `${ts} must be ISO 8601 (got ${JSON.stringify(value)})`));
    }
  }

  const runner = json.runner;
  if (!isPlainObject(runner) || typeof runner.kind !== "string" || runner.kind.length === 0) {
    errors.push(err("RESULT_REQUIRED_FIELD", "runner", "runner.kind is required and must be a non-empty string"));
  }

  const results = json.results;
  if (!Array.isArray(results)) {
    errors.push(err("RESULT_REQUIRED_FIELD", "results", "results must be an array"));
  } else if (results.length === 0) {
    errors.push(err("RESULT_EMPTY", "results", "results must contain at least one entry"));
  } else {
    const seenIds = new Set<string>();
    results.forEach((entry, idx) => {
      const path = `results[${idx}]`;
      if (!isPlainObject(entry)) {
        errors.push(err("INVALID_FIELD_TYPE", path, `${path} must be a mapping`));
        return;
      }
      const caseId = entry.case_id;
      if (typeof caseId !== "string" || !isSafeId(caseId)) {
        errors.push(err("RESULT_REQUIRED_FIELD", `${path}.case_id`, `${path}.case_id must be a safe id`));
      } else if (seenIds.has(caseId)) {
        errors.push(err("RESULT_DUPLICATE_CASE_ID", `${path}.case_id`, `duplicate case_id "${caseId}"`));
      } else {
        seenIds.add(caseId);
      }
      const status = entry.status;
      if (typeof status !== "string" || !VALID_RESULT_STATUSES.has(status)) {
        errors.push(
          err(
            "RESULT_INVALID_STATUS",
            `${path}.status`,
            `${path}.status must be one of ${Array.from(VALID_RESULT_STATUSES).join(", ")}`
          )
        );
      }
      if ((status === "FAIL" || status === "ERROR") && !Array.isArray(entry.failures) && typeof entry.error_message !== "string") {
        errors.push(
          err(
            "RESULT_REQUIRED_FIELD",
            `${path}.failures`,
            `${path}.failures[] or error_message is required for status=${status}`
          )
        );
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, result: json as EvalResultImport };
}

// ─── export internal helpers for tests ───────────────────────────────────────

export const __testing = {
  ISO_8601_RE,
  VALID_CASE_TYPES,
  VALID_EXPECTED_SOURCES,
  VALID_RESULT_STATUSES,
  HASH_IGNORED_TOP_KEYS
};

// suppress unused-import warnings when the yaml helpers aren't otherwise consumed.
void isMap;
void isSeq;