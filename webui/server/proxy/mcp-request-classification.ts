/**
 * MCP transport-level requests that establish a session or discover tools.
 * They remain in access_log for audit and diagnostics, but do not represent
 * business usage on Agent/usage surfaces.
 */
export const MCP_PROTOCOL_METHODS = [
  "tools/list",
  "initialize",
  "notifications/initialized"
] as const;

const protocolMethodSet = new Set<string>(MCP_PROTOCOL_METHODS);

export function isMcpProtocolMethod(method: string): boolean {
  return protocolMethodSet.has(method);
}

/** Safe SQL literal list: every value is a source-controlled constant. */
export const MCP_PROTOCOL_METHOD_SQL_LIST = MCP_PROTOCOL_METHODS
  .map((method) => `'${method.replaceAll("'", "''")}'`)
  .join(", ");
