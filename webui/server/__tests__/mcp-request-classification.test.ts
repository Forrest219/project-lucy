import { describe, expect, it } from "vitest";
import {
  isMcpHandshakeMethod,
  isMcpProtocolMethod,
  isMcpProbeMethod,
  MCP_HANDSHAKE_METHODS,
  MCP_PROBE_METHODS
} from "../proxy/usage-classification.js";

/**
 * Spec 189 — the previous version of this file asserted the exact three-element
 * array `["tools/list", "initialize", "notifications/initialized"]`, which made
 * the test pass only because the list was still that small. The list is now
 * the full protocol set, so the assertions are per-method instead: every
 * protocol method, the handshake/probe boundary, the `server/*` rule and the
 * business methods that must never be classified as protocol.
 */
describe("MCP request classification", () => {
  it("classifies every protocol method as protocol", () => {
    for (const method of [...MCP_HANDSHAKE_METHODS, ...MCP_PROBE_METHODS, "server/discover"]) {
      expect(isMcpProtocolMethod(method), `${method} must be protocol`).toBe(true);
    }
  });

  it("keeps the handshake set explicit and disjoint from the probe set", () => {
    expect([...MCP_HANDSHAKE_METHODS].sort()).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list"
    ]);
    for (const method of MCP_HANDSHAKE_METHODS) {
      expect(isMcpHandshakeMethod(method)).toBe(true);
      expect(isMcpProbeMethod(method), `${method} must not be a probe`).toBe(false);
    }
    for (const method of MCP_PROBE_METHODS) {
      expect(isMcpProbeMethod(method)).toBe(true);
      expect(isMcpHandshakeMethod(method), `${method} must not be a handshake`).toBe(false);
    }
  });

  it("treats any server/* method as protocol", () => {
    expect(isMcpProtocolMethod("server/discover")).toBe(true);
    expect(isMcpProtocolMethod("server/unknown")).toBe(true);
  });

  it("does not classify business calls as protocol", () => {
    for (const method of ["tools/call", "resources/read", "prompts/get", "sl_query", "lucy_query"]) {
      expect(isMcpProtocolMethod(method), `${method} must not be protocol`).toBe(false);
    }
  });
});
