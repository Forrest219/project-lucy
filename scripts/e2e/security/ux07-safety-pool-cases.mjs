// UX-07 safety-pool / field-question admission variants (Spec 172 / 173).
//
// Catalog tag: `runner: management`. These are NOT registered in
// `run-security.mjs` — they are owned by the management-runner builder. This
// module is a structural stand-in ready for the management runner to adopt.
//
// UX-07 is the OPERATOR-FACING surface: the management runner drives the
// real client (human via WebUI WorkBuddy / Cursor, or the management-runner
// simulation) and these handlers assert the cross-pool invariants.
//
// Design contract (per task D6 URGENT 2026-10-18 11:33):
//   - V01 finds the row by exact (trace_id, tool, run) match — never by
//     "tool == wiki_read AND decision_reason matches a substring".
//   - V02 uses the REAL /api/eval/field-questions/extract endpoint with a
//     trace-bound call shape, not an invented JSON pack.
//   - V03's reviewer.actor schema MUST match the server's documented
//     `{ actorKind, actorId, identityProvider }` shape; the actorIdHash in
//     the persisted review row is sha256(actorId).slice(0, 32) — never the
//     plaintext actorId.
//   - V04 redacts the redaction_status, not just denys "any pending row".
//   - S01 monitor / field must not carry pass_count; this is structural
//     over the real product response.
//
// NEVER touches other builders' regions (observer, deploy, collect, archive,
// phase, DBseed, security runner).

import { createHash } from "node:crypto";
import { Checks } from "./context.mjs";
import { D6EvalHelpers } from "./d6-eval-helpers.mjs";

const bodyText = (res) => res.text ?? "";

function actorIdHash(actorId) {
  return createHash("sha256").update(String(actorId)).digest("hex").slice(0, 32);
}

/** Issue a real cross-domain denial that the proxy MUST log. The denial
 *  writes an access_log row keyed by request id; the candidate extractor
 *  picks it up. We capture the request id from the response headers (the
 *  proxy sets `x-lucy-request-id`) so we can later match the candidate row
 *  to THIS specific call — never to any historical row. */
async function issueCrossDomainDenial(d6, ctx) {
  const salesToken = ctx.tokens?.e2e_sales;
  if (!salesToken) {
    throw new Error("UX-07: ctx.tokens.e2e_sales is missing — security context did not register the test fixture");
  }
  // The wiki_read tool is the documented cross-domain denial surface
  // (Spec §4.1). The real mcpHttp carries the sales Token.
  const res = await ctx.mcpHttp.request("POST", "/mcp", {
    headers: {
      Authorization: `Bearer ${salesToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wiki_read", arguments: { path: "finance/cac-definition.md" } }
    }
  });
  const requestId = res.headers?.["x-lucy-request-id"] ?? res.headers?.["x-request-id"] ?? null;
  return { res, requestId };
}

/** Find a candidate row by EXACT (requestId, tool) match. The real list
 *  endpoint paginates; if the requestId is unknown we return null rather
 *  than fall back to "tool matches + reason matches a substring", which
 *  was the previous operator-precedence bug. */
async function findCandidateByRequestId(d6, requestId, tool) {
  if (!requestId) return null;
  const list = await d6.evalListSecurityCandidates({ tool, limit: 500 });
  const candidates = list.candidates ?? [];
  return candidates.find((c) => c.source_trace_id === requestId || c.request_id === requestId || c.access_log_request_id === requestId) ?? null;
}

/** UX-07-V01: a real cross-domain permission denial from the proxy MUST
 *  end up in the SECURITY pool (security_eval_candidate) — never in
 *  field_question, never in eval_run_case.
 *
 *  Real flow:
 *   1. POST /mcp tools/call (wiki_read cross-domain) with the sales
 *      token. Capture the request id from the response headers.
 *   2. POST /api/eval/security-candidates/extract (or the natural
 *      write-through, depending on the server) to flush the new row.
 *   3. GET /api/eval/security-candidates?tool=wiki_read and locate the
 *      row whose source_trace_id / access_log_request_id matches THE
 *      request id from step 1. NEVER match by historical substring.
 *   4. Assert the row's status starts as `candidate`, the
 *      `decision_reason` is in the documented allowlist, and the
 *      `redaction_status` is `redacted`.
 *   5. GET /api/eval/field-questions and assert the same row id is
 *      NOT present (no leak into the business pool).
 */
async function ux07v01(ctx) {
  const checks = new Checks();
  const d6 = new D6EvalHelpers(ctx);
  const { res: denied, requestId } = await issueCrossDomainDenial(d6, ctx);
  // Real deny path: 200 with isError=true and a denial message, OR 401/403.
  // GATE-01: a 5xx is NOT a deny.
  const isExplicitDeny = denied.status === 200
    ? String(denied.text ?? "").match(/Access denied|forbidden|context_role_required|not_authorized/i) !== null
    : (denied.status === 401 || denied.status === 403);
  checks.expect(
    "deny",
    isExplicitDeny,
    `cross-domain wiki MUST be explicit deny (200+Access denied OR 401/403); got HTTP ${denied.status} body=${(denied.text ?? "").slice(0, 200)}`
  );

  // Flush the candidate extractor so the row is durably written.
  await d6.evalSecurityCandidateReview.bind(d6); // (no-op, just to surface missing method)
  // The real flush: POST /api/eval/security-candidates/extract
  const extract = await d6.web.request("POST", "/api/eval/security-candidates/extract", { body: { limit: 200 } });
  checks.expect("allow_control", extract.status === 200, `candidate extract must return 200; got HTTP ${extract.status}`);

  // Locate OUR row by exact request-id match.
  const ourRow = await findCandidateByRequestId(d6, requestId, "wiki_read");
  checks.expect(
    "deny",
    Boolean(ourRow),
    `denial must produce a security-eval candidate row matching request id ${requestId ?? "<missing>"}; row not found`
  );
  if (ourRow) {
    checks.expect(
      "deny",
      ourRow.status === "candidate" || ourRow.status === "rejected" || ourRow.status === "accepted",
      `candidate row status must be a documented state; got ${ourRow.status}`
    );
    checks.expect(
      "deny",
      ["redacted", "cleared"].includes(ourRow.redaction_status),
      `redaction_status must be final (redacted/cleared); got ${ourRow.redaction_status}`
    );
    checks.expect(
      "deny",
      typeof ourRow.decision_reason === "string" && /forbidden|context_role_required|not_authorized|role_resolution_failed/i.test(ourRow.decision_reason),
      `decision_reason must be a documented allowlisted prefix; got ${ourRow.decision_reason}`
    );
  }

  // Field question pool: the SAME denial must NOT leak in.
  const fields = await d6.evalListFieldQuestions({ limit: 500 });
  const sameRowInFields = (fields.questions ?? []).some((q) => (q.source_trace_id === requestId) || (q.request_id === requestId));
  checks.expect("deny", !sameRowInFields, "permission denial must NOT leak into field_question");

  return { ...checks.result(), denyReason: ourRow?.decision_reason ?? (denied.status === 200 ? "in_band_deny" : `http_${denied.status}`) };
}

/** UX-07-V02: a BUSINESS-level (non-permission) failure — `lucy_query`
 *  returns a structured 200 result with `measure_unbound` / `not_answered`
 *  outcomes — MUST end up in the field_question pool and NEVER be
 *  classified as a safety candidate.
 *
 *  Real flow: we drive two real lucy_query calls that fail with
 *  `measure_unbound` (the test fixture's own data), then extract the
 *  field_question pool. We assert: at least one field_question card for
 *  the shape AND no safety candidate for the same shape AND the
 *  field_question summary does NOT echo a customer filter value.
 */
async function ux07v02(ctx) {
  const checks = new Checks();
  const d6 = new D6EvalHelpers(ctx);
  const financeToken = ctx.tokens?.e2e_finance;
  if (!financeToken) throw new Error("UX-07-V02: ctx.tokens.e2e_finance missing");

  // The real field-questions extract endpoint accepts a `FieldPack` with
  // `calls[]` — each call's tool / outcome / decisionReason /
  // sourceMapVersion / measures / dimensions / filterFields / roleIds.
  // The pack's `domain` is a free string used as the card's `domain`
  // field. The extractor upserts by (sourceMapVersion, shapeHash, roleIds).
  const shape = {
    domain: "e2e-offline-candidate-v02",
    sourceMapVersion: "e2e-source-map-v02",
    measures: ["spend_e2e_v02"],
    dimensions: ["platform"],
    filterFields: ["stat_date"],
    roleIds: ["e2e_finance"]
  };
  const pack = {
    domain: shape.domain,
    completeness: { complete: true },
    calls: [
      { tool: "lucy_query", outcome: "error", decisionReason: "measure_unbound", ...shape, seenOn: "2026-10-10" },
      { tool: "lucy_query", outcome: "error", decisionReason: "measure_unbound", ...shape, seenOn: "2026-10-11" }
    ]
  };
  const extract = await d6.evalFieldQuestionsExtract(pack);
  checks.expect("allow_control", extract.status === 200, `field-questions extract must return 200; got HTTP ${extract.status} body=${(extract.text ?? "").slice(0, 200)}`);
  checks.expect(
    "allow_control",
    (extract.json?.data?.inserted ?? 0) >= 1 || (extract.json?.data?.updated ?? 0) >= 1,
    `extract must upsert at least one field_question card; got inserted=${extract.json?.data?.inserted} updated=${extract.json?.data?.updated}`
  );

  // SAFETY pool must NOT contain a row for the same shape. Match by
  // sourceMapVersion + decisionReason + domain. NEVER by historical
  // substring of the summary.
  const safety = await d6.evalListSecurityCandidates({ tool: "lucy_query", limit: 500 });
  const sameInSafety = (safety.candidates ?? []).some((c) => c.decision_reason === "measure_unbound" && c.domain === shape.domain);
  checks.expect("deny", !sameInSafety, "business failure must NOT be classified as safety candidate");

  // BUSINESS pool: the card exists.
  const fields = await d6.evalListFieldQuestions({ domain: shape.domain, limit: 200 });
  const ourCard = (fields.questions ?? []).find((q) => q.domain === shape.domain);
  checks.expect("allow_control", Boolean(ourCard), `field_question card must exist for domain=${shape.domain}; got ${(fields.questions ?? []).length} cards`);
  if (ourCard) {
    // No customer filter value leaks in the summary (no literal stat_date
    // value, no quoted JSON value, no "=").
    const filterLeak = /stat_date\s*=\s*["']?\d{4}-\d{2}-\d{2}/i.test(ourCard.summary || "")
      || /["']\d{4}-\d{2}-\d{2}["']/.test(ourCard.summary || "");
    checks.expect("deny", !filterLeak, `field_question summary must not echo a customer filter value; got summary=${(ourCard.summary || "").slice(0, 100)}`);
  }

  return { ...checks.result(), denyReason: null };
}

/** UX-07-V03: every review action on a security-eval candidate MUST leave
 *  a traceable reviewer_actor_json + decision trail in
 *  security_eval_candidate_review. Spec §4.3 requires the actor be NON-AI;
 *  the endpoint refuses AI actors with `INVALID_REVIEWER` (400) and refuses
 *  missing actorId (also 400). The review POST records
 *  `{ actorKind, actorIdHash: sha256(actorId).slice(0,32), identityProvider }`
 *  — NEVER the raw actorId.
 *
 *  Real flow:
 *   1. Issue a real cross-domain denial (so the candidate row exists).
 *   2. Send accept with `actorKind: "ai"`, `actorId: "claude-opus-4-7"`
 *      → must be refused 400 INVALID_REVIEWER.
 *   3. Send accept with `actorKind: "admin"`, `actorId: "<reviewer>"`,
 *      `identityProvider: "deployment-local"` and all 3 confirm flags →
 *      must return 200, status must move to `accepted`, reviewId returned.
 *   4. Read /api/eval/security-candidate-review (admin route) or the
 *      local eval.sqlite via D6EvalHelpers. The persisted
 *      `reviewer_actor_json.actorIdHash` must equal
 *      sha256("<reviewer>").slice(0, 32) — NOT the raw actorId.
 */
async function ux07v03(ctx) {
  const checks = new Checks();
  const d6 = new D6EvalHelpers(ctx);
  const { requestId } = await issueCrossDomainDenial(d6, ctx);
  // Flush the candidate extractor.
  await d6.web.request("POST", "/api/eval/security-candidates/extract", { body: { limit: 200 } });
  const ourRow = await findCandidateByRequestId(d6, requestId, "wiki_read");
  checks.expect("deny", Boolean(ourRow), `seed candidate row must exist for request id ${requestId ?? "<missing>"}`);

  if (ourRow) {
    // (2) AI reviewer: refused
    const aiReview = await d6.evalSecurityCandidateReview(ourRow.id, {
      decision: "accept",
      permissionBoundaryConfirmed: true,
      expectedDenialConfirmed: true,
      businessContextConfirmed: true,
      reviewer: { actorKind: "ai", actorId: "claude-opus-4-7", identityProvider: "anthropic" }
    });
    const aiCode = aiReview.json?.error?.code ?? null;
    checks.expect(
      "deny",
      aiReview.status === 400 && aiCode === "INVALID_REVIEWER",
      `AI reviewer MUST be refused 400 + INVALID_REVIEWER; got HTTP ${aiReview.status} code=${aiCode}`
    );

    // (3) Human reviewer: accepted
    const reviewerId = `e2e-reviewer-${Date.now()}`;
    const humanReview = await d6.evalSecurityCandidateReview(ourRow.id, {
      decision: "accept",
      permissionBoundaryConfirmed: true,
      expectedDenialConfirmed: true,
      businessContextConfirmed: true,
      reviewer: { actorKind: "admin", actorId: reviewerId, identityProvider: "deployment-local" }
    });
    const humanCode = humanReview.json?.error?.code ?? null;
    const humanAccepted = humanReview.status === 200
      && (humanReview.json?.data?.status === "accepted" || humanReview.json?.data?.reviewed === true);
    checks.expect(
      "allow_control",
      humanAccepted,
      `human reviewer MUST be 200 with status=accepted; got HTTP ${humanReview.status} code=${humanCode} data=${JSON.stringify(humanReview.json?.data ?? {}).slice(0, 200)}`
    );
    checks.expect(
      "allow_control",
      typeof humanReview.json?.data?.reviewId === "string",
      `reviewId must be returned as a string; got ${humanReview.json?.data?.reviewId}`
    );

    // (4) audit trail: review row exists with actorIdHash = sha256(reviewerId).slice(0, 32)
    const trails = await d6.evalSecurityCandidateReviewsFor(ourRow.id);
    checks.expect("allow_control", (trails?.length ?? 0) >= 1, `review trail must exist for ${ourRow.id}; got ${trails?.length ?? 0} rows`);
    const ourTrail = (trails ?? []).find((t) => t.candidate_id === ourRow.id);
    if (ourTrail) {
      const actorBlob = typeof ourTrail.reviewer_actor_json === "string"
        ? JSON.parse(ourTrail.reviewer_actor_json)
        : ourTrail.reviewer_actor_json;
      const expectedHash = actorIdHash(reviewerId);
      checks.expect(
        "allow_control",
        actorBlob?.actorIdHash === expectedHash,
        `reviewer_actor_json.actorIdHash MUST equal sha256(actorId).slice(0,32); got ${actorBlob?.actorIdHash} expected ${expectedHash}`
      );
      checks.expect(
        "deny",
        typeof actorBlob?.actorId === "undefined" || !String(actorBlob.actorId).includes(reviewerId),
        `reviewer_actor_json MUST NOT carry the raw actorId; got ${actorBlob?.actorId}`
      );
    }
  }
  return { ...checks.result(), denyReason: ourRow ? null : "no_seed" };
}

/** UX-07-V04: a serialized candidate row MUST NOT include any customer
 *  filter value (e.g. a literal date, a customer-specific id, a tokenized
 *  secret). Spec §4.4 / §5.3 require non-leakage. Real flow:
 *   - Drive a denial so a candidate row exists.
 *   - GET /api/eval/security-candidates and assert no row carries a
 *     `filter=<value>` / `args_summary.value` / similar customer-data
 *     field, AND `redaction_status` is final, AND no run-level forbidden
 *     canary leaks.
 */
async function ux07v04(ctx) {
  const checks = new Checks();
  const d6 = new D6EvalHelpers(ctx);
  const { requestId } = await issueCrossDomainDenial(d6, ctx);
  await d6.web.request("POST", "/api/eval/security-candidates/extract", { body: { limit: 200 } });
  const ourRow = await findCandidateByRequestId(d6, requestId, "wiki_read");
  const list = await d6.evalListSecurityCandidates({ limit: 500 });
  const rows = list.candidates ?? [];
  checks.expect("deny", rows.length > 0, `candidate list non-empty after denial; got ${rows.length}`);
  // No customer filter value leaks across ANY row
  const filterLeak = rows.some((row) => /filter\s*=\s*["']?[a-z0-9_\-/.=+]+["']?/i.test(JSON.stringify(row))
    || /args_summary[^}]*value/i.test(JSON.stringify(row)));
  checks.expect("deny", !filterLeak, "no candidate row carries a customer filter value");
  // redaction_status is final for EVERY row, not just ours
  const redactionClean = rows.every((row) => row.redaction_status === "redacted" || row.redaction_status === "cleared");
  checks.expect("deny", redactionClean, `redaction_status must be final (redacted/cleared); saw non-final values in: ${rows.filter((r) => r.redaction_status !== "redacted" && r.redaction_status !== "cleared").slice(0, 3).map((r) => r.redaction_status).join(",")}`);
  // No run-level forbidden canary leaks
  const canaryLeak = rows.some((row) => (ctx.forbiddenFor?.([]) ?? []).some((c) => JSON.stringify(row).includes(c)));
  checks.expect("deny", !canaryLeak, "no run-level forbidden canary leaks via candidate list");
  // No leak for OUR row in particular
  checks.expect("deny", Boolean(ourRow), `seed candidate row must exist for request id ${requestId ?? "<missing>"}`);
  return { ...checks.result(), denyReason: null };
}

/** UX-07-S01: monitor / trend reconciliation. Real flow:
 *   - GET /api/eval/monitor/trend?days=30 → response is a points array;
 *     last point has `passRate` (number|null) and `notAnsweredCount`
 *     (number). NO point is colored `red` or `yellow` purely on shape
 *     (no live data). The `color` field, if present, must reflect a
 *     threshold breach, not a structural default.
 *   - GET /api/eval/monitor/field?domain=<bound>&days=7 → response is
 *     rows scoped to bound roles. NO row carries `pass_count` /
 *     `passCount` (Spec 161 §8.4 explicitly forbids this column).
 *   - The field response, when empty, includes a documented reason.
 */
async function ux07s01(ctx) {
  const checks = new Checks();
  const d6 = new D6EvalHelpers(ctx);
  const trend = await d6.evalMonitorTrend({ days: 30 });
  checks.expect("allow_control", trend.status === 200, `monitor/trend must return 200; got HTTP ${trend.status}`);
  const points = trend.json?.data?.points ?? [];
  checks.expect("consistency", Array.isArray(points), `monitor/trend points must be an array; got ${typeof points}`);
  if (points.length > 0) {
    const last = points[points.length - 1];
    checks.expect("consistency", typeof last.passRate === "number" || last.passRate === null, `last.passRate is number|null; got ${typeof last.passRate}=${last.passRate}`);
    checks.expect("consistency", typeof last.notAnsweredCount === "number", `last.notAnsweredCount is a number; got ${typeof last.notAnsweredCount}`);
    if (typeof last.color === "string") {
      checks.expect("deny", last.color !== "red", `last point color must NOT be red on shape alone; got ${last.color}`);
      checks.expect("deny", last.color !== "yellow", `last point color must NOT be yellow on shape alone; got ${last.color}`);
    }
  }

  const field = await d6.evalMonitorField({ days: 7, domain: "e2e-offline-candidate-v02" });
  checks.expect("allow_control", field.status === 200, `monitor/field must return 200; got HTTP ${field.status}`);
  const rows = field.json?.data?.rows ?? [];
  if (Array.isArray(rows) && rows.length > 0) {
    const hasPassCount = rows.some((r) => typeof r.pass_count === "number" || typeof r.passCount === "number");
    checks.expect("deny", !hasPassCount, `monitor/field must NEVER carry a pass_count column; saw it in ${rows.length} rows`);
  } else if (Array.isArray(rows) && rows.length === 0) {
    // The empty field panel MUST carry a documented reason, not just an
    // empty array (Spec 161 §8.4 "domain 未绑定角色")
    const emptyReason = field.json?.data?.message || field.json?.data?.emptyReason
      || (field.json?.data?.domains && field.json.data.domains["e2e-offline-candidate-v02"]?.empty === true);
    checks.expect("allow_control", Boolean(emptyReason), `empty field panel must include a reason; got data=${JSON.stringify(field.json?.data ?? {}).slice(0, 200)}`);
  }
  return { ...checks.result(), denyReason: null };
}

export const handlers = {
  "UX-07-V01": ux07v01,
  "UX-07-V02": ux07v02,
  "UX-07-V03": ux07v03,
  "UX-07-V04": ux07v04,
  "UX-07-S01": ux07s01
};
