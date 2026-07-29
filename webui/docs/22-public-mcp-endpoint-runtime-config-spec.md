# Public MCP Endpoint Runtime Config Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Public MCP Endpoint Runtime Config Spec |
| 文档类型 | Product / Runtime / API Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-30 |
| 适用范围 | Lucy WebUI 与 Agent 接入配置：`/onboarding`、`/connections`、`/admin/agents`、Token 首秀、MCP config 复制 |
| 架构决议 | MCP endpoint 是部署/runtime 配置，不是前端页面推断结果；所有 UI 与配置片段必须从同一个后端 runtime 字段读取 |
| 事实源 | `LUCY_PUBLIC_MCP_URL`；未配置时的本地开发 fallback；未来可扩展为 runtime config file |
| 关联文档 | `webui/docs/07-mcp-auth-proxy-spec.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`docs/agent-integration-guide.md`、`docs/deployment-docker.md`、`docs/customer-deployment-guide.md` |

## 1. 决策摘要

Lucy 当前多个页面各自决定 MCP endpoint：

- `/onboarding` 根据浏览器 `window.location.hostname` 拼 `:7879/mcp`。
- `/connections` 写死 `http://127.0.0.1:7879/mcp`。
- Agent Admin 与 Token 首秀页面写死 `http://localhost:7879/mcp`。
- 文档与测试中同时存在 `localhost`、`127.0.0.1`、`<host>:7879` 等口径。

这些写法在本地开发环境里通常都能工作，但在客户部署、二级域名、反向代理、内网网关、PaaS、K8s、Docker Compose 或裸机 systemd 等场景中会产生错误配置。WebUI 的访问地址不一定等于 Agent 可访问的 MCP endpoint；服务监听端口也不一定等于外部发布 URL。

因此本规格作出产品级决议：

1. Lucy 增加统一的 Public MCP Endpoint runtime 配置。
2. `LUCY_PUBLIC_MCP_URL` 是部署方式无关的对外 MCP endpoint 配置项。
3. 后端 API 返回唯一 endpoint 事实源。
4. 所有前端页面和 MCP config 片段只消费后端返回值。
5. 前端不得再根据 WebUI host、`localhost`、`127.0.0.1` 或硬编码端口推断 endpoint。

## 2. 设计原则

### 2.1 部署方式无关

`LUCY_PUBLIC_MCP_URL` 不是 K8s 专属配置。它适用于所有部署方式：

- Docker Compose
- K8s / Helm
- 裸机 systemd
- VM + Nginx/Caddy/Apache
- 企业内网网关
- PaaS / 私有云
- 本地开发

部署方式只决定如何注入这个值；Lucy 产品内部只关心最终的 public MCP URL。

### 2.2 区分监听地址与发布地址

Lucy MCP Proxy 的内部监听地址由现有变量控制：

```text
LUCY_PROXY_HOST
LUCY_PROXY_PORT
```

Agent 用户实际配置的 endpoint 由新增变量控制：

```text
LUCY_PUBLIC_MCP_URL
```

两者不能混用。

示例：

| 类型 | 示例 | 含义 |
|---|---|---|
| 内部监听地址 | `0.0.0.0:7879` | Lucy proxy 在容器/主机内监听 |
| Service 地址 | `lucy-mcp.default.svc.cluster.local:7879` | 部署平台内部转发 |
| Public endpoint | `https://lucy.example.com/mcp` | Agent 平台实际配置 |

WebUI 展示和复制的必须是 public endpoint。

### 2.3 不从 WebUI URL 推断 MCP URL

以下信息只能作为人类排障参考，不能作为 endpoint 事实源：

- `window.location.hostname`
- browser 当前 URL
- HTTP `Host` header
- WebUI public URL
- `X-Forwarded-Host`
- `X-Forwarded-Proto`

原因：

1. WebUI 与 MCP 可能是不同域名。
2. WebUI 与 MCP 可能是同域不同 path。
3. WebUI 与 MCP 可能是同域不同端口。
4. MCP 可能经过额外网关、鉴权层或 Agent 专用入口。
5. 当前页面 host 无法证明 Agent 所在环境可访问。

## 3. Runtime 配置模型

新增后端模型：

```ts
export type McpEndpointStatus = "configured" | "fallback" | "invalid";

export type McpEndpointInfo = {
  url: string | null;
  status: McpEndpointStatus;
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: Array<{
    code: "MISSING_PUBLIC_MCP_URL" | "INVALID_PUBLIC_MCP_URL" | "UNSUPPORTED_PUBLIC_MCP_PROTOCOL" | "MCP_PATH_RECOMMENDED";
    message: string;
  }>;
};
```

### 3.1 配置优先级

v0.1 优先级：

1. `LUCY_PUBLIC_MCP_URL`
2. 本地开发 fallback：`http://127.0.0.1:7879/mcp`

未来可扩展：

1. `LUCY_PUBLIC_MCP_URL`
2. 部署 runtime config file，例如 `webui/config/runtime.yaml`
3. 本地开发 fallback

本规格不要求 v0.1 实现 runtime config file。

### 3.2 状态语义

| 状态 | 条件 | `url` | UI 行为 |
|---|---|---|---|
| `configured` | `LUCY_PUBLIC_MCP_URL` 存在且合法 | 配置值 | 正常展示和复制 |
| `fallback` | 未配置 `LUCY_PUBLIC_MCP_URL` | `http://127.0.0.1:7879/mcp` | 展示本地默认，并提示客户部署需配置 public endpoint |
| `invalid` | `LUCY_PUBLIC_MCP_URL` 存在但非法 | `null` | 不生成可复制 config，提示修复 runtime 配置 |

### 3.3 校验规则

`LUCY_PUBLIC_MCP_URL` 必须满足：

- 非空字符串。
- 可被 `new URL(...)` 解析。
- protocol 为 `http:` 或 `https:`。

建议但不强制：

- pathname 去掉末尾斜杠后以 `/mcp` 结尾。

如果 pathname 去掉末尾斜杠后不以 `/mcp` 结尾，状态仍可为 `configured`，但返回 diagnostic：

```text
MCP_PATH_RECOMMENDED
```

例如 `https://lucy.example.com/mcp/` 是可接受的，不应触发该 diagnostic，且 Lucy 不应擅自改写用户配置的 URL。原因：部分企业网关可能通过不同 path 暴露 MCP，但 Lucy 默认文档与客户端配置约定 `/mcp`。

## 4. API 契约

v0.1 复用 `GET /api/project`，在现有 `ProjectInfo` 中增加字段：

```ts
export type ProjectInfo = {
  root: string;
  connections: ConnectionInfo[];
  ktxAvailable: boolean;
  mcpEndpoint: McpEndpointInfo;
};
```

成功响应示例：

```json
{
  "ok": true,
  "data": {
    "root": "/data/lucy",
    "connections": [],
    "ktxAvailable": true,
    "mcpEndpoint": {
      "url": "https://lucy.example.com/mcp",
      "status": "configured",
      "source": "env",
      "configured": true,
      "diagnostics": []
    }
  }
}
```

本地 fallback 示例：

```json
{
  "mcpEndpoint": {
    "url": "http://127.0.0.1:7879/mcp",
    "status": "fallback",
    "source": "fallback",
    "configured": false,
    "diagnostics": [
      {
        "code": "MISSING_PUBLIC_MCP_URL",
        "message": "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
      }
    ]
  }
}
```

非法配置示例：

```json
{
  "mcpEndpoint": {
    "url": null,
    "status": "invalid",
    "source": "env",
    "configured": false,
    "diagnostics": [
      {
        "code": "INVALID_PUBLIC_MCP_URL",
        "message": "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
      }
    ]
  }
}
```

## 5. 前端使用规则

### 5.1 共享工具

新增前端 helper：

```ts
export function buildMcpConfig(endpoint: string, tokenPlaceholder = "<LUCY_AGENT_TOKEN>"): string;
export function buildCodexMcpToml(endpoint: string, token: string): string;
```

所有页面必须使用共享 helper。不得在页面组件里重复拼 JSON/TOML config。

### 5.2 页面改造

| 页面 | 当前问题 | 新行为 |
|---|---|---|
| `/onboarding` | 根据 browser hostname 拼 endpoint | 读取 `project.mcpEndpoint` |
| `/connections` | 写死 `127.0.0.1` | 读取 `project.mcpEndpoint` |
| `/admin/agents` | 写死 `localhost` 安全模板 | 读取 `project.mcpEndpoint` |
| Token 首秀 | 写死 `localhost` 并嵌入 token | 读取 `project.mcpEndpoint` |

### 5.3 状态表达

`configured`：

- 正常展示 endpoint。
- 允许复制 endpoint。
- 允许复制 MCP config。

`fallback`：

- 展示本地默认 endpoint。
- 允许本地开发复制。
- 在 onboarding 和 admin token 页面显示提示：

```text
当前使用本地默认 MCP endpoint。客户部署请配置 LUCY_PUBLIC_MCP_URL，避免 Agent 复制到只能在本机访问的地址。
```

`invalid`：

- 不展示可复制 config。
- 禁用复制按钮或显示错误态。
- 展示 diagnostic message。

## 6. 配置片段规范

MCP JSON：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "<PUBLIC_MCP_ENDPOINT>",
      "headers": {
        "Authorization": "Bearer <LUCY_AGENT_TOKEN>"
      }
    }
  }
}
```

Codex TOML：

```toml
[mcp_servers.lucy]
url = "<PUBLIC_MCP_ENDPOINT>"
type = "http"
headers = { Authorization = "Bearer <LUCY_AGENT_TOKEN>" }
```

`<PUBLIC_MCP_ENDPOINT>` 必须来自后端 `mcpEndpoint.url`。

## 7. Out Of Scope

- 不实现 MCP endpoint 生命周期管理 UI。
- 不自动创建 DNS、Ingress、Nginx 或 TLS 配置。
- 不从 WebUI URL 自动生成 public endpoint。
- 不测试外部公网可达性。
- 不新增 OAuth / Cloudflare Access / 企业网关集成。
- 不改变 Lucy MCP Proxy 的实际监听端口。
- 不改变 KTX upstream `:7878` 与 Lucy proxy `:7879` 的内部转发关系。

## 8. 验收标准

- `GET /api/project` 返回 `mcpEndpoint`。
- 设置 `LUCY_PUBLIC_MCP_URL=https://lucy.example.com/mcp` 后，所有相关页面展示和复制该 URL。
- 未设置 `LUCY_PUBLIC_MCP_URL` 时，本地开发仍展示 `http://127.0.0.1:7879/mcp`，但 UI 标记为 fallback。
- 设置非法 `LUCY_PUBLIC_MCP_URL` 时，页面不生成可复制 MCP config，并展示诊断。
- 前端页面内不再存在散落的 MCP endpoint 常量。
- `/onboarding` 不再使用 `window.location.hostname` 推断 MCP endpoint。
- `/connections`、Agent Admin、Token 首秀不再写死 `localhost` 或 `127.0.0.1`。
- 定向测试通过：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/new-token.test.tsx
```

- 后端测试通过：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/runtime-config.test.ts server/__tests__/project.test.ts
```

- 构建通过：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

## 9. 实施工单

实施按 [wo-M18-public-mcp-endpoint-runtime-config.md](plans/wo-M18-public-mcp-endpoint-runtime-config.md) 执行。
