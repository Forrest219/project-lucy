import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { stringify } from "yaml";
import { previewDiff } from "../diff.js";
import { assertReadable, safeWrite } from "../fs-safe.js";
import { resolveProjectRoot } from "../project.js";
import { getEvalDb } from "./db.js";
import type { EvalResultCase, EvalResultImport, EvalSuite, EvalSuiteCase } from "../../src/lib/types.js";
import {
  EVAL_SUITE_KIND,
  EVAL_SUITE_SCHEMA_VERSION
} from "../../src/lib/types.js";
import {
  classifyEvalYaml,
  computeSuiteHash,
  isSafeDomain,
  isSafeId,
  parseEvalSuite,
  parseEvalResultImport,
  parseLegacyEvalCases,
  type SuiteSchemaError
} from "./suite-schema.js";

type SuiteImportFormat = "canonical_v1" | "legacy_migration";

type SuiteImportResponse = {
  domain: string;
  suiteId: string;
  suiteHash: string;
  caseCount: number;
  format: SuiteImportFormat;
  warnings: string[];
  errors: SuiteSchemaError[];
  diff: string;
  proposedYaml: string;
  written?: true;
};

type SuiteImportBody = {
  dryRun?: boolean;
  filename?: string;
  content?: string;
};

type ResultImportBody = {
  dryRun?: boolean;
  content?: string;
  archiveLocalVariant?: boolean;
};

type ResultImportResponse = {
  runId?: number;
  domain: string;
  suiteId: string;
  suiteHash: string;
  currentSuiteHash: string;
  totalCases: number;
  passCount: number;
  failCount: number;
  skippedCount: number;
  errorCount: number;
  suiteHashMatched: boolean;
  hashStatus: "matched" | "mismatch";
  unknownCaseIds: string[];
  warnings: string[];
  written?: true;
};

function validationError(reply: FastifyReply, errors: SuiteSchemaError[], message = "Eval YAML validation failed") {
  return reply.status(422).send({
    ok: false,
    error: {
      code: "EVAL_SUITE_SCHEMA_INVALID",
      message,
      detail: { errors }
    }
  });
}

function sensitiveFieldError(content: string, path = "content"): SuiteSchemaError | null {
  const matched = content.match(/(^|\n)\s*["']?(password|token|secret|api_key|authorization)["']?\s*[:=]/i);
  if (!matched) return null;
  return {
    code: "SENSITIVE_FIELD_DETECTED",
    path,
    message: `Sensitive field "${matched[2]}" is not allowed in Eval YAML or Result JSON`
  };
}

export function casesRelPath(domain: string): string {
  if (!isSafeDomain(domain)) {
    throw Object.assign(new Error(`Invalid domain: ${domain}`), {
      code: "INVALID_SAFE_ID",
      statusCode: 422
    });
  }
  return `evals/${domain}/eval/${domain}-eval-cases.yaml`;
}

function domainFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const base = path.basename(filename).replace(/\.(ya?ml)$/i, "");
  const candidate = base
    .replace(/-eval-cases$/i, "")
    .replace(/-eval-suite$/i, "")
    .replace(/_eval_cases$/i, "")
    .replace(/_eval_suite$/i, "");
  return isSafeDomain(candidate) ? candidate : undefined;
}

function expectedSourceFromMetadata(metadata?: Record<string, unknown>): EvalSuiteCase["expected_source"] {
  const value = metadata?.data_source;
  if (value === "semantic_layer" || value === "raw_sql_fallback" || value === "manual_debug_only") {
    return value;
  }
  return "manual_debug_only";
}

function suiteTitle(domain: string, metadata?: Record<string, unknown>): string {
  const documentName = metadata?.document_name;
  return typeof documentName === "string" && documentName.trim().length > 0
    ? documentName
    : `${domain} Eval Suite`;
}

function domainFromLegacy(cases: EvalSuiteCase[], filename?: string): string | undefined {
  const caseDomains = new Set(
    cases
      .map((c) => (c as EvalSuiteCase & { domain?: unknown }).domain)
      .filter((d): d is string => typeof d === "string" && isSafeDomain(d))
  );
  if (caseDomains.size === 1) return [...caseDomains][0];
  return domainFromFilename(filename);
}

function normalizeLegacyCase(
  rawCase: EvalSuiteCase,
  defaultExpectedSource: EvalSuiteCase["expected_source"]
): EvalSuiteCase {
  const record = { ...(rawCase as unknown as Record<string, unknown>) };
  delete record.domain;

  const expectedSource = record.expected_source;
  const caseType = record.case_type;
  return {
    ...record,
    case_type: caseType === "multi_turn" ? "multi_turn" : "single_turn",
    expected_source:
      expectedSource === "semantic_layer" ||
      expectedSource === "raw_sql_fallback" ||
      expectedSource === "manual_debug_only"
        ? expectedSource
        : defaultExpectedSource
  } as EvalSuiteCase;
}

function suiteFromLegacy(text: string, filename?: string): { suite?: EvalSuite; errors: SuiteSchemaError[]; warnings: string[] } {
  const parsed = parseLegacyEvalCases(text);
  if (parsed.errors.length > 0) {
    return { errors: parsed.errors, warnings: [] };
  }

  const domain = domainFromLegacy(parsed.cases, filename);
  if (!domain) {
    return {
      errors: [
        {
          code: "INVALID_SAFE_ID",
          path: "domain",
          message: "Unable to infer a safe domain from legacy case domains or filename"
        }
      ],
      warnings: []
    };
  }

  const defaultExpectedSource = expectedSourceFromMetadata(parsed.metadata);
  const suite: EvalSuite = {
    lucy_eval_schema_version: EVAL_SUITE_SCHEMA_VERSION,
    kind: EVAL_SUITE_KIND,
    suite_id: `${domain}_v1`,
    domain,
    title: suiteTitle(domain, parsed.metadata),
    snapshot:
      typeof parsed.metadata?.snapshot_date === "string"
        ? { mode: "live_readonly", snapshot_date: parsed.metadata.snapshot_date }
        : undefined,
    runner_hints: { supported_runners: ["claude_code", "hermes"] },
    cases: parsed.cases.map((c) => normalizeLegacyCase(c, defaultExpectedSource))
  };

  const canonical = finalizeSuite(suite);
  const validation = parseEvalSuite(stringify(canonical, { lineWidth: 0 }));
  if (!validation.ok) {
    return { errors: validation.errors, warnings: [] };
  }

  return {
    suite: canonical,
    errors: [],
    warnings: ["legacy Eval YAML migrated to canonical Lucy Eval Suite v1 preview"]
  };
}

export function finalizeSuite(suite: EvalSuite): EvalSuite {
  const withoutHash: EvalSuite = { ...suite };
  delete withoutHash.suite_hash;
  const suiteHash = computeSuiteHash(withoutHash);
  return { ...withoutHash, suite_hash: suiteHash };
}

export function suiteToYaml(suite: EvalSuite): string {
  return stringify(suite, { lineWidth: 0 });
}

async function readExisting(projectRoot: string, relPath: string): Promise<string> {
  try {
    const absPath = await assertReadable(projectRoot, relPath);
    return await readFile(absPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function parseImportContent(content: string, filename?: string): {
  suite?: EvalSuite;
  format?: SuiteImportFormat;
  warnings: string[];
  errors: SuiteSchemaError[];
} {
  const kind = classifyEvalYaml(content);
  if (kind === "canonical") {
    const parsed = parseEvalSuite(content);
    if (!parsed.ok) return { warnings: [], errors: parsed.errors };
    return {
      suite: finalizeSuite(parsed.suite),
      format: "canonical_v1",
      warnings: [],
      errors: []
    };
  }

  if (kind === "legacy") {
    const migrated = suiteFromLegacy(content, filename);
    return {
      suite: migrated.suite,
      format: "legacy_migration",
      warnings: migrated.warnings,
      errors: migrated.errors
    };
  }

  const parsed = parseEvalSuite(content);
  if (!parsed.ok) return { warnings: [], errors: parsed.errors };
  return {
    suite: finalizeSuite(parsed.suite),
    format: "canonical_v1",
    warnings: [],
    errors: []
  };
}

export async function readCurrentEvalSuite(projectRoot: string, domain: string): Promise<EvalSuite> {
  const relPath = casesRelPath(domain);
  const absPath = await assertReadable(projectRoot, relPath);
  const content = await readFile(absPath, "utf8");
  const parsed = parseImportContent(content, `${domain}-eval-cases.yaml`);
  if (!parsed.suite || parsed.errors.length > 0) {
    const error = new Error("Current Eval YAML is not a valid Lucy Eval Suite") as Error & { errors: SuiteSchemaError[] };
    error.errors = parsed.errors;
    throw error;
  }
  return parsed.suite;
}

export async function importEvalSuite(
  projectRoot: string,
  input: { filename?: string; content: string; dryRun?: boolean }
): Promise<SuiteImportResponse> {
  const sensitive = sensitiveFieldError(input.content);
  if (sensitive) {
    const error = new Error("Eval YAML contains sensitive fields") as Error & { errors: SuiteSchemaError[] };
    error.errors = [sensitive];
    throw error;
  }

  const parsed = parseImportContent(input.content, input.filename);
  if (!parsed.suite || !parsed.format || parsed.errors.length > 0) {
    const error = new Error("Eval YAML validation failed") as Error & { errors: SuiteSchemaError[] };
    error.errors = parsed.errors;
    throw error;
  }

  const suite = parsed.suite;
  const relPath = casesRelPath(suite.domain);
  const proposedYaml = suiteToYaml(suite);
  const existing = await readExisting(projectRoot, relPath);
  const diff = previewDiff(existing, proposedYaml, relPath);

  if (input.dryRun === false) {
    await safeWrite(projectRoot, relPath, proposedYaml);
  }

  return {
    domain: suite.domain,
    suiteId: suite.suite_id,
    suiteHash: suite.suite_hash ?? computeSuiteHash(suite),
    caseCount: suite.cases.length,
    format: parsed.format,
    warnings: parsed.warnings,
    errors: [],
    diff,
    proposedYaml,
    written: input.dryRun === false ? true : undefined
  };
}

export async function downloadEvalSuiteYaml(projectRoot: string, domain: string): Promise<{ suite: EvalSuite; yaml: string; runnerCommand: string }> {
  const suite = await readCurrentEvalSuite(projectRoot, domain);
  return {
    suite,
    yaml: suiteToYaml(suite),
    runnerCommand: `node scripts/lucy-eval-runner.mjs --suite ${domain}-eval-suite.yaml --output result.json`
  };
}

function jsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function resultDrift(status: EvalResultCase["status"]): string {
  if (status === "PASS") return "pass";
  if (status === "FAIL") return "data_drift";
  return "tool_error";
}

function resultError(result: EvalResultCase): string | null {
  if (result.error_message) return result.error_message;
  if (Array.isArray(result.failures) && result.failures.length > 0) return result.failures[0];
  return null;
}

function summarizeResult(result: EvalResultImport) {
  return {
    totalCases: result.results.length,
    passCount: result.results.filter((r) => r.status === "PASS").length,
    failCount: result.results.filter((r) => r.status === "FAIL").length,
    skippedCount: result.results.filter((r) => r.status === "SKIPPED").length,
    errorCount: result.results.filter((r) => r.status === "ERROR").length
  };
}

export async function importEvalResult(
  projectRoot: string,
  input: { content: string; dryRun?: boolean; archiveLocalVariant?: boolean }
): Promise<ResultImportResponse> {
  const sensitive = sensitiveFieldError(input.content);
  if (sensitive) {
    const error = new Error("Result JSON contains sensitive fields") as Error & { errors: SuiteSchemaError[] };
    error.errors = [sensitive];
    throw error;
  }

  const parsed = parseEvalResultImport(input.content);
  if (!parsed.ok) {
    const error = new Error("Result JSON validation failed") as Error & { errors: SuiteSchemaError[] };
    error.errors = parsed.errors;
    throw error;
  }

  const result = parsed.result;
  const currentSuite = await readCurrentEvalSuite(projectRoot, result.domain);
  if (currentSuite.suite_id !== result.suite_id) {
    const error = new Error("Result JSON suite_id does not match current Eval YAML") as Error & { errors: SuiteSchemaError[] };
    error.errors = [{
      code: "RESULT_SUITE_ID_SUSPICIOUS",
      path: "suite_id",
      message: `suite_id "${result.suite_id}" does not match current suite "${currentSuite.suite_id}"`
    }];
    throw error;
  }

  const knownCaseIds = new Set(currentSuite.cases.map((c) => c.id));
  const unknownCaseIds = result.results.map((r) => r.case_id).filter((id) => !knownCaseIds.has(id));
  if (unknownCaseIds.length > 0) {
    const error = new Error("Result JSON contains unknown case ids") as Error & { errors: SuiteSchemaError[] };
    error.errors = unknownCaseIds.map((id) => ({
      code: "RESULT_REQUIRED_FIELD",
      path: "results[].case_id",
      message: `case_id "${id}" does not exist in current Eval YAML`
    }));
    throw error;
  }

  const hashStatus = currentSuite.suite_hash === result.suite_hash ? "matched" : "mismatch";
  const warnings = hashStatus === "mismatch"
    ? ["suite_hash mismatch: result will be archived as a local variant and excluded from trend / quality gate by default"]
    : [];
  const summary = summarizeResult(result);

  if (input.dryRun !== false) {
    return {
      domain: result.domain,
      suiteId: result.suite_id,
      suiteHash: result.suite_hash,
      currentSuiteHash: currentSuite.suite_hash ?? computeSuiteHash(currentSuite),
      ...summary,
      suiteHashMatched: hashStatus === "matched",
      hashStatus,
      unknownCaseIds: [],
      warnings
    };
  }

  if (hashStatus === "mismatch" && input.archiveLocalVariant !== true) {
    const error = new Error("suite_hash mismatch requires archiveLocalVariant=true") as Error & { errors: SuiteSchemaError[]; statusCode?: number; code?: string };
    error.statusCode = 409;
    error.code = "EVAL_RESULT_HASH_MISMATCH";
    error.errors = [{
      code: "RESULT_REQUIRED_FIELD",
      path: "suite_hash",
      message: "suite_hash mismatch requires archiveLocalVariant=true to archive as local variant"
    }];
    throw error;
  }

  const db = await getEvalDb();
  const startedAt = result.started_at;
  const finishedAt = result.finished_at;
  const insert = db.prepare(`
    INSERT INTO eval_run (
      domain, started_at, finished_at, status, triggered_by, trigger, trigger_reason, ktx_mcp_url,
      case_selection, total_cases, pass_count, fail_count, suite_id, suite_hash, runner_metadata_raw,
      import_source, hash_status
    )
    VALUES (?, ?, ?, 'succeeded', ?, 'imported_result', ?, '', ?, ?, ?, ?, ?, ?, ?, 'local_runner_import', ?)
  `).run(
    result.domain,
    startedAt,
    finishedAt,
    result.runner.kind,
    hashStatus === "mismatch" ? "local_variant hash mismatch" : "local_runner import",
    JSON.stringify({ mode: "all" }),
    summary.totalCases,
    summary.passCount,
    summary.failCount,
    result.suite_id,
    result.suite_hash,
    JSON.stringify(result.runner),
    hashStatus
  );
  const runId = insert.lastInsertRowid as number;

  const evalRunsDir = path.join(projectRoot, ".ktx-ui", "eval", "runs");
  await mkdir(evalRunsDir, { recursive: true });
  const jsonRelPath = `.ktx-ui/eval/runs/${runId}.json`;
  await writeFile(path.join(projectRoot, jsonRelPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  db.prepare("UPDATE eval_run SET json_path = ? WHERE id = ?").run(jsonRelPath, runId);

  const insertCase = db.prepare(`
    INSERT INTO eval_run_case (
      run_id, case_id, status, drift, duration_ms, sql, result_raw, expected_raw, actual_raw,
      failed_assertions, error_message, final_text
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((results: EvalResultCase[]) => {
    for (const row of results) {
      insertCase.run(
        runId,
        row.case_id,
        row.status,
        resultDrift(row.status),
        row.duration_ms ?? null,
        row.sql ?? null,
        jsonText(row),
        jsonText(row.expected),
        jsonText(row.actual),
        Array.isArray(row.failures) ? JSON.stringify(row.failures) : null,
        resultError(row),
        row.final_text ?? null
      );
    }
  });
  tx(result.results);

  return {
    runId,
    domain: result.domain,
    suiteId: result.suite_id,
    suiteHash: result.suite_hash,
    currentSuiteHash: currentSuite.suite_hash ?? computeSuiteHash(currentSuite),
    ...summary,
    suiteHashMatched: hashStatus === "matched",
    hashStatus,
    unknownCaseIds: [],
    warnings,
    written: true
  };
}

export function registerSuiteImportRoutes(app: FastifyInstance) {
  app.post<{ Body: SuiteImportBody }>("/api/eval/suites/import", async (request, reply) => {
    const content = request.body?.content;
    if (typeof content !== "string" || content.length === 0) {
      return validationError(reply, [
        {
          code: "REQUIRED_FIELD_MISSING",
          path: "content",
          message: "content is required and must be a non-empty string"
        }
      ]);
    }
    const filename = typeof request.body.filename === "string" ? request.body.filename : undefined;
    const dryRun = request.body.dryRun !== false;
    const projectRoot = await resolveProjectRoot();

    try {
      const result = await importEvalSuite(projectRoot, { filename, content, dryRun });
      return reply.status(dryRun ? 200 : 201).send({ ok: true, data: result });
    } catch (error) {
      const errors = (error as Error & { errors?: SuiteSchemaError[] }).errors;
      if (errors) {
        return validationError(reply, errors);
      }
      throw error;
    }
  });

  app.get<{ Params: { domain: string } }>("/api/eval/suites/:domain/download", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { suite, yaml, runnerCommand } = await downloadEvalSuiteYaml(projectRoot, request.params.domain);
    reply
      .header("Content-Type", "text/yaml; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${suite.domain}-eval-suite.yaml"`)
      .header("X-Lucy-Suite-Id", suite.suite_id)
      .header("X-Lucy-Suite-Hash", suite.suite_hash ?? computeSuiteHash(suite))
      .header("X-Lucy-Runner-Command", runnerCommand);
    return reply.send(yaml);
  });

  app.post<{ Body: ResultImportBody }>("/api/eval/results/import", async (request, reply) => {
    const content = request.body?.content;
    if (typeof content !== "string" || content.length === 0) {
      return validationError(reply, [
        {
          code: "RESULT_REQUIRED_FIELD",
          path: "content",
          message: "content is required and must be a non-empty Result JSON string"
        }
      ], "Result JSON validation failed");
    }
    const projectRoot = await resolveProjectRoot();
    const dryRun = request.body.dryRun !== false;
    try {
      const result = await importEvalResult(projectRoot, {
        content,
        dryRun,
        archiveLocalVariant: request.body.archiveLocalVariant === true
      });
      return reply.status(dryRun ? 200 : 201).send({ ok: true, data: result });
    } catch (error) {
      const errors = (error as Error & { errors?: SuiteSchemaError[] }).errors;
      if (errors) {
        const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 422;
        return reply.status(statusCode).send({
          ok: false,
          error: {
            code: (error as Error & { code?: string }).code ?? "EVAL_RESULT_SCHEMA_INVALID",
            message: error instanceof Error ? error.message : "Result JSON validation failed",
            detail: { errors }
          }
        });
      }
      throw error;
    }
  });
}
