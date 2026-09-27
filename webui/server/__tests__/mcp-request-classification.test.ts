import { describe, expect, it } from "vitest";
import { isMcpProtocolMethod, MCP_PROTOCOL_METHODS } from "../proxy/mcp-request-classification.js";

describe("MCP request classification", () => {
  it("classifies only handshake and discovery methods as protocol", () => {
    expect(MCP_PROTOCOL_METHODS).toEqual(["tools/list", "initialize", "notifications/initialized"]);
    for (const method of MCP_PROTOCOL_METHODS) expect(isMcpProtocolMethod(method)).toBe(true);
    expect(isMcpProtocolMethod("sl_query")).toBe(false);
    expect(isMcpProtocolMethod("tools/call")).toBe(false);
  });
});
