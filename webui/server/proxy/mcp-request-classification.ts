/**
 * MCP transport-level requests that establish a session or discover tools.
 * They remain in access_log for audit and diagnostics, but do not represent
 * business usage on Agent/usage surfaces.
 *
 * Spec 189 — this file is a **compatibility re-export** of the single usage
 * classification fact source (`./usage-classification.js`). The definitions
 * live there; keeping a local copy here is exactly the drift the Spec
 * forbids. New code must import from `usage-classification.js` directly.
 */
export {
  MCP_HANDSHAKE_METHODS,
  MCP_PROBE_METHODS,
  MCP_SERVER_METHODS,
  MCP_PROTOCOL_METHODS,
  MCP_PROTOCOL_METHOD_SET,
  MCP_HANDSHAKE_METHOD_SET,
  MCP_PROBE_METHOD_SET,
  MCP_SERVER_METHOD_SET,
  MCP_SERVER_METHOD_PREFIX,
  isMcpProtocolMethod,
  isMcpHandshakeMethod,
  isMcpProbeMethod,
  protocolMethodSqlList,
  handshakeMethodSqlList,
  probeMethodSqlList,
  protocolConditionSql,
  evalProbeConditionSql,
  defaultUsageConditionSql,
  rawBusinessConditionSql
} from "./usage-classification.js";

import { MCP_PROTOCOL_METHODS } from "./usage-classification.js";

/**
 * @deprecated Spec 189 — use `protocolConditionSql()` instead. This literal
 * list cannot express the `server/*` prefix rule, so it must not be used for
 * default-usage aggregation.
 */
export const MCP_PROTOCOL_METHOD_SQL_LIST = MCP_PROTOCOL_METHODS
  .map((method) => `'${method.replaceAll("'", "''")}'`)
  .join(", ");
