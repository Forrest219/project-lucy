# Lucy Agent Integration Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Agent Integration Guide |
| 文档类型 | Product / Integration Guide |
| 版本 | v0.2 |
| 撰写日期 | 2026-06-22；v0.2 更新 2026-07-06（推荐 R1 lucy_* 工具面） |
| 适用范围 | Codex、Claude Code、Claude Desktop 或通用 HTTP MCP client 接入 Lucy |

## 1. Endpoint

Agents consume Lucy as a governed MCP runtime. Lucy compiles customer data context into semantic, knowledge, query, quality, and access assets, then exposes only the tools allowed for the agent's token/role.

> 🔑 **M18 起，Agent 实际配置的 endpoint 统一从 Lucy WebUI 复制。** 部署方通过 `LUCY_PUBLIC_MCP_URL` 把对外可访问的 MCP URL 注入到运行实例（`GET /api/project.mcpEndpoint.url`），WebUI 的 `/onboarding`、`/connections`、`/admin/agents`、Token 首秀页面会展示并允许复制这个值。前端不再根据浏览器 host、容器端口或 `localhost` 推断 endpoint。

客户部署里 Agent 实际配置的 URL：

```text
<LUCY_PUBLIC_MCP_URL>      # 例如 https://lucy.example.com/mcp
```

本地开发与 Docker demo 仍可使用容器内监听地址作为示例，但**不能**作为生产环境给 Agent 的接入点：

```text
http://127.0.0.1:7879/mcp        # 本地开发 / 容器内 listen
http://127.0.0.1:57881/mcp       # Docker demo 烟测端口（仅烟测）
```

> `LUCY_PROXY_HOST` / `LUCY_PROXY_PORT` 只控制容器内/主机内的 MCP Proxy 监听地址。客户/Agent 真正访问的 URL 必须由 `LUCY_PUBLIC_MCP_URL` 单独指定，两者**不能**互相替代。

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
      "url": "<LUCY_PUBLIC_MCP_URL>",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

`<LUCY_PUBLIC_MCP_URL>` 替换为部署方在 `LUCY_PUBLIC_MCP_URL` 里设置并由 WebUI 展示的值。`/onboarding`、`/admin/agents`、`/admin/agents/:userId/tokens/new` 页面都提供「一键复制 JSON / Codex TOML」按钮，复制内容**永远**读取后端 runtime 字段，不会拼凑 `localhost` / `127.0.0.1` / 浏览器 host。

For the headless customer delivery, generate or provision this config from deployment records and the agent platform secret store. WebUI onboarding is an optional repository UI surface, not the standard customer integration path.

## 4. Expected Tools

R1 tokens should prefer the stable Lucy tool surface:

- `lucy_catalog`
- `lucy_read_source`
- `lucy_query`
- `lucy_explain_query`
- `lucy_freshness`
- `lucy_begin_question`

Some legacy or compatibility tokens may still expose older upstream-oriented tools such as `kx_catalog`, `sl_query`, `sl_read_source`, `wiki_search`, or `entity_details`. New integrations should treat those as compatibility surface, not the preferred product contract.

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

For R1 contract validation, use the relevant `lucy_*` endpoint smoke or contract smoke so the evidence proves the governed MCP runtime surface, not only legacy tool forwarding.
