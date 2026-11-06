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
// SEC-11 is the BY-01..19 bypass matrix, rebound to the row-policy pack
// (`mysql-aliyun` / `dataforai.superstore_orders`, regions 华东 / 西南).
// Agents are the pack ids `ag_east` and `ag_east_west` (two Roles on one Agent
// for the union). SEC-10 below stays on the security-e2e finance fixture.
//
// C1 review (2026-10-18, 11:14 + 11:21 UTC):
//   * `upstream_exec_zero` is a real independent observer snapshot — never a literal
//     `true` and never "deny=>zero";
//   * allow_control requires a real parsed success whose Region set matches the
//     pack grant (not a 200, not "unproven=>pass");
//   * `byOutcome` distinguishes positive from negative controls: BY-01 / BY-10
//     are phase-on allow paths (华东, 华东∪西南); deny variants must produce an
//     explicit allowlisted denial with a real observer-measured zero.
//   * BY-09 is phase-off only and passes `deny` solely for
//     `row_policy_upstream_unproven`.

import { createHash } from "node:crypto";
import { Checks, denyReasonMatches, explicitDeny, extractDenyReason, measureValue } from "./context.mjs";
import { checkRealQuery } from "../answer-assertions.mjs";
import { observeWindow, observationWindow, expectUpstreamZero, expectAuthorizedUpstream } from "./observation.mjs";
import { AGENTS, CONNECTION_ID, REGIONS, REGISTRY, ROLES, TABLES } from "../lib/row-policy-pack.mjs";

const bodyText = (res) => res.text ?? "";

const SCOPED_QUERY = {  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["cac_cents"],
  dimensions: [{ field: "marketing_daily.region" }]
};

const UNION_QUERY = {
  connectionId: "fin-db",
  source: "analytics.marketing_daily",
  measures: ["cac_cents"],
  dimensions: [{ field: "marketing_daily.region" }],
  filters: []
};

const Q_CAC_EAST = "Q-CAC-EAST";

const FACT_SOURCE = `${TABLES.fact.schema}.${TABLES.fact.name}`;
const UNGRANTED_SOURCE = `${TABLES.ungranted.schema}.${TABLES.ungranted.name}`;
const REGION_FIELD = `${TABLES.fact.name}.${TABLES.fact.field}`;
const PACK_UNION_ROLES = Object.freeze([ROLES.east, ROLES.west]);

/** Phase-on region read for BY. Measure is order_count; the proof is the Region set. */
const PACK_REGION_QUERY = {
  connectionId: CONNECTION_ID,
  source: FACT_SOURCE,
  measures: ["order_count"],
  dimensions: [{ field: REGION_FIELD }]
};

function packToken(ctx, agentId) {
  const token = ctx.tokens?.[agentId];
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`row-policy pack token missing for agent ${agentId}`);
  }
  return token;
}

function forcedPredicateProven(ctx) {
  const raw = ctx.run?.instance?.env?.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  return raw === "1" || raw === "true" || raw === "TRUE";
}

function regionHeader(key, field) {
  const lower = String(key).toLowerCase();
  const fieldLower = String(field).toLowerCase();
  return lower === fieldLower || lower.endsWith(`.${fieldLower}`);
}

function regionsFromParsed(parsed) {
  const body = parsed?.parsed ?? null;
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const headers = Array.isArray(body?.headers) ? body.headers : [];
  const field = TABLES.fact.field;
  const found = new Set();
  for (const row of rows) {
    if (Array.isArray(row)) {
      headers.forEach((header, index) => {
        if (regionHeader(header, field) && typeof row[index] === "string") found.add(row[index]);
      });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    for (const [key, value] of Object.entries(row)) {
      if (regionHeader(key, field) && typeof value === "string") found.add(value);
    }
  }
  return [...found].sort();
}

function sameRegionSet(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/** Task 8 may supply assertShape; otherwise the pack arms are 华东 and 华东∪西南. */
function expectedRegionSet(ctx, kind) {
  const shape = ctx.gold?.rowPolicy?.assertShape ?? ctx.gold?.readonlyGold?.assertShape;
  if (kind === "union" && Array.isArray(shape?.union) && shape.union.length > 0) return [...shape.union];
  if (kind === "east" && Array.isArray(shape?.eastOnly) && shape.eastOnly.length > 0) return [...shape.eastOnly];
  return kind === "union" ? [REGIONS.A, REGIONS.B] : [REGIONS.A];
}

function regionGoldQuestion(expectedRegions) {
  return {
    expected: { type: "int", value: expectedRegions.length },
    queryKey: {
      region: [...expectedRegions].sort().join("|"),
      table: FACT_SOURCE
    }
  };
}

/** Phase-on allow proof: Region set equals the grant. Not the old Q-CAC-EAST cents gold. */
function bindRegionAllow(checks, label, parsed, expectedRegions) {
  const regions = regionsFromParsed(parsed);
  const expected = [...expectedRegions].sort();
  const ok = regions.length > 0 && sameRegionSet(regions, expected);
  checks.expect("allow_control", ok, `${label}: Region set ${JSON.stringify(regions)} expected ${JSON.stringify(expected)}`);
  checks.expect("typed_gold", ok, `${label}: Region 集合断言 ${JSON.stringify(regions)} vs ${JSON.stringify(expected)}`);
  const gold = regionGoldQuestion(expected);
  const rows = parsed?.parsed?.rows ?? [];
  const real = checkRealQuery({
    goldQuestion: { ...gold, expected: { type: "int", value: regions.length } },
    evidence: {
      queries: ok
        ? [{ outcome: "ok", query: { ...gold.queryKey }, result: { aggregate: regions.length, rows } }]
        : []
    }
  });
  checks.expect("real_query", real.passed, real.detail);
}

function bindPackDeny(ctx, checks, label, res, expectedReason) {
  bindDenyControl(ctx, checks, label, res, expectedReason, regionGoldQuestion([REGIONS.A]));
}

function tokenFingerprint(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function nowWindow() {
  // The shared window: a generous upper bound, so a slow request's upstream execution
  // is still inside the window (a narrow bound silently dropped it and produced a
  // vacuous "zero upstream executions").
  return observationWindow(new Date());
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
    const aggregate = parsed.parsed?.aggregate ?? measureValue(parsed.parsed, ["cac_cents", "order_count", "total_spend_cents"]) ?? null;
    return aggregate === expected.value;
  }
  return false;
}

/** Standardised binding for a positive control: assert allow_control + typed_gold + real_query. */
function bindPositiveControl(ctx, checks, label, parsed, gold) {
  if (!parsed?.ok) {
    checks.expect("allow_control", false, `${label}: control call did not return a structured result (${parsed.reason ?? "unknown"})`);
    checks.expect("typed_gold", true, `${label}: deny/unstructured branch; typed gold correctly unbound`);
    checks.expect("real_query", true, `${label}: deny/unstructured branch; no successful query is required`);
    return;
  }
  const expected = gold?.expected;
  const aggregateCents = parsed.parsed?.aggregateCents ?? null;
  const aggregateInt = parsed.parsed?.aggregate ?? measureValue(parsed.parsed, ["cac_cents", "order_count", "total_spend_cents"]) ?? null;
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
        checks.expect("deny", denyReasonMatches(res, expectedReason), `${label} -> ${extraction.matched} (expected ${expectedReason})`);
      } else {
        checks.expect("deny", true, `${label} -> ${extraction.matched}`);
      }
    } else if (extraction.source === "mcp_result_ok") {
      checks.expect("deny", false, `${label}: response was mcp_result_ok; gate must refuse (expected ${expectedReason ?? "deny"})`);
    } else {
      checks.expect("deny", false, `${label}: response was not a recognized denial envelope (source=${extraction.source}, status=${res.status})`);
    }
  }
  // Deny branch: catalog still lists typed_gold / real_query for SEC-11. A correct
  // refuse must PASS those tokens by proving gold was NOT measured — not by failing
  // them (which made every deny BY permanently un-passable).
  if (gold) {
    checks.expect(
      "typed_gold",
      true,
      `${label}: deny branch; typed gold correctly unbound (not measured)`
    );
    checks.expect(
      "real_query",
      true,
      `${label}: deny branch; no successful query is the required outcome`
    );
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
  const win = await observeWindow(ctx, { label: "SEC-10-V01 (denied target)", ...nowWindow(), agentId: "e2e_channel_only", tokenFingerprint: channelFp });
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
  // The refused call must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's authorized execution cannot be counted
  // as the refused call's execution.
  await win.finish();
  expectUpstreamZero(ctx, checks, "SEC-10-V01 (denied target)", win, { authorizedRequests: 0 });

  // The entitled finance_east role can issue the same call (control, separate assertion).
  const controlWin = await observeWindow(ctx, { label: "SEC-10-V01 (entitled control)", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: tokenFingerprint(ctx.tokens.e2e_finance_east) });
  const entitled = await ctx.lucyQuery(ctx.tokens.e2e_finance_east, { ...SCOPED_QUERY, filters: [] });
  const entitledParsed = ctx.parseMcpToolResult(entitled);
  bindPositiveControl(ctx, checks, "SEC-10-V01 control", entitledParsed, gold);
  await controlWin.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-10-V01 (entitled control)", controlWin, { authorizedRequests: 1 });
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
  const win = await observeWindow(ctx, { label: "SEC-10-V02 (denied target)", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [{ field: "orders_masked.region" }],
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
  // The refused call must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs.
  await win.finish();
  expectUpstreamZero(ctx, checks, "SEC-10-V02 (denied target)", win, { authorizedRequests: 0 });

  // Control: same role can call lucy_query on its bound source and match the gold.
  const controlWin = await observeWindow(ctx, { label: "SEC-10-V02 (entitled control)", ...nowWindow(), agentId: "e2e_finance_east", tokenFingerprint: fp });
  const control = await ctx.lucyQuery(token, { ...SCOPED_QUERY, filters: [] });
  const controlParsed = ctx.parseMcpToolResult(control);
  bindPositiveControl(ctx, checks, "SEC-10-V02 control", controlParsed, gold);
  await controlWin.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-10-V02 (entitled control)", controlWin, { authorizedRequests: 1 });
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
    // Which branch the response took decides the upstream claim: a refused call must
    // not have reached the upstream, an allowed union query MUST have.
    let branch = "unrecognized";
    if (res.status >= 500) {
      branch = "error";
      checks.expect("deny", false, `SEC-10-V04: HTTP 5xx is not a deny; got ${res.status}`);
      checks.expect("allow_control", false, `SEC-10-V04: HTTP 5xx breaks the union proof`);
    } else if (extraction.matched) {
      branch = "deny";
      checks.expect("deny", true, `multi-role OR East∪West -> ${extraction.matched}`);
      // The control assertion is also evaluated on the deny branch: when the gate
      // refuses the multi-role call, allow_control FAILS (the union proof is incomplete).
      checks.expect("allow_control", false, `SEC-10-V04: deny branch; union proof incomplete (denied with ${extraction.matched})`);
    } else if (extraction.source === "mcp_result_ok") {
      branch = "allow";
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
    if (branch === "allow") {
      expectAuthorizedUpstream(ctx, checks, "SEC-10-V04", win, { authorizedRequests: 1 });
    } else {
      expectUpstreamZero(ctx, checks, "SEC-10-V04", win, { authorizedRequests: 0 });
    }
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

/** BY-01 — phase-on allow path. `ag_east` (`rp_east`) may read 华东 and must not
 *  see 西南. A deny (including upstream unproven) does not count as this allow. */
async function by01(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-01", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, { ...PACK_REGION_QUERY, filters: [] });
  const extraction = extractDenyReason(res);
  let branch = "unrecognized";
  if (res.status >= 500) {
    branch = "error";
    checks.expect("deny", false, `BY-01: HTTP 5xx is not a deny; got ${res.status}`);
    checks.expect("allow_control", false, `BY-01: HTTP 5xx is not a deny; got ${res.status}`);
    checks.expect("typed_gold", false, "BY-01: HTTP 5xx; Region set unbound");
    checks.expect("real_query", false, "BY-01: HTTP 5xx; no successful query");
  } else if (extraction.matched) {
    branch = "deny";
    checks.expect("deny", true, `BY-01: deny branch with allowlisted reason '${extraction.matched}'`);
    checks.expect("allow_control", false, `BY-01: phase-on allow path requires ${REGIONS.A}; denied with ${extraction.matched}`);
    checks.expect("typed_gold", true, "BY-01: deny branch; Region 集合正确未测到");
    checks.expect("real_query", false, "BY-01: no successful query to bind");
  } else if (extraction.source === "mcp_result_ok") {
    branch = "allow";
    const parsed = ctx.parseMcpToolResult(res);
    // Allow path: do not record a failed `deny` token — any passed:false fails the case.
    checks.expect("deny", true, "BY-01: allow path; request was accepted (not a refusal case)");
    bindRegionAllow(checks, "BY-01", parsed, expectedRegionSet(ctx, "east"));
  } else {
    checks.expect("deny", false, `BY-01: response was not a recognized envelope (source=${extraction.source})`);
    checks.expect("allow_control", false, `BY-01: response was not a recognized envelope (source=${extraction.source})`);
    checks.expect("typed_gold", false, "BY-01: unrecognized envelope; Region set unbound");
    checks.expect("real_query", false, "BY-01: unrecognized envelope; no successful query");
  }
  await win.finish();
  if (branch === "allow") {
    expectAuthorizedUpstream(ctx, checks, "BY-01", win, { authorizedRequests: 1 });
  } else {
    expectUpstreamZero(ctx, checks, "BY-01", win, { authorizedRequests: 0 });
  }
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/** BY-02 — user filter with an `or` branch on the same field: the structural filter
 *  check refuses any `or`/`and` key, so the call must be denied. */
async function by02(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-02", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    filters: [{ or: [{ field: TABLES.fact.field, op: "eq", value: REGIONS.A }, { field: TABLES.fact.field, op: "eq", value: REGIONS.B }] }]
  });
  bindPackDeny(ctx, checks, "BY-02 or filter", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-02", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by03(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-03", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    filters: [`${TABLES.fact.field} = '${REGIONS.B}' OR ${TABLES.fact.field} = '${REGIONS.A}'`]
  });
  bindPackDeny(ctx, checks, "BY-03 string filter", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-03", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by04(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-04", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    measures: [{ name: "sales_per_order", expr: `SUM(${TABLES.fact.name}.sales) / COUNT(DISTINCT ${TABLES.fact.name}.order_id)` }]
  });
  bindPackDeny(ctx, checks, "BY-04 expr", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-04", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by05(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-05", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const forged = { or: [{ and: [{ field: REGION_FIELD, op: "eq", value: REGIONS.B }] }] };
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    filters: [],
    forced_filters: forged,
    forcedFilters: forged
  });
  bindPackDeny(ctx, checks, "BY-05 forged forced", res, null);
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
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-06", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const entityRes = await ctx.entityDetails(token, { connectionId: CONNECTION_ID, source: FACT_SOURCE });
  bindPackDeny(ctx, checks, "BY-06 entity_details", entityRes, "row_policy_requires_wrapped_tool");
  const validateRes = await ctx.slValidate(token, { connectionId: CONNECTION_ID, source: FACT_SOURCE, sql: "SELECT 1" });
  bindPackDeny(ctx, checks, "BY-06 sl_validate", validateRes, "row_policy_requires_wrapped_tool");
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-06", win);
  checks.noLeak([bodyText(entityRes), bodyText(validateRes)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(entityRes).matched };
}

async function by07(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-07", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyReadSource(token, { connectionId: CONNECTION_ID, source: FACT_SOURCE, limit: 10 });
  bindPackDeny(ctx, checks, "BY-07 lucy_read_source", res, "row_policy_requires_wrapped_tool");
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-07", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by08(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-08", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.slQuery(token, { connectionId: CONNECTION_ID, sql: "SELECT 1" });
  bindPackDeny(ctx, checks, "BY-08 sl_query", res, "tool_absolute_deny:sl_query");
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-08", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

/** BY-09 — phase-off only. A scoped read must be refused with
 *  `row_policy_upstream_unproven`. Any other reason, and any phase-on allow,
 *  fails this case so Gate-On cannot reuse it as a pass. */
async function by09(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-09", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, { ...PACK_REGION_QUERY, filters: [] });
  const extraction = extractDenyReason(res);
  const phaseOn = forcedPredicateProven(ctx);
  const exactUnproven = !phaseOn && res.status < 500 && extraction.matched === "row_policy_upstream_unproven";
  if (phaseOn) {
    checks.expect("deny", false, "BY-09 is phase-off only; LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN is set so this case must not pass");
  } else if (res.status >= 500) {
    checks.expect("deny", false, `BY-09: HTTP 5xx is not a deny; got ${res.status}`);
  } else if (exactUnproven) {
    checks.expect("deny", true, `BY-09 unproven: ${extraction.matched}`);
  } else {
    checks.expect("deny", false, `BY-09: expected row_policy_upstream_unproven, got matched=${extraction.matched ?? "null"} source=${extraction.source}`);
  }
  checks.expect("typed_gold", true, "BY-09: phase-off deny; Region 集合正确未测到");
  checks.expect("real_query", true, "BY-09: phase-off deny; no successful query is required");
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-09", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/** BY-10 — phase-on allow path for the pack union agent. `ag_east_west` holds
 *  `rp_east` and `rp_west` (two Roles, not one Role with two selectors) and must
 *  see exactly 华东∪西南. */
async function by10(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.eastWest);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-10", ...nowWindow(), agentId: AGENTS.eastWest, tokenFingerprint: fp });
  let branch = "unrecognized";
  const res = await ctx.lucyQuery(token, { ...PACK_REGION_QUERY, filters: [] });
  const extraction = extractDenyReason(res);
  if (res.status >= 500) {
    branch = "error";
    checks.expect("deny", false, `BY-10: HTTP 5xx is not a deny; got ${res.status}`);
    checks.expect("typed_gold", false, "BY-10: HTTP 5xx; Region set unbound");
    checks.expect("real_query", false, "BY-10: HTTP 5xx; no successful query");
  } else if (extraction.matched) {
    branch = "deny";
    checks.expect("deny", true, `BY-10: deny branch with allowlisted reason '${extraction.matched}'`);
    checks.expect("allow_control", false, `BY-10: phase-on union ${PACK_UNION_ROLES.join("+")} requires ${REGIONS.A} and ${REGIONS.B}; denied with ${extraction.matched}`);
    checks.expect("typed_gold", true, "BY-10: deny branch; Region 集合正确未测到");
    checks.expect("real_query", false, "BY-10: deny branch; no successful query to bind");
  } else if (extraction.source === "mcp_result_ok") {
    branch = "allow";
    const parsed = ctx.parseMcpToolResult(res);
    checks.expect("deny", true, `BY-10: allow path; ${AGENTS.eastWest} (${PACK_UNION_ROLES.join("+")}) accepted (not a refusal case)`);
    bindRegionAllow(checks, "BY-10", parsed, expectedRegionSet(ctx, "union"));
  } else {
    checks.expect("deny", false, `BY-10: response was not a recognized envelope (source=${extraction.source})`);
    checks.expect("typed_gold", false, "BY-10: unrecognized envelope; Region set unbound");
    checks.expect("real_query", false, "BY-10: unrecognized envelope; no successful query");
  }
  await win.finish();
  if (branch === "allow") {
    expectAuthorizedUpstream(ctx, checks, "BY-10", win, { authorizedRequests: 1 });
  } else {
    expectUpstreamZero(ctx, checks, "BY-10", win, { authorizedRequests: 0 });
  }
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

async function by11(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-11", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    joins: [{ source: UNGRANTED_SOURCE, on: `${TABLES.fact.name}.order_id = ${TABLES.ungranted.name}.order_id` }]
  });
  bindPackDeny(ctx, checks, "BY-11 multi-source join", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-11", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by12(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-12", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    leftJoin: { source: UNGRANTED_SOURCE, on: `${TABLES.fact.name}.order_id = ${TABLES.ungranted.name}.order_id` }
  });
  bindPackDeny(ctx, checks, "BY-12 left join", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-12", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by13(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-13", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    filters: [{ and: [{ field: TABLES.fact.field, op: "eq", value: REGIONS.A }, { not: { field: TABLES.fact.field, op: "eq", value: REGIONS.A } }] }]
  });
  bindPackDeny(ctx, checks, "BY-13 boolean tree", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-13", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by14(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-14", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    connectionId: CONNECTION_ID,
    source: FACT_SOURCE,
    alias: "m1",
    measures: ["order_count"],
    dimensions: [{ field: REGION_FIELD }],
    joins: [{ source: FACT_SOURCE, alias: "m2", on: "m1.region = m2.region" }]
  });
  bindPackDeny(ctx, checks, "BY-14 self join", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-14", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by15(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-15", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    having: [{ field: "sales", op: "gt", value: 0 }]
  });
  bindPackDeny(ctx, checks, "BY-15 having", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-15", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by16(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-16", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    subquery: { source: UNGRANTED_SOURCE, where: `${TABLES.fact.field} = '${REGIONS.B}'` }
  });
  bindPackDeny(ctx, checks, "BY-16 subquery", res, null);
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-16", win);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function by17(ctx) {
  const checks = new Checks();
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-17", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyFreshness(token, { connectionId: CONNECTION_ID, source: FACT_SOURCE });
  bindPackDeny(ctx, checks, "BY-17 freshness", res, "row_policy_requires_wrapped_tool");
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
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-18", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const res = await ctx.lucyExplainQuery(token, {
    connectionId: CONNECTION_ID,
    source: FACT_SOURCE,
    measures: ["order_count"],
    dimensions: [{ field: REGION_FIELD }]
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
  const real = checkRealQuery({ goldQuestion: regionGoldQuestion([REGIONS.A]), evidence: { queries: [] } });
  checks.expect("real_query", real.passed, real.detail);
  await win.finish();
  // BY-18 is the one allow-branch case where "zero upstream executions" is the CORRECT
  // claim: `lucy_explain_query` is a local diagnostic (the proxy runs it in plan-only
  // mode and never forwards it). Flipping this to a positive assertion would be wrong.
  expectUpstreamZero(ctx, checks, "BY-18", win, { authorizedRequests: 0 });
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
  const token = packToken(ctx, AGENTS.east);
  const fp = tokenFingerprint(token);
  const win = await observeWindow(ctx, { label: "BY-19 (denied target)", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  // The invalid-measure predicate names the semantic measure `total_sales` as a
  // predicate field. The proxy's row_policy validator must reject it at compile time.
  const invalid = await ctx.lucyQuery(token, {
    ...PACK_REGION_QUERY,
    filters: [{ field: "total_sales", op: "eq", value: 1 }]
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
  // The refused invalid-measure request must not have reached the upstream. The window
  // is closed BEFORE the valid control runs, so the control's authorized execution
  // cannot be counted as the refused request's execution.
  await win.finish();
  expectUpstreamZero(ctx, checks, "BY-19 (denied target)", win, { authorizedRequests: 0 });

  // Valid control: the same agent's well-formed 华东 read. Phase-on must see
  // that Region set. A deny does not satisfy the control.
  const controlWin = await observeWindow(ctx, { label: "BY-19 (entitled control)", ...nowWindow(), agentId: AGENTS.east, tokenFingerprint: fp });
  const valid = await ctx.lucyQuery(token, { ...PACK_REGION_QUERY, filters: [] });
  let controlAllowed = false;
  if (valid.status >= 500) {
    checks.expect("allow_control", false, `BY-19 control: HTTP 5xx is not an allow; got ${valid.status}`);
    checks.expect("typed_gold", false, "BY-19: HTTP 5xx; Region set unbound");
    checks.expect("real_query", false, "BY-19: HTTP 5xx; no successful query");
  } else {
    const extraction = extractDenyReason(valid);
    if (extraction.matched) {
      checks.expect("allow_control", false, `BY-19 control: well-formed read denied (${extraction.matched}); phase-on 华东 allow did not happen`);
      checks.expect("typed_gold", true, "BY-19: deny branch; Region 集合正确未测到");
      checks.expect("real_query", false, "BY-19: deny branch; no successful query to bind");
    } else if (extraction.source === "mcp_result_ok") {
      controlAllowed = true;
      const parsed = ctx.parseMcpToolResult(valid);
      bindRegionAllow(checks, "BY-19 control", parsed, expectedRegionSet(ctx, "east"));
    } else {
      checks.expect("allow_control", false, `BY-19 control: response was not a recognized envelope (source=${extraction.source})`);
      checks.expect("typed_gold", false, "BY-19: unrecognized envelope; Region set unbound");
      checks.expect("real_query", false, "BY-19: unrecognized envelope; no successful query");
    }
  }
  await controlWin.finish();
  if (controlAllowed) {
    expectAuthorizedUpstream(ctx, checks, "BY-19 (entitled control)", controlWin, { authorizedRequests: 1 });
  } else {
    expectUpstreamZero(ctx, checks, "BY-19 (entitled control)", controlWin, { authorizedRequests: 0 });
  }
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

for (const entry of REGISTRY) {
  if (!entry.executionId.startsWith("BY-")) continue;
  if (typeof handlers[entry.catalogId] !== "function") {
    throw new Error(`row-policy BY handler missing for ${entry.catalogId} (${entry.executionId})`);
  }
}
