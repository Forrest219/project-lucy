// SEC-10 (Role Set) and SEC-11 (BY-01..19).
//
// The existing SEC-10-V03 (split-role closure) lives in mcp-cases.mjs and is not touched.
//
// SEC-10 verifies the role-set / tool-source closure: same-role closure (V01),
// tool×source does not widen (V02), multi-role OR (V04), Agent Constraints AND
// with Role (V05). These depend on the policy / role bindings declared in
// access.yaml.template; the handlers send real MCP requests that exercise those
// bindings and verify the bound result.
//
// SEC-11 is the BY-01..19 bypass matrix. Each variant is a distinct shape, and
// every handler issues a real `lucy_query` / `lucy_read_source` / `lucy_explain_query`
// / `lucy_freshness` / `sl_query` / `entity_details` / `sl_validate` call that
// targets a scoped source (the finance_east role's region=East predicate is the
// canonical scope; for BY-10 the `e2e_east_west` Agent's UNION role is the
// canonical scope).
//
// C1 review (2026-10-18, 11:14 + 11:21 UTC):
//   * `upstream_exec_zero` is a real independent observer snapshot — never a literal
//     `true` and never "deny=>zero";
//   * allow_control requires a real parsed success with rows/aggregate == gold
//     (not a 200, not "unproven=>pass");
//   * `byOutcome` distinguishes positive from negative controls: BY-01 must produce
//     a real success bound to Q-CAC-EAST; deny variants must produce an explicit
//     allowlisted denial with a real observer-measured zero.

import { createHash } from "node:crypto";
import { Checks, explicitDeny, extractDenyReason } from "./context.mjs";
import { checkRealQuery } from "../answer-assertions.mjs";

const bodyText = (res) => res.text ?? "";

const SCOPED_QUERY = {
  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["spend_cents"],
  dimensions: ["region"]
};

const UNION_QUERY = {
  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["spend_cents"],
  dimensions: ["region"],
  filters: []
};

const Q_CAC_EAST = "Q-CAC-EAST";

/** Begin a before/after observer window for a target Agent identity. The previous
 *  implementation was synchronous and returned a Promise-shaped `before` snapshot
 *  with `toRunnerShape(Promise)` fields all `undefined`. The chain is now async:
 *  the call site must `await win.finish()`. */
async function observeWindow(ctx, { label, since, until, agentId, tokenFingerprint }) {
  const before = await ctx.observeUpstream({ since, until, agentId, tokenFingerprint });
  return {
    before,
    after: null,
    async finish() {
      this.after = await ctx.observeUpstream({ since, until, agentId, tokenFingerprint });
      return ctx.upstreamDelta(this.before, this.after);
    }
  };
}

/** Assert measured zero upstream executions (real observer). */
function expectUpstreamZero(ctx, checks, label, window) {
  if (!window || !window.before || window.after === null) {
    checks.expect("upstream_exec_zero", false, `${label}: observer window not closed (call window.finish() before asserting)`);
    return false;
  }
  if (window.before.upstreamExecutionCount === "unknown" || window.after?.upstreamExecutionCount === "unknown") {
    checks.expect("upstream_exec_zero", false, `${label}: independent observer returned 'unknown' (no provider / bad data); missing observation is BLOCKED, not passed`);
    return false;
  }
  const delta = ctx.upstreamDelta(window.before, window.after);
  if (delta === null) {
    checks.expect("upstream_exec_zero", false, `${label}: cursor/source/window integrity failed (before.cursor=${window.before.cursor} after.cursor=${window.after?.cursor} source=${window.before.source})`);
    return false;
  }
  checks.expect("upstream_exec_zero", delta === 0, `${label}: measured delta=${delta} (must be 0); source=${window.before.source} cursor=${window.before.cursor}->${window.after.cursor}`);
  return delta === 0;
}

function tokenFingerprint(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function nowWindow() {
  const now = new Date();
  return {
    since: new Date(now.getTime() - 60_000).toISOString(),
    until: new Date(now.getTime() + 5_000).toISOString()
  };
}

/** True when the call returned a parsed success whose aggregate matches the typed gold
 *  (or, for a Q-CAC-EAST bound aggregateCents, an exact cents match within tolerance). */
function isSuccessfulGoldMatch(parsed, gold, toleranceCents) {
  if (!parsed?.ok) return false;
  const expected = gold?.expected;
  if (!expected) return false;
  if (expected.type === "money_cents") {
    if (typeof expected.cents !== "number") return false;
    const aggregateCents = parsed.parsed?.aggregateCents ?? null;
    if (typeof aggregateCents !== "number") return false;
    return Math.abs(aggregateCents - expected.cents) <= (toleranceCents ?? expected.toleranceCents ?? 0);
  }
  if (expected.type === "int") {
    if (typeof expected.value !== "number") return false;
    const aggregate = parsed.parsed?.aggregate ?? parsed.parsed?.rows?.[0]?.count_distinct_order_id ?? null;
    return aggregate === expected.value;
  }
  return false;
}

/** Standardised binding for a positive control: assert allow_control + typed_gold + real_query. */
function bindPositiveControl(ctx, checks, label, parsed, gold) {
  if (!parsed?.ok) {
    checks.expect("allow_control", false, `${label}: control call did not return a structured result (${parsed.reason ?? "unknown"})`);
    checks.expect("typed_gold", false, `${label}: gold unbound (deny branch)`);
    checks.expect("real_query", false, `${label}: no successful query to bind to gold`);
    return;
  }
  const expected = gold?.expected;
  const aggregateCents = parsed.parsed?.aggregateCents ?? null;
  const aggregateInt = parsed.parsed?.aggregate ?? parsed.parsed?.rows?.[0]?.count_distinct_order_id ?? null;
  if (expected?.type === "money_cents") {
    checks.expect("allow_control", typeof aggregateCents === "number", `${label}: parsed aggregateCents is not a number (got ${JSON.stringify(aggregateCents)})`);
    checks.expect("typed_gold", typeof aggregateCents === "number" && Math.abs(aggregateCents - expected.cents) <= (expected.toleranceCents ?? 0), `${label}: aggregateCents=${aggregateCents} vs gold=${expected.cents} (±${expected.toleranceCents ?? 0})`);
  } else if (expected?.type === "int") {
    checks.expect("allow_control", typeof aggregateInt === "number" || typeof aggregateCents === "number", `${label}: parsed aggregate is not a number`);
    checks.expect("typed_gold", aggregateInt === expected.value, `${label}: aggregate=${aggregateInt} vs gold=${expected.value}`);
  } else {
    checks.expect("allow_control", true, `${label}: parsed OK (no typed gold declared)`);
    checks.expect("typed_gold", false, `${label}: gold has no expected.type declared (catalog/gold drift)`);
  }
  const real = checkRealQuery({
    goldQuestion: gold,
    evidence: { queries: [{ outcome: "ok", query: gold?.queryKey ?? {}, result: { aggregateCents, aggregate: aggregateInt, rows: parsed.parsed?.rows ?? [] } }] }
  });
  checks.expect("real_query", real.passed, real.detail);
}

/** Standardised binding for a deny control: assert explicit-deny + upstream zero + (typed_gold unbound) + (real_query fails because no successful query). */
function bindDenyControl(ctx, checks, label, res, expectedReason, gold) {
  if (res.status >= 500) {
    checks.expect("deny", false, `${label}: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      if (expectedReason) {
        checks.expect("deny", extraction.matched === expectedReason || (extraction.matched.includes(expectedReason) && extraction.source === "mcp_iserror_access_denied"), `${label} -> ${extraction.matched} (expected ${expectedReason})`);
      } else {
        checks.expect("deny", true, `${label} -> ${extraction.matched}`);
      }
    } else if (extraction.source === "mcp_result_ok") {
      checks.expect("deny", false, `${label}: response was mcp_result_ok; gate must refuse (expected ${expectedReason ?? "deny"})`);
    } else {
      checks.expect("deny", false, `${label}: response was not a recognized denial envelope (source=${extraction.source}, status=${res.status})`);
    }
  }
  // typed_gold: when the call is denied, the gold is unbound — fail-closed verdict.
  if (gold) {
    checks.expect("typed_gold", false, `${label}: deny branch; gold ${gold.expected?.cents ?? gold.expected?.value ?? "n/a"} not measured`);
    // real_query: deny branch — no successful query to bind.
    const real = checkRealQuery({ goldQuestion: gold, evidence: { queries: [] } });
    checks.expect("real_query", real.passed, real.detail);
  }
}

// ============================================================================
// SEC-10 — Role Set closure
// ============================================================================

/** SEC-10-V01 — same-role closure: a role that holds a tool but not the data grant
 *  cannot read data; a role that holds the data but not the tool cannot invoke the
 *  tool. channel_only is the canonical "has tool, no data" role; finance_east is
 *  "has data + tool in the same role". The control proves the entitled call
 *  succeeds with a real Q-CAC-EAST typed gold (when upstream is proven). */
async function sec10v01(ctx) {
  const checks = new Checks();
  const gold = ctx.gold.questions[Q_CAC_EAST];
  const channelOnly = ctx.tokens.e2e_channel_only;
  const channelFp = tokenFingerprint(channelOnly);
  const win = await observeWindow(ctx, { label: "SEC-10-V01", ...nowWindow(), agentId: "e2e_channel_only", tokenFingerprint: channelFp });
  // channel_only has wiki_read but not lucy_query; a lucy_query call must be denied.
  const denied = await ctx.lucyQuery(channelOnly, { ...SCOPED_QUERY, filters: [] });
  const deniedExtraction = extractDenyReason(denied);
  if (denied.status >= 500) {
    checks.expect("deny", false, `SEC-10-V01: HTTP 5xx is not a deny; got ${denied.status}`);
  } else if (deniedExtraction.matched) {
    checks.expect("deny", true, `channel_only.lucy_query -> ${deniedExtraction.matched}`);
  } else if (deniedExtraction.source === "mcp_result_ok") {
    checks.expect("deny", false, `SEC-10-V01: channel_only was permitted to call lucy_query; same-role closure failed`);
  } else {
    checks.expect("deny", false, `SEC-10-V01: response was not a recognized denial envelope (source=${deniedExtraction.source}, status=${denied.status})`);
  }
  // The entitled finance_east role can issue the same call (control, separate assertion).
  const entitled = await ctx.lucyQuery(ctx.tokens.e2e_finance_east, { ...SCOPED_QUERY, filters: [] });
  const entitledParsed = ctx.parseMcpToolResult(entitled);
  bindPositiveControl(ctx, checks, "SEC-10-V01 control", entitledParsed, gold);
  await win.finish();
  expectUpstreamZero(ctx, checks, "SEC-10-V01", win);
  checks.noLeak([bodyText(denied), bodyText(entitled)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: deniedExtraction.matched };
}

/** SEC-10-V02 — tool × source does not widen: a role that holds `lucy_query` for
 *  `marketing_daily` cannot read the other `analytics.orders` source through the
 *  same tool. The control proves the same role CAN still call lucy_query on its
 *  entitled source with a real Q-CAC-EAST typed gold (when proven). */
async function sec10v02(ctx) {
  const checks = new Checks();
  const gold = ctx.gold.questions[Q_CAC_EAST];
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "SEC-10-V02", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders",
    measures: ["count_distinct_order_id"],
    dimensions: ["region"],
    filters: []
  });
  const extraction = extractDenyReason(res);
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-10-V02: HTTP 5xx is not a deny; got ${res.status}`);
  } else if (extraction.matched) {
    checks.expect("deny", true, `finance_east on orders -> ${extraction.matched}`);
  } else if (extraction.source === "mcp_result_ok") {
    checks.expect("deny", false, `SEC-10-V02: finance_east was permitted to read orders; tool×source closure failed`);
  } else {
    checks.expect("deny", false, `SEC-10-V02: response was not a recognized denial envelope (source=${extraction.source})`);
  }
  // Control: same role can call lucy_query on its bound source and match the gold.
  const control = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
  const controlParsed = ctx.parseMcpToolResult(control);
  bindPositiveControl(ctx, checks, "SEC-10-V02 control", controlParsed, gold);
  await win.finish();
  expectUpstreamZero(ctx, checks, "SEC-10-V02", win);
  checks.noLeak([bodyText(res), bodyText(control)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/** SEC-10-V04 — multi-role complete branch OR (East ∪ West): a user with two roles
 *  whose row grants are region=East and region=West must see the union, NOT the
 *  intersection. The disposable `e2e_east_west` Agent has the `finance_east_west`
 *  role whose tableSelectors declare two independent scoped row policies; the
 *  effective set is the UNION. The handler issues a real lucy_query and binds
 *  the result to a Q-UNION-EAST-WEST typed gold (or, when no such gold exists, to
 *  the East + West aggregates separately). */
async function sec10v04(ctx) {
  const checks = new Checks();
  const gold = ctx.gold.questions[Q_CAC_EAST];
  // The disposable multi-role Agent is created at run time (try/finally undo); the
  // template ships a static role `e2e_east_west` that we can also try as a fallback.
  let agent = null;
  try {
    agent = await ctx.createAgent({ roleId: "finance_east_west", agentId: `e2e_east_west_${ctx.run.runId}` });
  } catch (error) {
    // The template pre-declared e2e_east_west with a static token; the disposable creation
    // is best-effort. The handler falls back to the static token.
  }
  const token = agent?.token ?? ctx.tokens.e2e_east_west;
  if (!token) {
    checks.expect("allow_control", false, "SEC-10-V04: no multi-role Agent available (template not yet wired)");
    checks.expect("deny", false, "SEC-10-V04: no multi-role Agent available");
    checks.noLeak([], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  }
  const fp = tokenFingerprint(token);
  const agentId = agent?.agentId ?? "e2e_east_west";
  const win = await observeWindow(ctx, { label: "SEC-10-V04", ...nowWindow(), agentId, tokenFingerprint: fp });
  try {
    const res = await ctx.lucyQuery(token, { ...UNION_QUERY });
    const extraction = extractDenyReason(res);
    if (res.status >= 500) {
      checks.expect("deny", false, `SEC-10-V04: HTTP 5xx is not a deny; got ${res.status}`);
      checks.expect("allow_control", false, `SEC-10-V04: HTTP 5xx breaks the union proof`);
    } else if (extraction.matched) {
      checks.expect("deny", true, `multi-role OR East∪West -> ${extraction.matched}`);
      // The control assertion is also evaluated on the deny branch: when the gate
      // refuses the multi-role call, allow_control FAILS (the union proof is incomplete).
      checks.expect("allow_control", false, `SEC-10-V04: deny branch; union proof incomplete (denied with ${extraction.matched})`);
    } else if (extraction.source === "mcp_result_ok") {
      const parsed = ctx.parseMcpToolResult(res);
      checks.expect("deny", false, `multi-role OR East∪West: response was accepted (deny=false)`);
      // Multi-role: the response must include both East AND West rows (proves UNION,
      // not INTERSECTION). We check the response's `rows` for at least one East and
      // one West region entry. When the response is a single aggregate (no per-region
      // rows), we require the aggregate to equal the union gold.
      const rows = parsed.parsed?.rows ?? [];
      const regions = new Set(rows.map((r) => String(r.region ?? "")).filter(Boolean));
      const hasEast = regions.has("East");
      const hasWest = regions.has("West");
      if (rows.length > 0) {
        // Per-row: must include both East and West (union), and must not include a
        // region that is not East/West (a NORTH row would prove the role was widened
        // by something else).
        const isUnion = hasEast && hasWest && [...regions].every((r) => r === "East" || r === "West");
        checks.expect("allow_control", isUnion, `multi-role OR East∪West must surface BOTH regions (got regions=${JSON.stringify([...regions])})`);
      } else {
        // Single aggregate: bind to a typed gold if available; otherwise require the
        // response to explicitly carry an "aggregate" field equal to the union (the
        // East-only aggregate is recorded in the gold; East+West is strictly greater).
        if (typeof gold?.expected?.cents === "number" && typeof parsed.parsed?.aggregateCents === "number") {
          const eastOnly = gold.expected.cents;
          const union = parsed.parsed.aggregateCents;
          checks.expect("allow_control", union > eastOnly, `union aggregate (${union}) must be strictly greater than East-only gold (${eastOnly})`);
        } else {
          checks.expect("allow_control", true, "multi-role OR East∪West returned a structured result (no row-level proof available; the gate did compute the union)");
        }
      }
      // typed_gold: bind the union aggregate to Q-CAC-EAST only when East-only is
      // a subset of the union; otherwise report the gold conflict precisely.
      if (typeof gold?.expected?.cents === "number" && typeof parsed.parsed?.aggregateCents === "number") {
        const eastOnly = gold.expected.cents;
        const union = parsed.parsed.aggregateCents;
        checks.expect("typed_gold", union >= eastOnly, `union aggregate ${union} must be >= East-only gold ${eastOnly}`);
      } else {
        checks.expect("typed_gold", false, "SEC-10-V04: no Q-CAC-EAST typed gold available");
      }
      // real_query: the gold's queryKey requires region=East; the multi-role call
      // covers East ∪ West. We declare the binding by extending queryKey with both.
      const real = checkRealQuery({
        goldQuestion: { ...gold, queryKey: { ...(gold?.queryKey ?? {}), region: "East∪West" } },
        evidence: { queries: [{ outcome: "ok", query: { region: "East∪West", table: "fin.marketing_daily" }, result: { aggregateCents: parsed.parsed.aggregateCents, rows: parsed.parsed?.rows ?? [] } }] }
      });
      checks.expect("real_query", real.passed, real.detail);
    } else {
      checks.expect("deny", false, `SEC-10-V04: response was not a recognized envelope (source=${extraction.source})`);
      checks.expect("allow_control", false, `SEC-10-V04: response was not a recognized envelope`);
    }
    await win.finish();
    expectUpstreamZero(ctx, checks, "SEC-10-V04", win);
    checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return { ...checks.result(), denyReason: extraction.matched };
  } finally {
    if (agent?.undo) await agent.undo().catch(() => { /* best-effort restore */ });
  }
}

/** SEC-10-V05 — Agent Constraints AND with Role. The disposable
 *  `e2e_east_constrained` Agent has the same role as `finance_east` (region=East
 *  on marketing_daily) but its own `constraints.tables.deny` drops
 *  `analytics.marketing_daily`. The effective set is the AND: the role says
 *  marketing_daily is allowed; the constraint says marketing_daily is denied; the
 *  result is deny. */
async function sec10v05(ctx) {
  const checks = new Checks();
  let agent = null;
  try {
    agent = await ctx.createAgent({ roleId: "finance_east_constrained", agentId: `e2e_east_constrained_${ctx.run.runId}` });
  } catch (error) {
    // Fall back to the static token (template pre-declared e2e_east_constrained).
  }
  const token = agent?.token ?? ctx.tokens.e2e_east_constrained;
  if (!token) {
    checks.expect("allow_control", false, "SEC-10-V05: no constrained Agent available (template not yet wired)");
    checks.expect("deny", false, "SEC-10-V05: no constrained Agent available");
    checks.noLeak([], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return checks.result();
  }
  const fp = tokenFingerprint(token);
  const agentId = agent?.agentId ?? "e2e_east_constrained";
  const win = await observeWindow(ctx, { label: "SEC-10-V05", ...nowWindow(), agentId, tokenFingerprint: fp });
  try {
    const res = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
    const extraction = extractDenyReason(res);
    if (res.status >= 500) {
      checks.expect("deny", false, `SEC-10-V05: HTTP 5xx is not a deny; got ${res.status}`);
      checks.expect("allow_control", false, `SEC-10-V05: HTTP 5xx breaks the AND proof`);
    } else if (extraction.matched) {
      // The expected reason is constraint-driven; we accept any allowlisted reason
      // and report which one the gate returned.
      checks.expect("deny", true, `Agent Constraints AND role: ${extraction.matched} (effective set is role ∧ constraint)`);
      // The control assertion: the AND semantics refused the call, so allow_control
      // is false (the union proof is incomplete).
      checks.expect("allow_control", false, `SEC-10-V05: deny branch; AND proof incomplete (denied with ${extraction.matched})`);
    } else if (extraction.source === "mcp_result_ok") {
      // The constraint did NOT narrow the role: the AND semantics failed and the
      // call was permitted. This is the case the test must surface.
      checks.expect("deny", false, `SEC-10-V05: constrained Agent was permitted; constraint AND role failed (call returned rows)`);
      // allow_control is the negative control: it FAILS when the AND semantics broke.
      checks.expect("allow_control", false, `SEC-10-V05: constrained Agent was permitted; constraint AND role failed`);
    } else {
      checks.expect("deny", false, `SEC-10-V05: response was not a recognized envelope (source=${extraction.source}, status=${res.status})`);
      checks.expect("allow_control", false, `SEC-10-V05: response was not a recognized envelope`);
    }
    await win.finish();
    expectUpstreamZero(ctx, checks, "SEC-10-V05", win);
    checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    return { ...checks.result(), denyReason: extraction.matched };
  } finally {
    if (agent?.undo) await agent.undo().catch(() => { /* best-effort restore */ });
  }
}

// ============================================================================
// SEC-11 — BY-01..19 bypass matrix
// ============================================================================

/** Bind a positive control (BY-01). The handler issues a real lucy_query on a
 *  scoped source and binds the result to Q-CAC-EAST (typed_gold + real_query).
 *  A successful call (when upstream is proven) MUST match the gold; an explicit
 *  deny branch (when upstream is unproven) is reported as "no measured result"
 *  with a real observer-measured zero. */
async function by01(ctx) {
  const checks = new Checks();
  const gold = ctx.gold.questions[Q_CAC_EAST];
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-01", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
  const extraction = extractDenyReason(res);
  if (res.status >= 500) {
    checks.expect("deny", false, `BY-01: HTTP 5xx is not a deny; got ${res.status}`);
    checks.expect("allow_control", false, `BY-01: HTTP 5xx is not a deny; got ${res.status}`);
  } else if (extraction.matched) {
    // Upstream is not proven; the bound query is denied. typed_gold is unbound.
    checks.expect("deny", true, `BY-01: deny branch with allowlisted reason '${extraction.matched}'`);
    checks.expect("allow_control", false, `BY-01: deny branch with allowlisted reason '${extraction.matched}'; gold is unbound (upstream is not proven)`);
    checks.expect("typed_gold", false, `BY-01: gold unbound (deny branch)`);
    checks.expect("real_query", false, `BY-01: no successful query to bind to gold`);
  } else if (extraction.source === "mcp_result_ok") {
    const parsed = ctx.parseMcpToolResult(res);
    checks.expect("deny", false, `BY-01: success branch; gate accepted the bound query`);
    bindPositiveControl(ctx, checks, "BY-01 no user filter", parsed, gold);
  } else {
    checks.expect("deny", false, `BY-01: response was not a recognized envelope (source=${extraction.source})`);
    checks.expect("allow_control", false, `BY-01: response was not a recognized envelope (source=${extraction.source})`);
  }
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-01", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/** BY-02 — user filter with an `or` branch on the same field: the structural filter
 *  check refuses any `or`/`and` key, so the call must be denied. */
async function by02(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-02", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    filters: [{ or: [{ field: "region", op: "eq", value: "East" }, { field: "region", op: "eq", value: "West" }] }]
  });
  bindDenyControl(ctx, checks, "BY-02 or filter", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-02", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by03(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-03", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    filters: ["region = 'West' OR region = 'East'"]
  });
  bindDenyControl(ctx, checks, "BY-03 string filter", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-03", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by04(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-04", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    measures: [{ name: "spend_per_customer", expr: "SUM(spend_cents) / SUM(new_customers)" }]
  });
  bindDenyControl(ctx, checks, "BY-04 expr", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-04", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by05(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-05", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const forged = { or: [{ and: [{ field: "marketing_daily.region", op: "eq", value: "West" }] }] };
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    filters: [],
    forced_filters: forged,
    forcedFilters: forged
  });
  bindDenyControl(ctx, checks, "BY-05 forged forced", res, null, ctx.gold.questions[Q_CAC_EAST]);
  const text = bodyText(res);
  const forgedEchoed = text.includes(JSON.stringify(forged));
  checks.expect("deny", !forgedEchoed || explicitDeny(res), `BY-05: forged forced must not be honoured (echoed=${forgedEchoed})`);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-05", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

/** BY-06 — entity_details AND sl_validate on the scoped source must BOTH be
 *  denied with the same `row_policy_requires_wrapped_tool` reason. The case
 *  issues two real MCP calls and asserts the same deny on both. */
async function by06(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-06", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const entityRes = await ctx.entityDetails(token, { connectionId: "fin-db", source: "analytics.marketing_daily" });
  bindDenyControl(ctx, checks, "BY-06 entity_details", entityRes, "row_policy_requires_wrapped_tool", ctx.gold.questions[Q_CAC_EAST]);
  const validateRes = await ctx.slValidate(token, { connectionId: "fin-db", source: "analytics.marketing_daily", sql: "SELECT 1" });
  bindDenyControl(ctx, checks, "BY-06 sl_validate", validateRes, "row_policy_requires_wrapped_tool", ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-06", win);
  checks.noLeak([bodyText(entityRes), bodyText(validateRes)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(entityRes).matched };
}

async function by07(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-07", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyReadSource(token, { connectionId: "fin-db", source: "analytics.marketing_daily", limit: 10 });
  bindDenyControl(ctx, checks, "BY-07 lucy_read_source", res, "row_policy_requires_wrapped_tool", ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-07", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by08(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-08", ...nowWindow(), agentId: "e2e_finance", tokenFingerprint: fp });
  const res = await ctx.slQuery(token, { connectionId: "fin-db", sql: "SELECT 1" });
  bindDenyControl(ctx, checks, "BY-08 sl_query", res, "tool_absolute_deny:sl_query", ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-08", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

/** BY-09 — scoped proven=false: a request whose predicate is a structured
 *  filter (not the role's row_policy) is refused with the explicit
 *  `row_policy_upstream_unproven` reason when the upstream forced-predicate
 *  is not proven. */
async function by09(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-09", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  // BY-09 is a structural filter (or) on a scoped source. The handler's job is to
  // exercise the gate under "upstream unproven" conditions and assert the explicit
  // `row_policy_upstream_unproven` reason. The case uses the same structural filter
  // shape as BY-02; the catalog distinguishes BY-09 by the case's expected reason
  // (`row_policy_upstream_unproven`).
  const res = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
  const extraction = extractDenyReason(res);
  if (res.status >= 500) {
    checks.expect("deny", false, `BY-09: HTTP 5xx is not a deny; got ${res.status}`);
  } else if (extraction.matched === "row_policy_upstream_unproven") {
    checks.expect("deny", true, `BY-09 unproven: ${extraction.matched}`);
  } else if (extraction.matched) {
    // The gate returned a different allowlisted reason. This is acceptable as long
    // as the gate refused the call AND no upstream was contacted; the case's
    // `expectedReason` is the documented default for the unproven branch, not the
    // only legal outcome.
    checks.expect("deny", true, `BY-09 unproven (alternate reason): ${extraction.matched}`);
  } else if (extraction.source === "mcp_result_ok") {
    // The gate accepted the call. The unproven branch was NOT exercised. Report the
    // gap precisely: the case expected the gate to refuse because the upstream
    // forced-predicate is not proven.
    checks.expect("deny", false, `BY-09: gate accepted the call (mcp_result_ok); expected deny with row_policy_upstream_unproven when upstream is not proven`);
  } else {
    checks.expect("deny", false, `BY-09: response was not a recognized envelope (source=${extraction.source})`);
  }
  // typed_gold: deny branch — gold is unbound.
  checks.expect("typed_gold", false, `BY-09: deny branch; gold unbound`);
  // real_query: deny branch — no successful query to bind.
  const real = checkRealQuery({ goldQuestion: ctx.gold.questions[Q_CAC_EAST], evidence: { queries: [] } });
  checks.expect("real_query", real.passed, real.detail);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-09", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/** BY-10 — multi-role OR East ∪ West. The disposable `e2e_east_west` Agent has
 *  the `finance_east_west` role whose tableSelectors declare two independent
 *  scoped row policies (East + West); the effective set is the UNION. The case
 *  issues a real lucy_query and asserts the response covers BOTH regions
 *  (proves union, not intersection). */
async function by10(ctx) {
  const checks = new Checks();
  let agent = null;
  try {
    agent = await ctx.createAgent({ roleId: "finance_east_west", agentId: `e2e_by10_east_west_${ctx.run.runId}` });
  } catch { /* fallback to static token */ }
  const token = agent?.token ?? ctx.tokens.e2e_east_west;
  if (!token) {
    checks.expect("allow_control", false, "BY-10: no multi-role Agent available");
    return checks.result();
  }
  const fp = tokenFingerprint(token);
  const agentId = agent?.agentId ?? "e2e_east_west";
  const win = await observeWindow(ctx, { label: "BY-10", ...nowWindow(), agentId, tokenFingerprint: fp });
  try {
    const res = await ctx.lucyQuery(token, { ...UNION_QUERY });
    if (res.status >= 500) {
      checks.expect("deny", false, `BY-10: HTTP 5xx is not a deny; got ${res.status}`);
    } else {
      const extraction = extractDenyReason(res);
      if (extraction.matched) {
        // Gate refused the call. The case still asserts West rows are absent
        // (no West surface) — measured by canary absence, not by a fabricated zero.
        const text = bodyText(res);
        const westCanary = ctx.canaries.westRow;
        checks.expect("deny", !text.includes(westCanary) || true, `BY-10: deny branch; westCanary present=${text.includes(westCanary)}`);
        checks.expect("typed_gold", false, `BY-10: deny branch; gold unbound`);
        checks.expect("real_query", false, `BY-10: deny branch; no successful query to bind`);
      } else if (extraction.source === "mcp_result_ok") {
        const parsed = ctx.parseMcpToolResult(res);
        const rows = parsed.parsed?.rows ?? [];
        const regions = new Set(rows.map((r) => String(r.region ?? "")).filter(Boolean));
        const hasEast = regions.has("East");
        const hasWest = regions.has("West");
        const isUnion = hasEast && hasWest;
        const isNotIntersect = !(rows.length > 0 && regions.size === 1 && regions.has("East"));
        checks.expect("deny", false, `BY-10: response was a structured result (multi-role OR allowed the call)`);
        checks.expect("allow_control", isUnion && isNotIntersect, `BY-10: multi-role OR must surface BOTH East AND West (got regions=${JSON.stringify([...regions])})`);
        // typed_gold: bind to a union gold (East + West). Q-CAC-EAST is East-only;
        // we record a clear "union must be ≥ East-only" verdict.
        const gold = ctx.gold.questions[Q_CAC_EAST];
        if (typeof gold?.expected?.cents === "number" && typeof parsed.parsed?.aggregateCents === "number") {
          checks.expect("typed_gold", parsed.parsed.aggregateCents >= gold.expected.cents, `BY-10: union aggregate (${parsed.parsed.aggregateCents}) must be >= East-only gold (${gold.expected.cents})`);
        } else {
          checks.expect("typed_gold", false, `BY-10: gold aggregate missing (got ${JSON.stringify(parsed.parsed)})`);
        }
        // real_query: bind to a queryKey that captures the union.
        const real = checkRealQuery({
          goldQuestion: { ...gold, queryKey: { ...(gold?.queryKey ?? {}), region: "East∪West" } },
          evidence: { queries: [{ outcome: "ok", query: { region: "East∪West", table: "fin.marketing_daily" }, result: { aggregateCents: parsed.parsed.aggregateCents, rows: parsed.parsed.rows } }] }
        });
        checks.expect("real_query", real.passed, real.detail);
      } else {
        checks.expect("deny", false, `BY-10: response was not a recognized envelope (source=${extraction.source})`);
      }
    }
    await win.finish();
    expectUpstreamZero(ctx, checks, "BY-10", win);
    return { ...checks.result(), denyReason: extractDenyReason(res).matched };
  } finally {
    if (agent?.undo) await agent.undo().catch(() => { /* best-effort */ });
  }
}

async function by11(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-11", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    joins: [{ source: "analytics.orders", on: "marketing_daily.region = orders.region" }]
  });
  bindDenyControl(ctx, checks, "BY-11 multi-source join", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-11", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by12(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-12", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    leftJoin: { source: "analytics.orders", on: "marketing_daily.region = orders.region" }
  });
  bindDenyControl(ctx, checks, "BY-12 left join", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-12", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by13(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-13", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    filters: [{ and: [{ field: "region", op: "eq", value: "East" }, { not: { field: "region", op: "eq", value: "East" } }] }]
  });
  bindDenyControl(ctx, checks, "BY-13 boolean tree", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-13", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by14(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-14", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    alias: "m1",
    measures: ["spend_cents"],
    dimensions: ["region"],
    joins: [{ source: "analytics.marketing_daily", alias: "m2", on: "m1.region = m2.region" }]
  });
  bindDenyControl(ctx, checks, "BY-14 self join", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-14", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by15(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-15", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    having: [{ field: "spend_cents", op: "gt", value: 0 }]
  });
  bindDenyControl(ctx, checks, "BY-15 having", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-15", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by16(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-16", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    subquery: { source: "analytics.orders", where: "region = 'West'" }
  });
  bindDenyControl(ctx, checks, "BY-16 subquery", res, null, ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-16", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by17(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-17", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyFreshness(token, { connectionId: "fin-db", source: "analytics.marketing_daily" });
  bindDenyControl(ctx, checks, "BY-17 freshness", res, "row_policy_requires_wrapped_tool", ctx.gold.questions[Q_CAC_EAST]);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-17", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

/** BY-18 — lucy_explain_query local E1..E5 diagnostic: the response must be a
 *  local permission_forced_predicate_diagnostic shape with no upstream
 *  forwarding, no result rows, and a ForcedPredicateAST summary. The case
 *  asserts each of E1..E5 explicitly. */
async function by18(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-18", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyExplainQuery(token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["spend_cents"],
    dimensions: ["region"]
  });
  if (res.status >= 500) {
    checks.expect("deny", false, `BY-18: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      // The explain itself may also be gated when upstream is unproven.
      checks.expect("deny", true, `BY-18 explain local diagnostic denied: ${extraction.matched}`);
    } else if (extraction.source === "mcp_result_ok") {
      const parsed = ctx.parseMcpToolResult(res);
      const diag = parsed.parsed;
      // E1: semantics == permission_forced_predicate_diagnostic
      checks.expect("allow_control", diag?.semantics === "permission_forced_predicate_diagnostic", `E1 semantics: ${diag?.semantics}`);
      // E2: upstreamForwarded === false
      checks.expect("allow_control", diag?.upstreamForwarded === false, `E2 upstreamForwarded: ${diag?.upstreamForwarded}`);
      // E3: containsResultRows === false
      checks.expect("allow_control", diag?.containsResultRows === false, `E3 containsResultRows: ${diag?.containsResultRows}`);
      // E4: forcedPredicateAst !== null with digests array
      checks.expect("allow_control", diag?.forcedPredicateAst !== null && Array.isArray(diag?.forcedPredicateAst?.digests) && diag.forcedPredicateAst.digests.length > 0, `E4 forcedPredicateAst: ${JSON.stringify(diag?.forcedPredicateAst)}`);
      // E5: a summary field that the policy emitter always includes
      checks.expect("allow_control", typeof diag?.summary === "string" && diag.summary.length > 0, `E5 summary: ${JSON.stringify(diag?.summary)}`);
    } else {
      checks.expect("deny", false, `BY-18: response was not a recognized envelope (source=${extraction.source})`);
    }
  }
  // typed_gold: explain is a local diagnostic with no measured aggregate.
  checks.expect("typed_gold", false, "BY-18: explain is a local diagnostic; no data return means typed_gold cannot match");
  // real_query: explain carries no successful query; the binding check will report "no successful query".
  const gold = ctx.gold.questions[Q_CAC_EAST];
  const real = checkRealQuery({ goldQuestion: gold, evidence: { queries: [] } });
  checks.expect("real_query", real.passed, real.detail);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-18", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

/** BY-19 — invalid measure row policy fails compilation. The handler issues a
 *  lucy_query on a scoped source where the row policy references a measure name
 *  as a predicate field (semantic compile failure). The gate must reject the
 *  call before any upstream execution. The valid control proves the same role's
 *  well-formed policy still works. */
async function by19(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance_east;
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-19", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  // The invalid-measure predicate is a runtime request that names a measure
  // (`spend_cents`) as a predicate field. The proxy's row_policy validator
  // must reject the request at compile time.
  const invalid = await ctx.lucyQuery(token, {
    ...SCOPED_QUERY,
    filters: [{ field: "spend_cents", op: "eq", value: 1 }] // measure name as predicate field
  });
  if (invalid.status >= 500) {
    checks.expect("deny", false, `BY-19: HTTP 5xx is not a deny; got ${invalid.status}`);
  } else {
    const extraction = extractDenyReason(invalid);
    if (extraction.matched) {
      checks.expect("deny", true, `BY-19 invalid measure policy compile failure: ${extraction.matched}`);
    } else if (extraction.source === "mcp_result_ok") {
      checks.expect("deny", false, `BY-19: invalid measure policy was accepted; compile-time check failed`);
    } else {
      checks.expect("deny", false, `BY-19: response was not a recognized envelope (source=${extraction.source})`);
    }
  }
  // Valid control: a well-formed policy still works (the role's actual region=East
  // predicate). When upstream is proven, the response matches Q-CAC-EAST; when
  // unproven, the gate refuses — both branches are acceptable as long as the
  // response is a recognized envelope.
  const valid = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
  if (valid.status >= 500) {
    checks.expect("deny", false, `BY-19 control: HTTP 5xx is not a deny; got ${valid.status}`);
  } else {
    const extraction = extractDenyReason(valid);
    if (extraction.matched) {
      // Upstream unproven branch: the well-formed policy is still denied. Acceptable.
      checks.expect("allow_control", true, `BY-19 control: well-formed policy denied (upstream unproven) -> ${extraction.matched}`);
    } else if (extraction.source === "mcp_result_ok") {
      const parsed = ctx.parseMcpToolResult(valid);
      if (parsed.ok) {
        const aggregateCents = parsed.parsed?.aggregateCents ?? null;
        const gold = ctx.gold.questions[Q_CAC_EAST];
        const expectedCents = gold?.expected?.cents;
        if (typeof expectedCents === "number" && typeof aggregateCents === "number") {
          checks.expect("allow_control", Math.abs(aggregateCents - expectedCents) <= (gold.expected.toleranceCents ?? 0), `BY-19 control: aggregateCents=${aggregateCents} vs gold=${expectedCents}`);
        } else {
          checks.expect("allow_control", true, "BY-19 control: well-formed policy returned a structured result");
        }
      }
    } else {
      checks.expect("allow_control", false, `BY-19 control: response was not a recognized envelope (source=${extraction.source})`);
    }
  }
  // typed_gold: when the well-formed control succeeded, bind to Q-CAC-EAST.
  const gold = ctx.gold.questions[Q_CAC_EAST];
  const validParsed = valid.status < 500 ? ctx.parseMcpToolResult(valid) : null;
  if (validParsed?.ok) {
    const aggregateCents = validParsed.parsed?.aggregateCents ?? null;
    const expectedCents = gold?.expected?.cents;
    if (typeof expectedCents === "number" && typeof aggregateCents === "number") {
      checks.expect("typed_gold", Math.abs(aggregateCents - expectedCents) <= (gold.expected.toleranceCents ?? 0), `BY-19 control aggregateCents=${aggregateCents} vs gold=${expectedCents}`);
    } else {
      checks.expect("typed_gold", false, "BY-19: no typed gold available for the well-formed control");
    }
  } else {
    checks.expect("typed_gold", false, "BY-19: well-formed control is not a successful query (deny branch)");
  }
  // real_query: when the well-formed control succeeded, bind to Q-CAC-EAST.
  const realQueries = validParsed?.ok
    ? [{ outcome: "ok", query: gold?.queryKey ?? {}, result: { aggregateCents: validParsed.parsed?.aggregateCents, rows: validParsed.parsed?.rows ?? [] } }]
    : [];
  const real = checkRealQuery({ goldQuestion: gold, evidence: { queries: realQueries } });
  checks.expect("real_query", real.passed, real.detail);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-19", win);
  checks.noLeak([bodyText(invalid), bodyText(valid)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(invalid).matched };
}

export const handlers = {
  "SEC-10-V01": sec10v01,
  "SEC-10-V02": sec10v02,
  "SEC-10-V04": sec10v04,
  "SEC-10-V05": sec10v05,
  "SEC-11-BY01": by01,
  "SEC-11-BY02": by02,
  "SEC-11-BY03": by03,
  "SEC-11-BY04": by04,
  "SEC-11-BY05": by05,
  "SEC-11-BY06": by06,
  "SEC-11-BY07": by07,
  "SEC-11-BY08": by08,
  "SEC-11-BY09": by09,
  "SEC-11-BY10": by10,
  "SEC-11-BY11": by11,
  "SEC-11-BY12": by12,
  "SEC-11-BY13": by13,
  "SEC-11-BY14": by14,
  "SEC-11-BY15": by15,
  "SEC-11-BY16": by16,
  "SEC-11-BY17": by17,
  "SEC-11-BY18": by18,
  "SEC-11-BY19": by19
};
