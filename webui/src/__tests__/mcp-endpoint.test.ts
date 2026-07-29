import { describe, expect, it } from "vitest";
import { buildCodexMcpToml, buildMcpConfig } from "../lib/mcpEndpoint";

describe("MCP endpoint helpers", () => {
  it("builds the canonical MCP JSON config with the supplied endpoint and token placeholder", () => {
    const parsed = JSON.parse(buildMcpConfig("https://lucy.example.com/mcp"));
    expect(parsed.mcpServers.lucy).toEqual({
      type: "http",
      url: "https://lucy.example.com/mcp",
      headers: {
        Authorization: "Bearer <LUCY_AGENT_TOKEN>"
      }
    });
  });

  it("uses a caller-provided token value instead of the placeholder when given", () => {
    const parsed = JSON.parse(buildMcpConfig("https://lucy.example.com/mcp", "lucy_demo_token"));
    expect(parsed.mcpServers.lucy.headers.Authorization).toBe("Bearer lucy_demo_token");
  });

  it("builds the Codex TOML snippet with the supplied endpoint and token placeholder", () => {
    const toml = buildCodexMcpToml("https://lucy.example.com/mcp");
    expect(toml).toContain('url = "https://lucy.example.com/mcp"');
    expect(toml).toContain('type = "http"');
    expect(toml).toContain("Bearer <LUCY_AGENT_TOKEN>");
    expect(toml).toContain("[mcp_servers.lucy]");
  });

  it("inlines a real token in the Codex TOML when the caller passes one", () => {
    const toml = buildCodexMcpToml("https://lucy.example.com/mcp", "lucy_demo_token");
    expect(toml).toContain('Bearer lucy_demo_token"');
  });
});
