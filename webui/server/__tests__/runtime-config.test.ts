import { describe, expect, it } from "vitest";
import { LOCAL_MCP_ENDPOINT, resolveMcpEndpoint } from "../runtime-config";

describe("resolveMcpEndpoint", () => {
  it("uses LUCY_PUBLIC_MCP_URL when it is a valid public endpoint", () => {
    expect(resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp" })).toEqual({
      url: "https://lucy.example.com/mcp",
      status: "configured",
      source: "env",
      configured: true,
      diagnostics: []
    });
  });

  it("falls back to the local development endpoint when env is missing", () => {
    expect(resolveMcpEndpoint({}).status).toBe("fallback");
    expect(resolveMcpEndpoint({}).url).toBe(LOCAL_MCP_ENDPOINT);
    expect(resolveMcpEndpoint({}).source).toBe("fallback");
    expect(resolveMcpEndpoint({}).configured).toBe(false);
    expect(resolveMcpEndpoint({}).diagnostics.map((d) => d.code)).toContain("MISSING_PUBLIC_MCP_URL");
  });

  it("treats whitespace-only env as missing", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "   " });
    expect(result.status).toBe("fallback");
    expect(result.url).toBe(LOCAL_MCP_ENDPOINT);
  });

  it("returns invalid state for malformed env values", () => {
    expect(resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "not-a-url" })).toMatchObject({
      url: null,
      status: "invalid",
      source: "env",
      configured: false
    });
  });

  it("rejects unsupported URL protocols", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "ftp://lucy.example.com/mcp" });
    expect(result.status).toBe("invalid");
    expect(result.url).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain("UNSUPPORTED_PUBLIC_MCP_PROTOCOL");
  });

  it("keeps configured status but emits a diagnostic when path is not /mcp", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/agent" });
    expect(result.status).toBe("configured");
    expect(result.configured).toBe(true);
    expect(result.diagnostics.map((item) => item.code)).toContain("MCP_PATH_RECOMMENDED");
  });

  it("treats a trailing-slash /mcp/ as the recommended /mcp path", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp/" });
    expect(result.status).toBe("configured");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("MCP_PATH_RECOMMENDED");
  });

  it("accepts path-prefix deployments that still end with /mcp", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/lucy/mcp//" });
    expect(result.status).toBe("configured");
    expect(result.url).toBe("https://lucy.example.com/lucy/mcp//");
    expect(result.diagnostics.map((item) => item.code)).not.toContain("MCP_PATH_RECOMMENDED");
  });

  it("normalizes the host and protocol of the configured URL", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "HTTPS://Lucy.Example.COM/mcp" });
    expect(result.status).toBe("configured");
    expect(result.url).toBe("https://lucy.example.com/mcp");
  });

  it("emits an INVALID_PUBLIC_MCP_URL diagnostic with a human-readable message", () => {
    const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "://broken" });
    expect(result.status).toBe("invalid");
    const diagnostic = result.diagnostics.find((d) => d.code === "INVALID_PUBLIC_MCP_URL");
    expect(diagnostic?.message).toMatch(/absolute URL/i);
  });
});
