// SEC-09 (Connection / table / same-named source) and SEC-12 (Bypass input shapes).
//
// C1 review (2026-10-18, 11:14 + 11:21 UTC): every "upstream_exec_zero" must be a real
// independent observer snapshot. Every "deny" must come from the explicit allowlist
// (HTTP 4xx OR JSON-RPC policy code OR MCP `result.isError: true` with `Access denied:
// <reason>...` text). HTTP 500 is NEVER a deny. `controlOk` must require an actual MCP
// success: parsed response with an aggregate / rows equal to the Q-ORDERS-EAST typed
// gold (NOT just a 200, NOT a fabricated unproven placeholder). Catalog and gold
// references are read-only; if the catalog or gold contradicts the case the case
// reports a precise conflict and skips the typed_gold / real_query assertions.
//
// SEC-09 verifies that the real MCP data plane serves an entitled query with the right
// DB-specific gold, refuses alias / physical-name / cross-DB attacks, and keeps the
// discovery surfaces (discover_data / dictionary_search / entity_details) free of
// out-of-domain data — proven by the actual response shape, not by canary absence
// alone.
//
// SEC-12 verifies that the policy gate refuses every named malformed input shape with
// an explicit deny and a measured zero upstream executions (real observer, never
// literal true).

import { createHash } from "node:crypto";
import { Checks, explicitDeny, extractDenyReason, measureValue } from "./context.mjs";
import { checkRealQuery } from "../answer-assertions.mjs";
import { observeWindow, observationWindow, expectUpstreamZero, expectAuthorizedUpstream, expectNoUnauthorizedUpstream } from "./observation.mjs";

const bodyText = (res) => res.text ?? "";

/** True when the call returned a typed result whose aggregate matches the gold. Strict:
 *  unproven branch is NOT a successful control. */
function isSuccessfulGoldMatch(parsed, gold) {
  if (!parsed?.ok) return false;
  const expected = gold?.expected?.value;
  if (typeof expected !== "number") return false;
  const candidate = parsed.parsed?.aggregate ?? measureValue(parsed.parsed, ["order_count"]) ?? null;
  return candidate === expected;
}

/** A non-empty body without `result.isError` and without `error` is treated as a normal
 *  HTTP 200 / 4xx response. Used to assert that a real response shape was returned. */
function isRecognizedShape(res) {
  if (typeof res?.status !== "number") return false;
  if (res.status >= 200 && res.status < 300) {
    return typeof res.text === "string" && res.text.length > 0;
  }
  return typeof res.text === "string" && res.text.length > 0;
}

// ============================================================================
// SEC-09 — Connection / table / same-named source
// ============================================================================

/**
 * SEC-09-V01 — control: entitled finance_reader issues a legitimate query against
 * the East region on the fin connection. The response must carry a parsed result
 * whose aggregate matches the Q-ORDERS-EAST typed gold; the request must bind to
 * the question's region/table key. The control is bound to Q-ORDERS-EAST; if the
 * case and the gold disagree the handler reports the conflict precisely.
 */
async function sec09v01(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const gold = ctx.gold.questions["Q-ORDERS-EAST"];
  const expected = gold?.expected?.value;
  if (typeof expected !== "number") {
    checks.expect("typed_gold", false, `SEC-09-V01: Q-ORDERS-EAST gold has no numeric expected.value (got ${JSON.stringify(gold?.expected)})`);
  }
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-V01", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: [{ field: "orders_masked.region", op: "eq", value: "East" }]
  });

  // Reject HTTP 500, JSON-RPC internal errors and parse errors as NOT a deny (GATE-01).
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-V01: HTTP 5xx is not a deny; got ${res.status}`);
    await window.finish();
    expectUpstreamZero(ctx, checks, "SEC-09-V01 (HTTP 500)", window);
    return { ...checks.result(), denyReason: `http_${res.status}` };
  }

  const parsed = ctx.parseMcpToolResult(res);
  if (parsed.ok) {
    checks.expect("allow_control", true, "entitled query returned a structured result");
    // Aggregate binding
    const aggregate = parsed.parsed?.aggregate ?? measureValue(parsed.parsed, ["order_count"]) ?? null;
    if (typeof expected === "number") {
      checks.expect("typed_gold", aggregate === expected, `aggregate=${aggregate} vs gold=${expected}`);
    }
    // real_query binding
    const real = checkRealQuery({
      goldQuestion: gold,
      evidence: {
        queries: [{
          outcome: "ok",
          query: { region: "East", table: "fin.orders" },
          result: { aggregate, rows: parsed.parsed?.rows ?? [] }
        }]
      }
    });
    checks.expect("real_query", real.passed, real.detail);
  } else {
    // Explicit deny: must match an allowlisted reason.
    if (explicitDeny(res)) {
      const { matched } = extractDenyReason(res);
      checks.expect("allow_control", false, `entitled query denied with allowlisted reason '${matched}'; control must succeed (gold ${expected} not measured)`);
    } else {
      checks.expect("allow_control", false, `entitled query returned unrecognized response: source=${extractDenyReason(res).source} status=${res.status}`);
    }
    checks.expect("typed_gold", false, `deny branch: gold ${expected ?? "n/a"} not measured`);
    checks.expect("real_query", false, "deny branch: no successful query to bind to gold");
  }

  await window.finish();
  if (parsed.ok) {
    // The entitled control DID execute upstream. The claim is "no UNAUTHORIZED upstream
    // execution", so the authorized execution is subtracted from the measured delta —
    // and the positive assertion proves the channel really saw the query (without it,
    // a channel that is not on the request path would pass vacuously).
    expectAuthorizedUpstream(ctx, checks, "SEC-09-V01", window, { authorizedRequests: 1 });
  } else {
    expectUpstreamZero(ctx, checks, "SEC-09-V01", window, { authorizedRequests: 0 });
  }
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: ctx.forbiddenFor(gold?.allowedCanaries ?? []) });
  return { ...checks.result(), denyReason: parsed.ok ? null : extractDenyReason(res).matched ?? extractDenyReason(res).reason };
}

/**
 * SEC-09-V02 — connection alias must not grant an unentitled connection. The
 * finance_reader's allow.connections is [fin-db]; a request that names a connection
 * by an alias must be denied with `unknown_or_forbidden_connection`. The control
 * proves the entitled connection returns a parsed success that matches the gold.
 */
async function sec09v02(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const gold = ctx.gold.questions["Q-ORDERS-EAST"];
  const expected = gold?.expected?.value;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-V02 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.lucyQuery(token, {
    connectionId: "sales", // alias for sales-db
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: []
  });
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-V02: HTTP 5xx is not a deny; got ${res.status}`);
    await window.finish();
    expectUpstreamZero(ctx, checks, "SEC-09-V02 (HTTP 500)", window);
    return { ...checks.result(), denyReason: `http_${res.status}` };
  }
  const extraction = extractDenyReason(res);
  if (extraction.matched) {
    checks.expect("deny", true, `alias connection -> ${extraction.matched}`);
  } else if (extraction.source === "mcp_result_ok") {
    checks.expect("deny", false, `SEC-09-V02: alias was accepted (HTTP 200, result.isError=false); gate must refuse an alias`);
  } else {
    checks.expect("deny", false, `SEC-09-V02: response was not a recognized denial envelope (source=${extraction.source}, status=${res.status}, raw=${JSON.stringify(extraction.raw).slice(0, 80)})`);
  }

  // The refused alias must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own authorized execution can never be
  // counted as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-V02 (denied target)", window, { authorizedRequests: 0 });

  // Control: the entitled connection still returns a parsed success that matches the gold.
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-V02 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_finance", tokenFingerprint });
  const control = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: [{ field: "orders_masked.region", op: "eq", value: "East" }]
  });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlMatches = isSuccessfulGoldMatch(controlParsed, gold);
  checks.expect("allow_control", controlMatches, `control: entitled connection -> parsed.ok=${controlParsed.ok} reason=${controlParsed.reason ?? "ok"} match=${controlMatches}`);

  await controlWindow.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-09-V02 (entitled control)", controlWindow, { authorizedRequests: 1 });
  checks.noLeak([bodyText(res), bodyText(control)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/**
 * SEC-09-V03 — physical table name does not grant access. The gate requires the
 * canonical source name; a request that names the underlying table by its physical
 * name must be refused. The control proves the same role can still read the
 * canonical source and match the gold.
 */
async function sec09v03(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const gold = ctx.gold.questions["Q-ORDERS-EAST"];
  const expected = gold?.expected?.value;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-V03 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "orders", // physical name, not canonical source
    measures: ["count_distinct_order_id"],
    dimensions: [],
    filters: []
  });
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-V03: HTTP 5xx is not a deny; got ${res.status}`);
    await window.finish();
    expectUpstreamZero(ctx, checks, "SEC-09-V03 (HTTP 500)", window);
    return { ...checks.result(), denyReason: `http_${res.status}` };
  }
  const extraction = extractDenyReason(res);
  if (extraction.matched) {
    checks.expect("deny", true, `physical table name -> ${extraction.matched}`);
  } else if (extraction.source === "mcp_result_ok") {
    checks.expect("deny", false, `SEC-09-V03: physical name was accepted; gate must refuse a non-canonical source`);
  } else {
    checks.expect("deny", false, `SEC-09-V03: response was not a recognized denial envelope (source=${extraction.source}, status=${res.status})`);
  }

  // The refused physical name must not have reached the upstream. The window is closed
  // BEFORE the entitled control runs, so the control's own authorized execution can
  // never be counted as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-V03 (denied target)", window, { authorizedRequests: 0 });

  const controlWindow = await observeWindow(ctx, { label: "SEC-09-V03 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_finance", tokenFingerprint });
  const control = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: [{ field: "orders_masked.region", op: "eq", value: "East" }]
  });
  const controlParsed = ctx.parseMcpToolResult(control);
  checks.expect("allow_control", isSuccessfulGoldMatch(controlParsed, gold), `control: canonical source -> parsed.ok=${controlParsed.ok} reason=${controlParsed.reason ?? "ok"}`);

  await controlWindow.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-09-V03 (entitled control)", controlWindow, { authorizedRequests: 1 });
  checks.noLeak([bodyText(res), bodyText(control)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: extraction.matched };
}

/**
 * SEC-09-V04 — same-named source across two logical DBs must return each DB's
 * own gold. sales_reader hits sales-db.orders; the response must equal the
 * Q-ORDERS-WEST-SALES typed gold. The cross-DB denial proves the same-named
 * source does not widen.
 */
async function sec09v04(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_sales;
  const gold = ctx.gold.questions["Q-ORDERS-WEST-SALES"];
  const expected = gold?.expected?.value;
  if (typeof expected !== "number") {
    checks.expect("typed_gold", false, `SEC-09-V04: Q-ORDERS-WEST-SALES gold has no numeric expected.value (got ${JSON.stringify(gold?.expected)})`);
  }
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-V04 (entitled control)", since, until, agentId: "e2e_sales", tokenFingerprint });

  const res = await ctx.lucyQuery(token, {
    connectionId: "sales-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: [{ field: "orders_masked.region", op: "eq", value: "West" }]
  });
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-V04: HTTP 5xx is not a deny; got ${res.status}`);
    await window.finish();
    expectUpstreamZero(ctx, checks, "SEC-09-V04 (HTTP 500)", window);
    return { ...checks.result(), denyReason: `http_${res.status}` };
  }
  const parsed = ctx.parseMcpToolResult(res);
  if (parsed.ok) {
    checks.expect("allow_control", true, "sales same-named source ok");
    const aggregate = parsed.parsed?.aggregate ?? measureValue(parsed.parsed, ["order_count"]) ?? null;
    if (typeof expected === "number") {
      checks.expect("typed_gold", aggregate === expected, `aggregate=${aggregate} vs gold=${expected}`);
    }
    const real = checkRealQuery({
      goldQuestion: gold,
      evidence: {
        queries: [{
          outcome: "ok",
          query: { region: "West", table: "sales.orders" },
          result: { aggregate, rows: parsed.parsed?.rows ?? [] }
        }]
      }
    });
    checks.expect("real_query", real.passed, real.detail);
  } else {
    if (explicitDeny(res)) {
      const { matched } = extractDenyReason(res);
      checks.expect("allow_control", false, `entitled sales query denied with allowlisted reason '${matched}'; control must succeed (gold ${expected} not measured)`);
    } else {
      checks.expect("allow_control", false, `entitled sales query returned unrecognized response: source=${extractDenyReason(res).source}`);
    }
    checks.expect("typed_gold", false, `deny branch: gold ${expected ?? "n/a"} not measured`);
    checks.expect("real_query", false, "deny branch: no successful query to bind to gold");
  }

  // The entitled sales query executed upstream: the claim is "no UNAUTHORIZED upstream
  // execution", so its own authorized execution is subtracted.
  await window.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-09-V04 (entitled control)", window, { authorizedRequests: 1 });

  // Cross-DB denial: sales reader hitting fin-db.orders must be denied. It gets its OWN
  // window, so the entitled control's execution cannot be counted as the denied probe's.
  const crossWindow = await observeWindow(ctx, { label: "SEC-09-V04 (cross-DB denied target)", ...observationWindow(new Date()), agentId: "e2e_sales", tokenFingerprint });
  const cross = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: []
  });
  const crossExtraction = extractDenyReason(cross);
  if (cross.status >= 500) {
    checks.expect("deny", false, `cross-DB same-name HTTP 5xx is not a deny; got ${cross.status}`);
  } else if (crossExtraction.matched) {
    checks.expect("deny", true, `cross-DB same-name attempt -> ${crossExtraction.matched}`);
  } else {
    checks.expect("deny", false, `cross-DB same-name attempt was not recognized as a deny (source=${crossExtraction.source})`);
  }

  await crossWindow.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-V04 (cross-DB denied target)", crossWindow, { authorizedRequests: 0 });
  checks.noLeak([bodyText(res), bodyText(cross)], { secrets: ctx.allSecrets, forbiddenCanaries: ctx.forbiddenFor(gold?.allowedCanaries ?? []) });
  return { ...checks.result(), denyReason: crossExtraction.matched };
}

/**
 * SEC-09-V05 — denial suggestions must not surface out-of-domain data. When the gate
 * refuses a query (e.g. wrong connection) its suggestions/listing payload must not
 * expose tables, sources or rows the caller is not entitled to. The control proves
 * the entitled connection still returns a parsed success that matches the gold.
 */
async function sec09v05(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const gold = ctx.gold.questions["Q-ORDERS-EAST"];
  const expected = gold?.expected?.value;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-V05 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const refused = await ctx.lucyQuery(token, {
    connectionId: "sales-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: []
  });
  if (refused.status >= 500) {
    checks.expect("deny", false, `SEC-09-V05: HTTP 5xx is not a deny; got ${refused.status}`);
  } else {
    const extraction = extractDenyReason(refused);
    if (extraction.matched) {
      checks.expect("deny", true, `wrong connection refused: ${extraction.matched}`);
    } else {
      checks.expect("deny", false, `wrong connection was not recognized as a deny (source=${extraction.source})`);
    }
  }
  // Real response shape assertion: the refusal must be a recognized envelope
  // (not empty, not 5xx, not a parse error). The case reports precisely when the
  // envelope is missing rather than defaulting to a "no canary" green.
  checks.expect("deny", isRecognizedShape(refused), `refusal must be a recognized response envelope (status=${refused.status}, body length=${(refused.text ?? "").length})`);
  const text = bodyText(refused);
  const leaks = [ctx.canaries.salesRow, ctx.canaries.salesWiki, ctx.canaries.restrictedWiki, ctx.canaries.westRow]
    .filter(Boolean)
    .filter((canary) => text.includes(canary));
  checks.expect("no_leak", leaks.length === 0, `${leaks.length} out-of-domain canary in the refusal`);

  // The refused wrong-connection request must not have reached the upstream. The window
  // is closed BEFORE the entitled control runs.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-V05 (denied target)", window, { authorizedRequests: 0 });

  // Control: the entitled connection still returns a parsed success that matches the gold.
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-V05 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_finance", tokenFingerprint });
  const control = await ctx.lucyQuery(token, {
    connectionId: "fin-db",
    source: "analytics.orders_masked",
    measures: ["order_count"],
    dimensions: [],
    filters: [{ field: "orders_masked.region", op: "eq", value: "East" }]
  });
  const controlParsed = ctx.parseMcpToolResult(control);
  checks.expect("allow_control", isSuccessfulGoldMatch(controlParsed, gold), `control: entitled connection -> parsed.ok=${controlParsed.ok} reason=${controlParsed.reason ?? "ok"}`);

  await controlWindow.finish();
  expectAuthorizedUpstream(ctx, checks, "SEC-09-V05 (entitled control)", controlWindow, { authorizedRequests: 1 });
  return { ...checks.result(), denyReason: extractDenyReason(refused).matched };
}

/**
 * SEC-09-S01 — discover_data refusal suggestions must only contain authorized
 * objects. The case calls discover_data with a real scope and verifies both the
 * response shape (success envelope) AND that no out-of-domain canary is present.
 * The control proves the discover_only role's lucy_catalog still returns a real
 * structured result (NOT a deny, NOT an empty/500 body).
 */
async function sec09s01(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_discover_only;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-S01 (denied target)", since, until, agentId: "e2e_discover_only", tokenFingerprint });

  const res = await ctx.discoverData(token, { scope: "all" });
  // The response must be a recognized envelope (HTTP 200 with result.content[0].text JSON).
  // The previous version passed simply because the canaries were absent in an empty body;
  // we now require the envelope to actually carry data we can scan.
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-S01: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const parsed = ctx.parseMcpToolResult(res);
    if (parsed.ok) {
      // Real response: must be a list/suggestions shape (array or object with `items`/`suggestions`).
      const shape = parsed.parsed;
      const hasList = Array.isArray(shape) || Array.isArray(shape?.items) || Array.isArray(shape?.suggestions);
      checks.expect("deny", hasList, `discover_data must return a list/suggestions envelope (got shape=${JSON.stringify(shape).slice(0, 120)})`);
    } else if (explicitDeny(res)) {
      const { matched } = extractDenyReason(res);
      checks.expect("deny", true, `discover_data refused with allowlisted reason '${matched}'`);
    } else {
      checks.expect("deny", false, `discover_data response was not a recognized envelope (source=${extractDenyReason(res).source})`);
    }
  }
  const text = bodyText(res);
  const leaks = [ctx.canaries.salesRow, ctx.canaries.salesWiki, ctx.canaries.restrictedWiki, ctx.canaries.piiEmail]
    .filter((c) => c && text.includes(c));
  checks.expect("no_leak", leaks.length === 0, `${leaks.length} out-of-domain canary in discover_data surface`);

  // The refused surface must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own upstream call can never be counted
  // as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-S01 (denied target)", window, { authorizedRequests: 0 });

  // Control: lucy_catalog (entitled) returns a real structured list.
  const control = await ctx.lucyCatalog(token);
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-S01 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_control", tokenFingerprint: "control" });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlOk = controlParsed.ok && (Array.isArray(controlParsed.parsed) || Array.isArray(controlParsed.parsed?.items) || Array.isArray(controlParsed.parsed?.catalog));
  checks.expect("allow_control", controlOk, `control: lucy_catalog must return a structured list (parsed.ok=${controlParsed.ok} reason=${controlParsed.reason ?? "ok"})`);

  await controlWindow.finish();
  // The entitled control is a METADATA surface (lucy_catalog / connection_list): Lucy
  // answers it from the local semantic layer, so it never reaches the upstream. The
  // claim that holds is the unauthorized one, not "it must have executed upstream".
  expectNoUnauthorizedUpstream(ctx, checks, "SEC-09-S01 (entitled control)", controlWindow, { authorizedRequests: 1 });
  return { ...checks.result(), denyReason: explicitDeny(res) ? extractDenyReason(res).matched : null };
}

/** SEC-09-S02 — dictionary_search surface for a role that does not hold the
 *  dictionary tool must be denied; the refusal must be a recognized envelope
 *  AND must not surface out-of-domain canaries. */
async function sec09s02(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-S02 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.dictionarySearch(token, { q: "order" });
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-S02: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      checks.expect("deny", true, `dictionary_search from non-dictionary role -> ${extraction.matched}`);
    } else {
      checks.expect("deny", false, `dictionary_search response was not a recognized denial (source=${extraction.source}, status=${res.status})`);
    }
  }
  checks.expect("deny", isRecognizedShape(res), `refusal must be a recognized envelope (status=${res.status}, body length=${(res.text ?? "").length})`);
  const text = bodyText(res);
  const leaks = [ctx.canaries.salesRow, ctx.canaries.salesWiki, ctx.canaries.restrictedWiki, ctx.canaries.piiEmail]
    .filter((c) => c && text.includes(c));
  checks.expect("no_leak", leaks.length === 0, `${leaks.length} out-of-domain canary in dictionary_search refusal`);

  // The refused surface must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own upstream call can never be counted
  // as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-S02 (denied target)", window, { authorizedRequests: 0 });

  // Control: lucy_catalog (entitled) still returns a structured list.
  const control = await ctx.lucyCatalog(token);
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-S02 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_control", tokenFingerprint: "control" });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlOk = controlParsed.ok && (Array.isArray(controlParsed.parsed) || Array.isArray(controlParsed.parsed?.items) || Array.isArray(controlParsed.parsed?.catalog));
  checks.expect("allow_control", controlOk, `control: lucy_catalog must return a structured list`);

  await controlWindow.finish();
  // The entitled control is a METADATA surface (lucy_catalog / connection_list): Lucy
  // answers it from the local semantic layer, so it never reaches the upstream. The
  // claim that holds is the unauthorized one, not "it must have executed upstream".
  expectNoUnauthorizedUpstream(ctx, checks, "SEC-09-S02 (entitled control)", controlWindow, { authorizedRequests: 1 });
  return { ...checks.result(), denyReason: explicitDeny(res) ? extractDenyReason(res).matched : null };
}

/** SEC-09-S03 — entity_details for an unentitled source/connection must be denied
 *  with a recognized envelope. */
async function sec09s03(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-S03 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.entityDetails(token, { connectionId: "sales-db", source: "analytics.orders" });
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-S03: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      checks.expect("deny", true, `entity_details on sales-db -> ${extraction.matched}`);
    } else {
      checks.expect("deny", false, `entity_details response was not a recognized denial (source=${extraction.source})`);
    }
  }
  checks.expect("deny", isRecognizedShape(res), `refusal must be a recognized envelope`);
  // Surface must not include any of the canary set (including the role's entitled canary is
  // acceptable only when the response explicitly references it; we just require no canary
  // in the refusal text).
  const text = bodyText(res);
  const leaks = Object.values(ctx.canaries).filter((c) => c && text.includes(c));
  checks.expect("no_leak", leaks.length === 0, `${leaks.length} canary in entity_details refusal`);

  // The refused surface must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own upstream call can never be counted
  // as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-S03 (denied target)", window, { authorizedRequests: 0 });

  // Control: connection_list (entitled) returns a real structured list.
  const control = await ctx.connectionList(token);
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-S03 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_control", tokenFingerprint: "control" });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlOk = controlParsed.ok && (Array.isArray(controlParsed.parsed) || Array.isArray(controlParsed.parsed?.items) || Array.isArray(controlParsed.parsed?.connections));
  checks.expect("allow_control", controlOk, `control: connection_list must return a structured list`);

  await controlWindow.finish();
  // The entitled control is a METADATA surface (lucy_catalog / connection_list): Lucy
  // answers it from the local semantic layer, so it never reaches the upstream. The
  // claim that holds is the unauthorized one, not "it must have executed upstream".
  expectNoUnauthorizedUpstream(ctx, checks, "SEC-09-S03 (entitled control)", controlWindow, { authorizedRequests: 1 });
  return { ...checks.result(), denyReason: explicitDeny(res) ? extractDenyReason(res).matched : null };
}

/** SEC-09-S04 — physical-table alias / disambiguation hint surface must not suggest
 *  out-of-domain objects. The case requires a real response shape (not just an
 *  empty body that trivially contains no canary). */
async function sec09s04(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_discover_only;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-S04 (denied target)", since, until, agentId: "e2e_discover_only", tokenFingerprint });

  const res = await ctx.discoverData(token, { q: "orders" });
  // Real surface: must be a recognized response shape.
  checks.expect("deny", isRecognizedShape(res), `discover_data hint must return a recognized envelope (status=${res.status}, body length=${(res.text ?? "").length})`);
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-S04: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const parsed = ctx.parseMcpToolResult(res);
    if (parsed.ok) {
      const shape = parsed.parsed;
      const hasList = Array.isArray(shape) || Array.isArray(shape?.items) || Array.isArray(shape?.suggestions);
      checks.expect("deny", hasList, `disambiguator hint must return a list/suggestions shape (got shape=${JSON.stringify(shape).slice(0, 120)})`);
    } else if (explicitDeny(res)) {
      const { matched } = extractDenyReason(res);
      checks.expect("deny", true, `disambiguator hint refused with allowlisted reason '${matched}'`);
    } else {
      checks.expect("deny", false, `disambiguator hint was not a recognized envelope (source=${extractDenyReason(res).source})`);
    }
  }
  const text = bodyText(res);
  const leaks = [ctx.canaries.salesRow, ctx.canaries.salesWiki, ctx.canaries.restrictedWiki, ctx.canaries.piiEmail]
    .filter((c) => c && text.includes(c));
  checks.expect("no_leak", leaks.length === 0, `${leaks.length} out-of-domain canary in disambiguator hint`);

  // The refused surface must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own upstream call can never be counted
  // as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-S04 (denied target)", window, { authorizedRequests: 0 });

  // Control: lucy_catalog (entitled) returns a real structured list.
  const control = await ctx.lucyCatalog(token);
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-S04 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_control", tokenFingerprint: "control" });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlOk = controlParsed.ok && (Array.isArray(controlParsed.parsed) || Array.isArray(controlParsed.parsed?.items) || Array.isArray(controlParsed.parsed?.catalog));
  checks.expect("allow_control", controlOk, `control: lucy_catalog must return a structured list`);

  await controlWindow.finish();
  // The entitled control is a METADATA surface (lucy_catalog / connection_list): Lucy
  // answers it from the local semantic layer, so it never reaches the upstream. The
  // claim that holds is the unauthorized one, not "it must have executed upstream".
  expectNoUnauthorizedUpstream(ctx, checks, "SEC-09-S04 (entitled control)", controlWindow, { authorizedRequests: 1 });
  return { ...checks.result(), denyReason: explicitDeny(res) ? extractDenyReason(res).matched : null };
}

/** SEC-09-S05 — an unknown tool name is rejected as AbsoluteDeny. */
async function sec09s05(ctx) {
  const checks = new Checks();
  const token = ctx.tokens.e2e_finance;
  const tokenFingerprint = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const now = new Date();
  const { since, until } = observationWindow(now);
  const window = await observeWindow(ctx, { label: "SEC-09-S05 (denied target)", since, until, agentId: "e2e_finance", tokenFingerprint });

  const res = await ctx.mcp(token, ctx.rpc(1, "tools/call", { name: "lucy_not_a_real_tool", arguments: {} }));
  if (res.status >= 500) {
    checks.expect("deny", false, `SEC-09-S05: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      checks.expect("deny", true, `unknown tool -> ${extraction.matched}`);
    } else {
      checks.expect("deny", false, `unknown tool was not a recognized denial (source=${extraction.source})`);
    }
  }

  // The refused surface must not have reached the upstream. The window is closed BEFORE
  // the entitled control runs, so the control's own upstream call can never be counted
  // as the refused request's execution.
  await window.finish();
  expectUpstreamZero(ctx, checks, "SEC-09-S05 (denied target)", window, { authorizedRequests: 0 });

  // Control: a real tool the role is entitled to returns a real structured result.
  const control = await ctx.lucyCatalog(token);
  const controlWindow = await observeWindow(ctx, { label: "SEC-09-S05 (entitled control)", ...observationWindow(new Date()), agentId: "e2e_control", tokenFingerprint: "control" });
  const controlParsed = ctx.parseMcpToolResult(control);
  const controlOk = controlParsed.ok && (Array.isArray(controlParsed.parsed) || Array.isArray(controlParsed.parsed?.items) || Array.isArray(controlParsed.parsed?.catalog));
  checks.expect("allow_control", controlOk, `control: lucy_catalog must return a structured list`);

  await controlWindow.finish();
  // The entitled control is a METADATA surface (lucy_catalog / connection_list): Lucy
  // answers it from the local semantic layer, so it never reaches the upstream. The
  // claim that holds is the unauthorized one, not "it must have executed upstream".
  expectNoUnauthorizedUpstream(ctx, checks, "SEC-09-S05 (entitled control)", controlWindow, { authorizedRequests: 1 });
  checks.noLeak([bodyText(res), bodyText(control)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return { ...checks.result(), denyReason: explicitDeny(res) ? extractDenyReason(res).matched : null };
}

// ============================================================================
// SEC-12 — Bypass input shapes. Each variant sends a named malformed request on
// the real MCP `lucy_query` path and verifies the gate refuses with a measured
// zero upstream executions.
// ============================================================================

async function issueQuery(ctx, token, args, headers) {
  return ctx.mcp(token, ctx.rpc(1, "tools/call", { name: "lucy_query", arguments: args }), { headers: headers ?? {} });
}

/** Standard set of checks: explicit deny (no HTTP 500), measured upstream zero, no leak.
 *  Async because the upstream observer delta is itself async — the window must be closed
 *  (`await window.finish()`) before `expectUpstreamZero` can read the `after` snapshot. */
async function shapeChecks(ctx, res, label, window) {
  const checks = new Checks();
  if (res.status >= 500) {
    checks.expect("deny", false, `${label}: HTTP 5xx is not a deny; got ${res.status}`);
  } else {
    const extraction = extractDenyReason(res);
    if (extraction.matched) {
      checks.expect("deny", true, `${label} -> ${extraction.matched}`);
    } else if (extraction.source === "mcp_result_ok") {
      checks.expect("deny", false, `${label}: call was accepted; gate must refuse the shape (got mcp_result_ok)`);
    } else {
      checks.expect("deny", false, `${label}: response was not a recognized denial envelope (source=${extraction.source}, status=${res.status})`);
    }
  }
  // Close the observer window before asserting the upstream-zero claim. The previous
  // synchronous version read `window.after` while it was still `null`; the assertion
  // was a vacuous "window not closed" failure that masked the real measurement.
  if (window && typeof window.finish === "function" && window.after === null) {
    try { await window.finish(); } catch { /* the assertion below will surface the problem */ }
  }
  expectUpstreamZero(ctx, checks, label, window);
  checks.noLeak([bodyText(res)], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  return checks;
}

async function sec12v01(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V01", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    query: "SELECT region, COUNT(*) FROM analytics.orders GROUP BY region",
    measures: [],
    dimensions: []
  });
  const checks = await shapeChecks(ctx, res, "raw SQL", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v02(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V02", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: [{ name: "spend_per_customer", expr: "SUM(marketing_daily.spend_cents) / SUM(marketing_daily.new_customers)" }],
    dimensions: []
  });
  const checks = await shapeChecks(ctx, res, "expr measure", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v03(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V03", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    filters: ["region = 'West' OR region = 'East'"]
  });
  const checks = await shapeChecks(ctx, res, "string filter", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v04(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V04", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    joins: [{ source: "analytics.orders", on: "marketing_daily.region = orders.region" }]
  });
  const checks = await shapeChecks(ctx, res, "join", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v05(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V05", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    filters: [{ field: "mkt.region", op: "eq", value: "West" }]
  });
  const checks = await shapeChecks(ctx, res, "alias", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v06(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V06", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    subquery: { source: "analytics.orders", where: "region = 'West'" }
  });
  const checks = await shapeChecks(ctx, res, "subquery", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v07(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V07", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    filters: [{ "ｏｒ": [{ field: "region", op: "eq", value: "West" }] }]
  });
  const checks = await shapeChecks(ctx, res, "Unicode variant", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v08(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V08", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    filters: [{ field: "region /* FORCED */", op: "eq", value: "West" }]
  });
  const checks = await shapeChecks(ctx, res, "comment", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v09(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V09", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const forged = { or: [{ and: [{ field: "marketing_daily.region", op: "eq", value: "West" }] }] };
  const res = await issueQuery(ctx, token, {
    connectionId: "fin-db",
    source: "analytics.marketing_daily",
    measures: ["total_spend_cents"],
    dimensions: [{ field: "marketing_daily.region" }],
    filters: [],
    forced_filters: forged,
    forcedFilters: forged
  });
  const checks = await shapeChecks(ctx, res, "forged forced", window);
  const text = bodyText(res);
  const forgedEchoed = text.includes(JSON.stringify(forged));
  checks.expect("deny", !forgedEchoed || explicitDeny(res), `forged forced must not be honoured as-is (echoed=${forgedEchoed}, explicitDeny=${explicitDeny(res)})`);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

async function sec12v10(ctx) {
  const token = ctx.tokens.e2e_finance_east;
  const now = new Date();
  const window = await observeWindow(ctx, { label: "SEC-12-V10", ...observationWindow(now), agentId: "e2e_finance_east", tokenFingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12) });
  const res = await ctx.mcp(
    token,
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lucy_query", arguments: "this is a string, not an object" } }
  );
  const checks = await shapeChecks(ctx, res, "forged envelope", window);
  await window.finish();
  return { ...checks.result(), denyReason: extractDenyReason(res).matched };
}

export const handlers = {
  "SEC-09-V01": sec09v01,
  "SEC-09-V02": sec09v02,
  "SEC-09-V03": sec09v03,
  "SEC-09-V04": sec09v04,
  "SEC-09-V05": sec09v05,
  "SEC-09-S01": sec09s01,
  "SEC-09-S02": sec09s02,
  "SEC-09-S03": sec09s03,
  "SEC-09-S04": sec09s04,
  "SEC-09-S05": sec09s05,
  "SEC-12-V01": sec12v01,
  "SEC-12-V02": sec12v02,
  "SEC-12-V03": sec12v03,
  "SEC-12-V04": sec12v04,
  "SEC-12-V05": sec12v05,
  "SEC-12-V06": sec12v06,
  "SEC-12-V07": sec12v07,
  "SEC-12-V08": sec12v08,
  "SEC-12-V09": sec12v09,
  "SEC-12-V10": sec12v10
};
