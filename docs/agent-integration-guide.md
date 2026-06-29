# Lucy Agent Integration Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Agent Integration Guide |
| 文档类型 | Product / Integration Guide |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | Codex、Claude Code、Claude Desktop 或通用 HTTP MCP client 接入 Lucy |

## 1. Endpoint

Default Docker customer MCP endpoint:

```text
http://<host>:7879/mcp
```

For local demo smoke:

```text
http://127.0.0.1:57881/mcp
```

## 2. Authentication

Agents must send:

```http
Authorization: Bearer <LUCY_AGENT_TOKEN>
```

Token rules:

- Token plaintext is shown once.
- Store it in the agent platform secret store.
- Rotate if leaked or unused.
- Do not use `KTX_INTERNAL_TOKEN`.

## 3. Generic MCP Config

```json
{
  "mcpServers": {
    "lucy": {
      "url": "http://<host>:7879/mcp",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

For the headless customer delivery, generate or provision this config from deployment records and the agent platform secret store. WebUI onboarding is an optional repository UI surface, not the standard customer integration path.

## 4. Expected Tools

Typical allowed tools:

- `kx_catalog`
- `sl_query`
- `sl_read_source`
- `wiki_search`
- `entity_details`

Globally denied tools:

- `sql_execution`
- `memory_ingest`
- `memory_ingest_status`

## 5. Smoke Test

Use the demo gate to verify the full agent path:

```bash
npm run smoke:p0:demo
```

It initializes an MCP session, lists tools, calls `sl_read_source`, and runs `sl_query` through Lucy MCP Proxy.
