export type McpEndpointStatus = "configured" | "fallback" | "invalid";

export type McpEndpointDiagnosticCode =
  | "MISSING_PUBLIC_MCP_URL"
  | "INVALID_PUBLIC_MCP_URL"
  | "UNSUPPORTED_PUBLIC_MCP_PROTOCOL"
  | "MCP_PATH_RECOMMENDED";

export type McpEndpointDiagnostic = {
  code: McpEndpointDiagnosticCode;
  message: string;
};

export type McpEndpointInfo = {
  url: string | null;
  status: McpEndpointStatus;
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: McpEndpointDiagnostic[];
};

export const LOCAL_MCP_ENDPOINT = "http://127.0.0.1:7879/mcp";

type RuntimeEnv = Partial<Pick<NodeJS.ProcessEnv, "LUCY_PUBLIC_MCP_URL">>;

function normalizedPathname(pathname: string): string {
  // Strip trailing slashes so that `/mcp/` does not raise a false
  // `MCP_PATH_RECOMMENDED` diagnostic. This is the trailing-slash tolerance
  // the spec requires.
  return pathname.replace(/\/+$/, "");
}

export function resolveMcpEndpoint(env: RuntimeEnv = process.env): McpEndpointInfo {
  const raw = env.LUCY_PUBLIC_MCP_URL?.trim();
  if (!raw) {
    return {
      url: LOCAL_MCP_ENDPOINT,
      status: "fallback",
      source: "fallback",
      configured: false,
      diagnostics: [
        {
          code: "MISSING_PUBLIC_MCP_URL",
          message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
        }
      ]
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: null,
      status: "invalid",
      source: "env",
      configured: false,
      diagnostics: [
        {
          code: "INVALID_PUBLIC_MCP_URL",
          message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
        }
      ]
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      url: null,
      status: "invalid",
      source: "env",
      configured: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_PUBLIC_MCP_PROTOCOL",
          message: "LUCY_PUBLIC_MCP_URL must use http or https."
        }
      ]
    };
  }

  const diagnostics: McpEndpointDiagnostic[] = [];
  if (!normalizedPathname(parsed.pathname).endsWith("/mcp")) {
    diagnostics.push({
      code: "MCP_PATH_RECOMMENDED",
      message: "Lucy MCP endpoints should normally end with /mcp."
    });
  }

  return {
    url: parsed.toString(),
    status: "configured",
    source: "env",
    configured: true,
    diagnostics
  };
}
