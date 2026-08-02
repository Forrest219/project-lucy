// Shared helpers for building ready-to-paste MCP config snippets.
//
// All WebUI surfaces (`/onboarding`, `/connections`, `/admin/agents`,
// token first-show) must consume the `mcpEndpoint.url` value returned by
// `GET /api/project` rather than hard-coding or browser-deriving an
// endpoint. These helpers take the endpoint (and optionally a token) and
// produce the canonical JSON / TOML fragments that the user copies into
// their Agent platform.

export const MCP_TOKEN_PLACEHOLDER = "<LUCY_AGENT_TOKEN>";

export function buildMcpConfig(endpoint: string, tokenPlaceholder: string = MCP_TOKEN_PLACEHOLDER): string {
  return JSON.stringify(
    {
      mcpServers: {
        lucy: {
          type: "http",
          url: endpoint,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    },
    null,
    2
  );
}

export function buildCodexMcpToml(endpoint: string, tokenPlaceholder: string = MCP_TOKEN_PLACEHOLDER): string {
  return [
    "# In ~/.codex/config.toml",
    "[mcp_servers.lucy]",
    `url = "${endpoint}"`,
    'type = "http"',
    `headers = { Authorization = "Bearer ${tokenPlaceholder}" }`
  ].join("\n");
}
