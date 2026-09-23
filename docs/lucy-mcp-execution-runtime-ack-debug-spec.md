# Lucy MCP Execution Runtime Ack & Debug Spec

| Metadata | Content |
|---|---|
| Document name | Lucy MCP Execution Runtime Ack & Debug Spec |
| Document type | Product / Architecture / Debuggability Spec |
| Version | v0.2 (reviewed) |
| Written date | 2026-09-08 |
| Scope | WebUI config writes, Policy Runtime, Catalog reload, MCP Proxy, KTX MCP execution runtime, Admin health/debug surfaces |
| Incident driver | `finbp_nbcb_funds` could see `zijin` in catalog/read_source but `lucy_query` failed because the MCP execution runtime had not loaded `connections.zijin`. |

---

## 1. Background

On 2026-09-08, `finbp_nbcb_funds` failed `lucy_query` with:

```text
Connection "zijin" is not configured in ktx.yaml.
Configured connections: fin_mysql, finance-business-landing, kc-starrocks, mysql-test, rds-test.
```

At the same time, WebUI state showed:

- `/api/project` contained `connections.zijin`.
- `/api/connections/zijin/test` passed.
- Agent / Role / Token policy allowed only `zijin` and seven authorized tables.
- `lucy_catalog` and `lucy_read_source` succeeded.

The gap is that current `runtimeAck` confirms the Lucy Policy Runtime, but does not confirm that the downstream MCP / KTX execution runtime loaded the same `ktx.yaml` and can execute a query for the newly configured connection.

## 2. Goals

- Detect when WebUI config, Policy Runtime, Catalog reload, and MCP execution runtime disagree.
- Prevent UI/API success states from implying `lucy_query` readiness before the execution layer is verified.
- Classify stale execution-runtime failures distinctly from generic `upstream_error`.
- Provide an operator-facing debug surface that identifies which layer is stale and what to restart or reload.
- Keep all checks read-only and safe for customer data environments.

## 3. Non-Goals

- Do not introduce a new policy source of truth outside `ktx.yaml`, `access.yaml`, `semantic-layer/**`, and existing runtime compilers.
- Do not read or expose `.ktx/secrets/**` contents.
- Do not automatically run broad business queries during health checks.
- Do not require browser E2E tests for normal implementation unless a task specifically changes visible UI behavior.
- Do not make WebUI create or store plaintext Agent Tokens for diagnostics.

## 4. Layer Model

Lucy must expose readiness for four separate layers:

| Layer | Question answered | Existing signal | New requirement |
|---|---|---|---|
| Config on disk | Does `/data/lucy/ktx.yaml` contain the connection/table config? | `/api/project`, `/api/connections` | Include config digest and connection ids in debug status. |
| Catalog Runtime | Does WebUI static semantic catalog see the connection and manifest? | `/api/catalog/reloads`, `/api/sources` | Keep existing reload status and expose last run per connection. |
| Policy Runtime | Does Agent / Role / Token compile to expected permissions? | `/api/admin/policy-runtime`, `runtimeAck` | Keep existing `policyRuntimeAck`. |
| Execution Runtime | Does MCP / KTX execute with the same config? | None | Add `executionRuntimeAck`, canary, and stale-config classification. |

## 5. API Contract

### 5.1 Runtime Status

Add:

```text
GET /api/admin/mcp-runtime/status
```

Response:

```ts
type McpRuntimeStatusResponse = {
  ok: true;
  data: {
    endpoint: {
      publicUrl?: string;
      upstreamHost?: string;
      upstreamPort?: number;
    };
    config: {
      projectRoot: string;
      ktxYamlDigest: string;
      connectionIds: string[];
      updatedAt?: string;
    };
    catalog: {
      lastReloadId?: string;
      lastReloadAt?: string;
      connectionIds: string[];
      lastByConnection: Record<string, {
        id: string;
        status: "success" | "failed";
        finishedAt: string;
      }>;
    };
    policy: {
      policyVersion: string;
      healthy: boolean;
      accessConfigDigest: string;
      sourceMapVersion: string;
      enabledTablesDigest: string;
    };
    execution: {
      status: "unknown" | "ok" | "stale" | "unavailable" | "error";
      lastCheckedAt?: string;
      loadedConnectionIds?: string[];
      missingConnections?: string[];
      unknownConnections?: string[];
      extraConnections?: string[];
      lastError?: string;
    };
  };
};
```

`loadedConnectionIds` is optional because older KTX versions may not expose a direct config-introspection command. In that case Lucy may treat a successful, read-only `lucy_query` observed against the current `ktx.yaml` digest as per-connection acknowledgement. A CLI subprocess such as `ktx connection test` is **not** execution-runtime acknowledgement because it starts a new process and rereads disk config.

Status aggregation is conservative:

- `unavailable`: the configured KTX MCP upstream cannot be reached within the short probe timeout.
- `error`: the upstream is reachable but the probe is rejected or malformed.
- `stale`: a current-digest execution attempt reported that a disk-present connection was not loaded.
- `ok`: every configured connection is acknowledged by runtime introspection or a successful current-digest query observation.
- `unknown`: the upstream is reachable, but one or more connections have neither positive nor stale evidence.

Execution observations are keyed by connection id and `ktxYamlDigest`. A config write invalidates evidence from older digests. Implementations may keep these observations in memory for v0.2; process restart returns them to `unknown` instead of assuming readiness.

### 5.2 Runtime Canary

Add:

```text
POST /api/admin/mcp-runtime/canary
```

Request:

```ts
type McpRuntimeCanaryRequest = {
  connectionId: string;
  agentId?: string;
  sourceName?: string;
  mode?: "connection" | "tools_list" | "catalog" | "query";
};
```

Response:

```ts
type McpRuntimeCanaryResponse = {
  ok: true;
  data: {
    connectionId: string;
    agentId?: string;
    status: "pass" | "fail" | "blocked";
    checks: Array<{
      name: "config" | "catalog" | "policy" | "execution_tools_list" | "execution_catalog" | "execution_query";
      status: "pass" | "fail" | "blocked";
      detail: string;
      durationMs?: number;
    }>;
    executionRuntimeAck: boolean;
    decisionReason?: string;
    remediation?: {
      label: string;
      detail: string;
    };
  };
};
```

The canary must not require plaintext Token unless the operator explicitly uses a live Agent Token. The default mode can use server-side internal routing where available, or stop at `blocked` with a clear message when a user-level bearer token is required.

### 5.3 Config Write Response Shape

Extend affected write responses:

```ts
type RuntimeAcks = {
  policyVersion?: string;
  policyRuntimeAck: boolean;
  catalogRuntimeAck?: boolean;
  executionRuntimeAck?: boolean;
  executionRuntimeStatus?: "unknown" | "ok" | "stale" | "unavailable" | "error";
  executionRuntimeError?: string;
};
```

Affected operations:

- `POST /api/connections`
- `PUT /api/connections/:connId/enabled-tables`
- `POST /api/catalog/assets/upload`
- `POST /api/catalog/reload`
- Agent / Role / Token writes that can affect visible MCP tools or source scope

Backwards compatibility:

- Keep existing `runtimeAck` as an alias for policy runtime until callers migrate.
- New UI surfaces must use the explicit names: `policyRuntimeAck`, `catalogRuntimeAck`, `executionRuntimeAck`.

## 6. Core Algorithm

```text
function writeConfigAndVerify(change):
  oldDisk = read current config files needed by change
  candidate = apply change to disk config
  validate candidate syntax and safety

  write candidate through auditedWriteFile

  catalogResult = reloadCatalog(scope from change)
  policyStatus = commitEffectivePolicy()

  policyRuntimeAck =
    policyStatus.policyVersion is non-empty
    and policyStatus is not globally degraded
    and policyStatus digest matches the just-written access config when access.yaml changed

  catalogRuntimeAck =
    catalogResult.status == success
    and catalogResult warnings do not include missing manifests for changed connection

  if change affects ktx.yaml connections or enabled_tables:
    executionResult = runExecutionRuntimeCanary(changed connection, mode=connection)
  else if change affects Agent / Role / Token:
    executionResult = runExecutionRuntimeCanary(agent, mode=tools_list)
  else:
    executionResult = { status: unknown, ack: undefined }

  if policyRuntimeAck is false for an access.yaml permission write:
    roll back disk to oldDisk using existing fail-closed behavior
    return failure with policyRuntimeAck=false

  if executionResult.status is stale:
    keep disk config committed
    return success with executionRuntimeAck=false and remediation restart/reload MCP execution runtime

  return success with explicit ack fields
```

```text
function runExecutionRuntimeCanary(connectionId, agentId?, mode):
  configConnections = read /api/project-equivalent connection ids from disk
  if connectionId not in configConnections:
    return fail(config_missing)

  if mode includes policy and agentId is present:
    permissions = effectivePermissions(agentId)
    if connectionId not in permissions.connections:
      return fail(policy_missing_connection)

  if a KTX config introspection command exists:
    loadedConnections = read execution runtime loaded connections
    if connectionId not in loadedConnections:
      return stale(connection_not_loaded)

  probe the configured KTX MCP upstream with a short timeout
  if upstream is unreachable:
    return unavailable

  perform the smallest safe execution check available:
    preferred: KTX runtime config introspection for connectionId
    otherwise: reuse a successful lucy_query observation only when its
               ktxYamlDigest equals the current disk digest
    optional: operator-triggered minimal read-only query canary

  never treat a fresh `ktx connection test` CLI subprocess, `tools/list`,
  `lucy_catalog`, or `lucy_read_source` success as connection execution ack;
  those paths do not prove the resident KTX MCP query runtime loaded connectionId

  if error text matches 'Connection "<id>" is not configured in ktx.yaml'
    and disk config contains <id>:
      return stale(connection_not_loaded)

  if no connection-level proof is available:
      return blocked(execution_canary_blocked)

  return ok
```

## 7. Error Classification

Add normalized decision reasons for execution-layer stale config:

| Reason | When |
|---|---|
| `execution_config_stale` | Disk config contains the connection, but MCP / KTX execution reports it missing. |
| `execution_connection_not_loaded` | Execution runtime loaded connection list is available and lacks the requested connection. |
| `execution_runtime_unavailable` | MCP / KTX endpoint is unreachable or times out. |
| `execution_canary_blocked` | A live Agent Token or required runtime introspection capability is unavailable. |

When the upstream error matches:

```text
Connection "<connectionId>" is not configured in ktx.yaml
```

the proxy should check current disk config. If disk config contains `<connectionId>`, audit `decision_reason` must be `execution_config_stale` rather than generic `upstream_error`.

## 8. UI Requirements

Connection Overview and MCP Debug Console should show separate state chips:

- `Config`: ready / missing
- `Catalog`: ready / warnings / failed
- `Policy Runtime`: acknowledged / degraded
- `MCP Execution`: acknowledged / stale / unavailable / unchecked

For `executionRuntimeAck=false`, show operator copy:

```text
配置已写入，但 MCP 执行层尚未确认加载。请重启或 reload MCP 执行进程后重新检测。
```

Actions:

- `重新检测执行层`
- `查看最近失败日志`
- `打开 MCP 调试台`

Do not show secret paths beyond already-redacted `passwordSource=file`.

## 9. Observability Requirements

Audit rows must include:

- Existing `policyVersion` and `capabilityDigest`.
- New execution runtime status when known.
- Normalized `decisionReason` for stale execution config.
- A remediation hint in Admin UI, not in raw business tool output.

Trace / evidence events should record canary checks as operational spans without storing result rows or plaintext tokens.

## 10. Acceptance Criteria

| ID | Scenario | Expected |
|---|---|---|
| AC-1 | `ktx.yaml` contains `zijin`, execution runtime lacks it, `lucy_query` fails with connection missing | Audit reason is `execution_config_stale`; UI explains restart/reload MCP execution runtime. |
| AC-2 | Create a new connection through WebUI | Response includes `policyRuntimeAck`, `catalogRuntimeAck`, and either proven `executionRuntimeAck=true` or `executionRuntimeAck=false` with a clear `blocked` reason; a standalone connection test cannot produce the positive ack. |
| AC-3 | Enable tables for a connection | Catalog reload remains scoped, Policy Runtime recompiles, execution canary runs for that connection. |
| AC-4 | KTX endpoint is down | `/api/admin/mcp-runtime/status` returns `execution.status=unavailable`; `/api/health` surfaces degraded execution detail without hiding existing policy state. |
| AC-5 | Agent Role lacks connection | Canary fails as policy/config mismatch, not execution stale. |
| AC-6 | No plaintext Token is supplied | Live MCP tools/list/query canary is `blocked`, but disk/policy/catalog checks still return. |
| AC-7 | Upstream connection genuinely missing from disk | Reason remains config missing / unknown connection, not stale execution config. |

## 11. Implementation Notes

Likely touch points:

- `webui/server/index.ts`: connection create, enabled-tables write, health response.
- `webui/server/admin/access-config.ts`: Agent / Role / Token write ack response naming.
- `webui/server/admin/mcp-playground.ts`: reuse live-smoke patterns, but separate canary from playground-only tools/list.
- `webui/server/proxy/mcp-proxy.ts`: classify stale connection errors during response buffering.
- `webui/server/proxy/acl.ts`: preserve existing Policy Runtime semantics.
- `webui/src/pages/connections/ConnectionOverview.tsx`: show execution status for connection-scoped operations.
- `webui/src/pages/admin/McpPlayground.tsx`: add execution canary status and remediation.
- `webui/src/lib/types.ts`: add explicit ack/status types.

## 12. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `MCP Execution Runtime`: the downstream MCP / KTX runtime that actually executes `lucy_query`.
- `executionRuntimeAck`: API field indicating whether the MCP execution runtime has acknowledged the relevant config.

UI copy must keep `MCP`、`KTX`、`Runtime`、`Agent`、`Role`、`Token`、`Catalog`、`Schema`、`Manifest`、`ktx.yaml` as protected technical terms with `notranslate` / `translate="no"` where rendered in DOM.

## 13. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Canary query touches customer data | Compliance concern | Default to config/connection checks; query canary must be minimal, read-only, and operator-triggered. |
| Standalone CLI rereads fresh config and masks a stale daemon | False positive acknowledgement | Never derive `executionRuntimeAck` from `ktx connection test`; require resident-runtime introspection or a current-digest query observation. |
| Runtime introspection is unavailable in current KTX | False unknown state | Return `blocked` or `unknown`; still classify observed stale errors from actual failures. |
| Config write becomes slow | Admin UX latency | Run heavy live canary asynchronously where needed; synchronous response may return `executionRuntimeAck=unknown`. |
| Restart/reload action is deployment-specific | Unsafe automation | v0.1 recommends remediation text only; automatic restart is out of scope. |
| Duplicate health meanings confuse users | Bad operations | Rename fields explicitly: `policyRuntimeAck` vs `executionRuntimeAck`. |

## 14. Rollout Plan

1. Add backend status/canary service and unit tests.
2. Add stale upstream error classification in MCP Proxy and audit tests.
3. Extend write responses with explicit ack fields while preserving `runtimeAck`.
4. Add UI chips/remediation copy in Connection Overview and MCP Debug Console.
5. Update operator docs and release notes.
6. Use `finbp_nbcb_funds` / `zijin` as the regression scenario in staging.
