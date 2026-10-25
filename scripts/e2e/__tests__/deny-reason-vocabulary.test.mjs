// The harness must recognise the denials the product ACTUALLY emits.
//
// The product's deny vocabulary is documented on `AclDecision.reason`
// (webui/server/proxy/acl.ts): most reasons carry a `:detail` suffix
// (`table_forbidden:<table>`, `explicit_table_required:<table>`,
// `role_resolution_failed:<roleId>`) and the outward message appends a hint that is
// separated by a SPACE ("table_forbidden:analytics.x 可用连接：fin-db。 可用来源：…").
//
// The harness used to (a) require the WHOLE tail after "Access denied: " to be a single
// token, so a space-separated hint made the reason unparseable, and (b) match the
// allowlist EXACTLY, so every class+detail form never matched. Both turned perfectly
// good product denials into "not a recognized denial envelope" (mcp_iserror_unmatched_reason).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { denyReasonMatches, explicitDeny, extractDenyReason, measureValue } from "../security/context.mjs";

/** An MCP tools/call envelope the product returns for a policy denial. */
const mcpDeny = (text) => ({
  status: 200,
  json: { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text }] } },
  text
});

describe("the harness recognises the deny reasons the product really emits", () => {
  it("a class+detail reason followed by a space-separated hint is a recognised deny", () => {
    const res = mcpDeny(
      "Access denied: table_forbidden:analytics.brand_new_unentitled_table 可用连接：fin-db。 可用来源：marketing_daily、orders_masked。 请改用当前角色已授权的来源：marketing_daily、orders_masked。"
    );
    const extracted = extractDenyReason(res);
    assert.equal(extracted.matched, "table_forbidden:analytics.brand_new_unentitled_table");
    assert.equal(extracted.source, "mcp_iserror_access_denied");
    assert.equal(explicitDeny(res), true);
    // A case that demands the CLASS still matches (the reason contains it).
    assert.equal(denyReasonMatches(res, "table_forbidden"), true);
  });

  it("every class the product documents is recognised, with and without a detail suffix", () => {
    const classes = [
      "tool_forbidden",
      "tool_forbidden_global",
      "tool_unclassified:entity_details",
      "tool_absolute_deny:sl_query",
      "agent_disabled",
      "raw_query_forbidden",
      "query_concurrency_exceeded",
      "explicit_table_required:analytics.orders",
      "explicit_table_required:<empty>",
      "sensitive_metadata_forbidden:kx",
      "unknown_or_forbidden_connection:fin-db",
      "role_resolution_failed:finance_reader",
      "source_map_compile_failed:bad_field",
      "table_forbidden:analytics.orders",
      "policy_degraded_deny",
      "wiki_forbidden",
      "row_policy_upstream_unproven",
      "context_not_available"
    ];
    for (const reason of classes) {
      const res = mcpDeny(`Access denied: ${reason}`);
      assert.equal(explicitDeny(res), true, `the product's reason "${reason}" must be recognised as a deny`);
    }
  });

  it("a bare class with no detail is still recognised", () => {
    assert.equal(explicitDeny(mcpDeny("Access denied: role_resolution_failed")), true);
    assert.equal(explicitDeny(mcpDeny("Access denied: tool_absolute_deny:sl_query")), true);
  });

  it("a JSON-RPC 403 carrying the product's message shape is recognised", () => {
    const res = { status: 403, json: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Access denied: role_resolution_failed" } }, text: "" };
    assert.equal(explicitDeny(res), true);
    assert.equal(denyReasonMatches(res, "role_resolution_failed"), true);
  });

  it("a validation error is NOT a deny, and an unknown reason is still not a deny", () => {
    // What the product returns for an invalid request shape.
    assert.equal(explicitDeny(mcpDeny("Invalid arguments: invalid_arguments:lucy_query:dimensions_items_must_be_objects")), false);
    assert.equal(explicitDeny(mcpDeny("Access denied: something_the_product_never_emits")), false);
    // A successful result is not a deny.
    assert.equal(explicitDeny({ status: 200, json: { result: { isError: false, content: [{ type: "text", text: "{}" }] } }, text: "{}" }), false);
    // A 5xx is never a deny.
    assert.equal(explicitDeny({ status: 503, json: null, text: "unavailable" }), false);
  });

  it("matching a SPECIFIC reason still demands that exact reason", () => {
    const res = mcpDeny("Access denied: table_forbidden:analytics.orders 可用来源：orders_masked。");
    assert.equal(denyReasonMatches(res, "table_forbidden"), true);
    assert.equal(denyReasonMatches(res, "explicit_table_required"), false, "a different class must not satisfy the expectation");
    const absolute = mcpDeny("Access denied: tool_absolute_deny:sl_query");
    assert.equal(denyReasonMatches(absolute, "tool_absolute_deny:sl_query"), true);
    assert.equal(denyReasonMatches(absolute, "tool_absolute_deny:sl_read_source"), false);
  });
});

describe("the gold binder reads the aggregate out of the CURRENT response envelope", () => {
  const envelope = (headers, rows) => ({ headers, rows });

  it("the measure column is located by name when the caller knows what it asked for", () => {
    // The product answers `{ headers, rows }` with the dimension columns first.
    const parsed = envelope(["region", "order_count"], [["East", "16"]]);
    assert.equal(measureValue(parsed, ["order_count"]), 16);
    assert.equal(measureValue(parsed, ["cac_cents"]), null, "a measure that was not asked for must not be guessed");
  });

  it("without a name the last column (the measure) is used", () => {
    assert.equal(measureValue(envelope(["region", "order_count"], [["East", "16"]])), 16);
  });

  it("a missing or non-numeric measurement is null, never a guess", () => {
    assert.equal(measureValue(null), null);
    assert.equal(measureValue(envelope(["region"], [])), null);
    assert.equal(measureValue(envelope(["region", "order_count"], [["East", null]])), null);
    assert.equal(measureValue(envelope(["region", "order_count"], [["East", "n/a"]])), null);
    assert.equal(measureValue({ rows: [["x"]] }), null);
  });
});
