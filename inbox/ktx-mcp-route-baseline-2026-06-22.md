# KTX MCP Route Baseline

| Item | Value |
|---|---|
| Generated at | 2026-06-22 15:11:49 CST |
| Purpose | A0 version / route alignment baseline for KTX MCP usage improvement |
| Status | Baseline captured; no runtime configuration changed |

## Conclusion

The current `project-lucy` Claude Code MCP configuration points directly to KTX:

```json
{
  "mcpServers": {
    "ktx": {
      "type": "http",
      "url": "http://localhost:7878/mcp"
    }
  }
}
```

This means the observed heavy KTX MCP traffic for this project should be treated as direct-to-KTX
traffic unless a separate client-specific route proves otherwise. Lucy proxy `:7879` may exist, but
the current project configuration does not route through it.

Implication for A4: a Lucy MCP Proxy cache cannot reduce this project's KTX MCP call volume until
the heavy client path is explicitly routed through the proxy.

## Captured Facts

| Check | Result |
|---|---|
| `which ktx` | `/Users/forrest/.local/node-current/bin/ktx` |
| `ktx --version` | `@kaelio/ktx 0.12.0` |
| `which claude` | `/Users/forrest/.local/bin/claude` |
| `claude --version` | `2.1.185 (Claude Code)` |
| KTX source clone | `/Users/forrest/Projects/ktx/ktx` |
| KTX branch | `main` |
| KTX commit | `e550091a7631a119c6a2589ee282f7c79946deaf` |
| KTX remote | `https://github.com/Kaelio/ktx.git` |
| Project MCP KTX URL | `http://localhost:7878/mcp` |

## Tool Schema Notes

These facts are based on local KTX source inspection:

- MCP `sql_execution` uses `maxRows`, default `1000`, max `10000`.
- Ingest warehouse verification `sql_execution` uses `rowLimit`, default `100`, max `1000`.
- Therefore `maxRows` vs `rowLimit` is a two-surface distinction, not by itself a version drift
  finding.
- MCP `entity_details` is described as reading table and column metadata from the latest live
  database scan snapshot.
- MCP `dictionary_search` is the tool described for profile-sampled warehouse values.
- MCP `discover_data` description does not explicitly instruct the model to follow up with
  `sl_read_source` or `entity_details`.

Live `tools/list` was not captured in this baseline because the local MCP endpoints require a valid
KTX MCP bearer token. Earlier unauthenticated probes returned `401`, so source inspection is the
schema basis for this document.

## Access / Proxy Notes

`webui/config/access.yaml` currently models proxy-side tools and policies, including `kx_catalog`.
That does not make `kx_catalog` visible to a direct KTX client configured as `http://localhost:7878/mcp`.

For prompt or runtime guidance, the practical rule is:

- Direct KTX clients can only be instructed to use tools actually exposed by their KTX MCP server.
- Proxy-only tools and proxy-side cache behavior require the client to route through the proxy.

## Development Gate

This baseline supports entering A1 weekly usage reporting work immediately.

It does not clear A4 proxy cache implementation by itself. Before A4 development, the route decision
must be explicit:

1. Either keep heavy clients direct to KTX and accept that proxy cache will not affect them.
2. Or route selected clients through Lucy proxy and then validate auth, ACL, audit, and cache behavior
   on the real traffic path.
