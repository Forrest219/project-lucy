// D6-only HTTP helpers for the offline-eval / security-candidate / field-question /
// monitor endpoints (Spec 161 / 172 / 173). These helpers live in their own module
// to respect C1's ownership of scripts/e2e/security/context.mjs — they consume
// `SecurityContext` (read-only: `web`, `run`, `ownerCookie`) and never mutate it.
//
// Every helper targets the REAL product endpoint documented in
// `webui/server/eval/*`. No helper invents an endpoint.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export class D6EvalHelpers {
  constructor(ctx) {
    this.ctx = ctx;
  }

  get web() { return this.ctx.web; }
  get run() { return this.ctx.run; }

  async ownerCookieOrNull() {
    if (typeof this.ctx.ownerCookie !== "function") return null;
    try { return await this.ctx.ownerCookie(); } catch { return null; }
  }

  // ---- UX-06 (offline eval suite + result import) ----

  /** GET /api/eval/suites/:domain/download — the OFFICIAL suite for the role-bound
   *  domain. Returns { status, json, text, suite } where `suite` is the parsed
   *  JSON/YAML or null. This is the ONLY source of truth for `suite_id`,
   *  `suite_hash`, `domain`, and `case_id` — handlers MUST fetch first, mutate
   *  ONE field, and submit. */
  async downloadSuite(domain) {
    const res = await this.web.request("GET", `/api/eval/suites/${encodeURIComponent(domain)}/download`);
    let suite = null;
    if (typeof res.text === "string" && res.text.length > 0) {
      try { suite = JSON.parse(res.text); } catch { suite = { raw: res.text }; }
    } else if (res.json) {
      suite = res.json?.data?.suite ?? res.json?.data ?? null;
    }
    return { ...res, suite };
  }

  /** POST /api/eval/results/import (dry-run). */
  async evalResultImport(content) {
    return this.web.request("POST", "/api/eval/results/import", { body: { content, dryRun: true } });
  }

  /** GET /api/eval/runs */
  async evalListRuns(query = {}) {
    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));
    if (query.status) params.set("status", query.status);
    const qs = params.toString();
    const res = await this.web.request("GET", qs ? `/api/eval/runs?${qs}` : "/api/eval/runs");
    const cases = res.json?.data?.runs ?? [];
    return { ...res, cases, total: res.json?.data?.total ?? cases.length };
  }

  // ---- UX-07 (security candidates + field questions + monitor) ----

  async evalListSecurityCandidates(query = {}) {
    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.tool) params.set("tool", query.tool);
    if (query.status) params.set("status", query.status);
    if (query.since) params.set("since", query.since);
    if (query.until) params.set("until", query.until);
    const qs = params.toString();
    const res = await this.web.request("GET", qs ? `/api/eval/security-candidates?${qs}` : "/api/eval/security-candidates");
    const candidates = res.json?.data?.candidates ?? [];
    return { ...res, candidates, raw: res };
  }

  async evalSecurityCandidateReview(id, body) {
    return this.web.request("POST", `/api/eval/security-candidates/${encodeURIComponent(id)}/review`, { body });
  }

  /** Flush the access_log → security_eval_candidate pipeline. The real
   *  extract endpoint accepts a `limit` body param. */
  async evalSecurityCandidateExtract({ limit = 200 } = {}) {
    return this.web.request("POST", "/api/eval/security-candidates/extract", { body: { limit } });
  }

  /** Read the persisted review rows for a candidate (audit trail). Uses local
   *  eval.sqlite under the run's project — there is no public GET route for
   *  this. We only call this AFTER a successful review POST. */
  async evalSecurityCandidateReviewsFor(candidateId) {
    const evalDbPath = path.join(this.run.paths.project, ".ktx-ui", "eval.sqlite");
    const rows = [];
    try {
      const database = new DatabaseSync(evalDbPath, { readOnly: true });
      const stmt = database.prepare(
        "SELECT id, candidate_id, decision, created_at, reviewer_actor_json FROM security_eval_candidate_review WHERE candidate_id = ? ORDER BY created_at DESC"
      );
      for (const row of stmt.all(candidateId)) rows.push(row);
      database.close();
    } catch { /* eval db not initialized yet */ }
    return rows;
  }

  async evalListFieldQuestions(query = {}) {
    const params = new URLSearchParams();
    if (query.domain) params.set("domain", query.domain);
    if (query.status) params.set("status", query.status);
    if (query.since) params.set("since", query.since);
    const qs = params.toString();
    const res = await this.web.request("GET", qs ? `/api/eval/field-questions?${qs}` : "/api/eval/field-questions");
    const questions = res.json?.data?.questions ?? [];
    return { ...res, questions, raw: res };
  }

  async evalFieldQuestionsExtract(pack) {
    return this.web.request("POST", "/api/eval/field-questions/extract", { body: pack });
  }

  async evalMonitorTrend({ days = 30, domain } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    if (domain) params.set("domain", domain);
    return this.web.request("GET", `/api/eval/monitor/trend?${params.toString()}`);
  }

  async evalMonitorField({ days = 7, domain } = {}) {
    const params = new URLSearchParams({ days: String(days) });
    if (domain) params.set("domain", domain);
    return this.web.request("GET", `/api/eval/monitor/field?${params.toString()}`);
  }
}

/** Build a synthetic v2 result from a downloaded suite. Mutates ONE field
 *  (mutator key + value) and computes the correct suite_hash from the suite's
 *  canonical bytes if `mutator` is not touching the hash. Returns the JSON
 *  string ready to POST to /api/eval/results/import.
 *
 *  @param suite     The parsed suite object (from downloadSuite(...))
 *  @param mutator   { key, value } — only this field is overwritten
 *  @param role_id   The role to bind the result to
 *  @param asOf      The as_of date (YYYY-MM-DD) — defaults to today
 *  @param runner    Defaults to { kind: "lucy_offline_batch", version: "2", model: "" }
 */
export function buildResultFromSuite(suite, { mutator, role_id, asOf = new Date().toISOString().slice(0, 10), runner } = {}) {
  if (!suite) throw new Error("buildResultFromSuite: suite is required");
  const { suite_id, suite_hash, domain, cases } = suite;
  const useRunner = runner ?? { kind: "lucy_offline_batch", version: "2", model: "" };
  const result = {
    lucy_eval_result_version: 2,
    complete: true,
    role_id,
    as_of: asOf,
    suite_id,
    suite_hash,
    domain,
    runner: useRunner,
    started_at: `${asOf}T00:00:00.000Z`,
    finished_at: `${asOf}T00:01:00.000Z`,
    results: (cases ?? []).slice(0, 1).map((c) => ({
      case_id: c.id,
      status: "PASS",
      outcome: "answered_ok"
    }))
  };
  if (mutator) {
    const apply = (obj, path) => {
      const segments = path.split(".");
      let cur = obj;
      for (let i = 0; i < segments.length - 1; i++) {
        if (cur[segments[i]] === undefined) cur[segments[i]] = {};
        cur = cur[segments[i]];
      }
      cur[segments[segments.length - 1]] = mutator.value;
    };
    apply(result, mutator.key);
  }
  return JSON.stringify(result);
}
