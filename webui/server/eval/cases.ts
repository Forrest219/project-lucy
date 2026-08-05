import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseDocument, Document, isSeq, isMap } from "yaml";
import { assertReadable, safeWrite } from "../fs-safe.js";
import { previewDiff } from "../diff.js";
import { resolveProjectRoot } from "../project.js";
import type { FastifyInstance } from "fastify";
import { getEvalDb } from "./db.js";
import { auditedWriteFile } from "../admin/config-audit-write.js";

// ─── types ──────────────────────────────────────────────────────────────────

export type SqlAssertion = {
  type: "measure_lineage" | "required_ast" | "forbidden_ast" | "required_sql_pattern";
  value: string;
  normalize?: boolean;
  reason: string;
};

export type ResultAssertion = {
  value_type: "scalar" | "dataframe" | "text" | "empty_result";
  compare_mode?: string;
  data?: unknown;
  numeric_tolerance?: number;
  check_schema?: boolean;
  check_row_count?: boolean;
  key_columns?: string[];
};

export type EvalCase = {
  id: string;
  case_type: string;
  question?: string;
  turns?: unknown[];
  domain: string;
  skill_version?: string;
  semantic_version?: string;
  model_id?: string;
  expected_source?: string;
  expected_measures?: string[];
  linked_quiz_questions?: string[];
  sql_assertions?: SqlAssertion[];
  result_assertions?: ResultAssertion[];
  context_assertions?: unknown;
  snapshot_date?: string;
  coverage?: string;
  notes?: string;
};

export type EvalDomainInfo = {
  domain: string;
  filePath: string;
  caseCount: number;
  metadata?: Record<string, unknown>;
  lastRun?: {
    runId: number;
    passRate: number;
    startedAt: string;
  };
};

// ─── error classes ──────────────────────────────────────────────────────────

export class CaseNotFoundError extends Error {
  code = "CASE_NOT_FOUND";
  statusCode = 404;
  constructor(msg: string) {
    super(msg);
    this.name = "CaseNotFoundError";
  }
}

export class CaseIdTakenError extends Error {
  code = "CASE_ID_TAKEN";
  statusCode = 409;
  constructor(msg: string) {
    super(msg);
    this.name = "CaseIdTakenError";
  }
}

export class InvalidCaseSchemaError extends Error {
  code = "INVALID_CASE_SCHEMA";
  statusCode = 422;
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidCaseSchemaError";
  }
}

// ─── internal helpers ────────────────────────────────────────────────────────

function casesRelPath(domain: string): string {
  if (!domain || domain.includes("/") || domain.includes("\\") || domain.includes("..")) {
    throw new InvalidCaseSchemaError(`Invalid domain: ${domain}`);
  }
  return `evals/${domain}/eval/${domain}-eval-cases.yaml`;
}

async function readCasesDoc(projectRoot: string, domain: string): Promise<{ doc: Document; text: string; relPath: string }> {
  const relPath = casesRelPath(domain);
  const absPath = await assertReadable(projectRoot, relPath);
  const text = await readFile(absPath, "utf8");
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new InvalidCaseSchemaError(`YAML parse error: ${doc.errors[0].message}`);
  }
  return { doc, text, relPath };
}

function extractCases(doc: Document): EvalCase[] {
  const parsed = doc.toJSON() as Record<string, unknown>;
  if (!parsed || !Array.isArray(parsed.cases)) {
    return [];
  }
  return parsed.cases as EvalCase[];
}

function extractMetadata(doc: Document): Record<string, unknown> | undefined {
  const parsed = doc.toJSON() as Record<string, unknown>;
  return parsed?.metadata as Record<string, unknown> | undefined;
}

// Replace or append a case node in the YAML document
function upsertCaseInDoc(doc: Document, caseData: EvalCase, isNew: boolean): void {
  const root = doc.contents;
  if (!isMap(root)) {
    throw new InvalidCaseSchemaError("YAML root must be a map");
  }

  const casesNode = root.get("cases", true);
  if (!casesNode || !isSeq(casesNode)) {
    throw new InvalidCaseSchemaError("YAML must have a top-level 'cases' sequence");
  }

  if (isNew) {
    // Append new case
    casesNode.add(doc.createNode(caseData));
    return;
  }

  // Find and replace existing case
  const items = casesNode.items;
  const index = items.findIndex((item) => {
    if (isMap(item)) {
      const idNode = item.get("id");
      return idNode === caseData.id;
    }
    return false;
  });

  if (index === -1) {
    throw new CaseNotFoundError(`Case ${caseData.id} not found`);
  }

  casesNode.set(index, doc.createNode(caseData));
}

function deleteCaseInDoc(doc: Document, caseId: string): void {
  const root = doc.contents;
  if (!isMap(root)) {
    throw new InvalidCaseSchemaError("YAML root must be a map");
  }

  const casesNode = root.get("cases", true);
  if (!casesNode || !isSeq(casesNode)) {
    throw new InvalidCaseSchemaError("YAML must have a top-level 'cases' sequence");
  }

  const items = casesNode.items;
  const index = items.findIndex((item) => {
    if (isMap(item)) {
      return item.get("id") === caseId;
    }
    return false;
  });

  if (index === -1) {
    throw new CaseNotFoundError(`Case ${caseId} not found`);
  }

  casesNode.delete(index);
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function listDomains(projectRoot: string): Promise<EvalDomainInfo[]> {
  const evalsBase = path.join(projectRoot, "evals");
  let domainDirs: string[] = [];
  try {
    const entries = await readdir(evalsBase, { withFileTypes: true });
    domainDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const results: EvalDomainInfo[] = [];
  for (const domain of domainDirs) {
    const relPath = casesRelPath(domain);
    try {
      await assertReadable(projectRoot, relPath);
      const { doc } = await readCasesDoc(projectRoot, domain);
      const cases = extractCases(doc);
      const metadata = extractMetadata(doc);
      results.push({ domain, filePath: relPath, caseCount: cases.length, metadata });
    } catch {
      // skip domains without valid cases file
    }
  }

  return results;
}

async function attachLastRuns(domains: EvalDomainInfo[]): Promise<EvalDomainInfo[]> {
  const db = await getEvalDb();
  return domains.map((domain) => {
    const row = db.prepare(`
      SELECT id, started_at, pass_count, total_cases
      FROM eval_run
      WHERE domain = ? AND status = 'succeeded'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(domain.domain) as { id: number; started_at: string; pass_count: number; total_cases: number } | undefined;
    if (!row) return domain;
    return {
      ...domain,
      lastRun: {
        runId: row.id,
        passRate: row.total_cases > 0 ? row.pass_count / row.total_cases : 0,
        startedAt: row.started_at
      }
    };
  });
}

export async function listCases(projectRoot: string, domain: string): Promise<EvalCase[]> {
  const { doc } = await readCasesDoc(projectRoot, domain);
  return extractCases(doc);
}

export async function getCase(projectRoot: string, domain: string, caseId: string): Promise<EvalCase> {
  const cases = await listCases(projectRoot, domain);
  const found = cases.find((c) => c.id === caseId);
  if (!found) {
    throw new CaseNotFoundError(`Case ${caseId} not found in domain ${domain}`);
  }
  return found;
}

export async function addCase(
  projectRoot: string,
  domain: string,
  caseData: EvalCase,
  dryRun = false
): Promise<{ diff: string; proposedYaml: string } | { written: true }> {
  const { doc, text, relPath } = await readCasesDoc(projectRoot, domain);
  const cases = extractCases(doc);
  if (cases.some((c) => c.id === caseData.id)) {
    throw new CaseIdTakenError(`Case id ${caseData.id} already exists`);
  }
  upsertCaseInDoc(doc, caseData, true);
  const proposedYaml = doc.toString({ lineWidth: 0 });
  const diff = previewDiff(text, proposedYaml, relPath);
  if (dryRun) {
    return { diff, proposedYaml };
  }
  await auditedWriteFile(projectRoot, relPath, proposedYaml, {
    enabled: true,
    changeType: "eval_case_save",
    assetKind: "eval",
    actorType: "ui_admin",
    source: "eval_cases_api",
    targetId: `${domain}:${caseData.id}`,
    diff
  });
  return { written: true };
}

export async function updateCase(
  projectRoot: string,
  domain: string,
  caseId: string,
  caseData: EvalCase,
  dryRun: boolean
): Promise<{ diff: string; proposedYaml: string } | { written: true }> {
  const { doc, text, relPath } = await readCasesDoc(projectRoot, domain);
  const cases = extractCases(doc);
  if (!cases.some((c) => c.id === caseId)) {
    throw new CaseNotFoundError(`Case ${caseId} not found in domain ${domain}`);
  }
  upsertCaseInDoc(doc, caseData, false);
  const proposedYaml = doc.toString({ lineWidth: 0 });
  const diff = previewDiff(text, proposedYaml, relPath);

  if (dryRun) {
    return { diff, proposedYaml };
  }
  await auditedWriteFile(projectRoot, relPath, proposedYaml, {
    enabled: true,
    changeType: "eval_case_save",
    assetKind: "eval",
    actorType: "ui_admin",
    source: "eval_cases_api",
    targetId: `${domain}:${caseId}`,
    diff
  });
  return { written: true };
}

export async function deleteCase(projectRoot: string, domain: string, caseId: string): Promise<void> {
  const { doc, relPath } = await readCasesDoc(projectRoot, domain);
  deleteCaseInDoc(doc, caseId);
  await auditedWriteFile(projectRoot, relPath, doc.toString({ lineWidth: 0 }), {
    enabled: true,
    changeType: "eval_case_save",
    assetKind: "eval",
    actorType: "ui_admin",
    source: "eval_cases_api",
    targetId: `${domain}:${caseId}`
  });
}

// ─── route registration ──────────────────────────────────────────────────────

export function registerCaseRoutes(app: FastifyInstance) {
  // GET /api/eval/domains
  app.get("/api/eval/domains", async () => {
    const projectRoot = await resolveProjectRoot();
    const domains = await attachLastRuns(await listDomains(projectRoot));
    return { ok: true, data: { domains } };
  });

  // GET /api/eval/domains/:domain
  app.get<{ Params: { domain: string } }>("/api/eval/domains/:domain", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const domains = await attachLastRuns(await listDomains(projectRoot));
    const domain = domains.find((d) => d.domain === request.params.domain);
    if (!domain) {
      throw new CaseNotFoundError(`Domain ${request.params.domain} not found`);
    }
    return { ok: true, data: domain };
  });

  // GET /api/eval/cases/:domain
  app.get<{ Params: { domain: string } }>("/api/eval/cases/:domain", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const cases = await listCases(projectRoot, request.params.domain);
    return { ok: true, data: { cases } };
  });

  // GET /api/eval/cases/:domain/:caseId
  app.get<{ Params: { domain: string; caseId: string } }>("/api/eval/cases/:domain/:caseId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const c = await getCase(projectRoot, request.params.domain, request.params.caseId);
    return { ok: true, data: c };
  });

  // POST /api/eval/cases/:domain
  app.post<{
    Params: { domain: string };
    Body: { dryRun?: boolean; case: EvalCase };
  }>("/api/eval/cases/:domain", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const dryRun = request.body.dryRun === true;
    const result = await addCase(projectRoot, request.params.domain, request.body.case, dryRun);
    return reply.status(dryRun ? 200 : 201).send({ ok: true, data: result });
  });

  // PUT /api/eval/cases/:domain/:caseId
  app.put<{
    Params: { domain: string; caseId: string };
    Body: { dryRun?: boolean; case: EvalCase };
  }>("/api/eval/cases/:domain/:caseId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const dryRun = request.body.dryRun !== false;
    const result = await updateCase(projectRoot, request.params.domain, request.params.caseId, request.body.case, dryRun);
    return { ok: true, data: result };
  });

  // DELETE /api/eval/cases/:domain/:caseId
  app.delete<{ Params: { domain: string; caseId: string } }>("/api/eval/cases/:domain/:caseId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    await deleteCase(projectRoot, request.params.domain, request.params.caseId);
    return reply.status(200).send({ ok: true, data: { deleted: true } });
  });
}
