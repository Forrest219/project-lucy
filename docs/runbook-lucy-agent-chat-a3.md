# Runbook: Optional Agent Chat（A3）手工联调

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 可选 Agent Chat（A3）联调 Runbook |
| 文档类型 | Runbook |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-26 |
| 适用范围 | 单租户（M0）验证；**非**客户 headless 默认交付 |
| 设计事实源 | [`docs/design-lucy-agent-chat-a3.md`](design-lucy-agent-chat-a3.md) |

---

## 0. 底线（每次联调前确认）

1. **先有 Lucy**：本 Runbook 不替代 Lucy 独立部署；Agent Chat 是旁路叠加。
2. **默认 compose 不含 Chat**：勿把 `docker-compose.agent-chat.yml` 并进客户默认 `docker compose up`。
3. **单租户 M0**：一个 Hermes home、一个 Lucy Agent token；Open WebUI 多账号共享同一 `lucy-data-agent`。
4. **Hermes `:8642` 不对宿主公网映射**（compose 已不发布该端口）。

---

## 1. 前置

| 项 | 要求 |
|---|---|
| Lucy | MCP Proxy 可达；已配置 `LUCY_PUBLIC_MCP_URL`（或本机验证用宿主映射端口） |
| Token | Admin 为只读 role 的 Agent 生成 Bearer；明文只出现一次 |
| Docker | 可拉取 `nousresearch/hermes-agent` 与 `ghcr.io/open-webui/open-webui` |
| LLM | Hermes 可用的 provider key（如 OpenRouter / OpenAI / Anthropic） |

建议旁证（非阻塞）：本机已能跑通 `npm run e2e:agent:local-hermes` 时，说明 Hermes→Lucy 数据面健康。

---

## 2. 准备配置

```bash
cp agent-chat/.env.example agent-chat/.env
cp -R agent-chat/hermes-home.example agent-chat/hermes-home
```

编辑 `agent-chat/.env`：

| 变量 | 说明 |
|---|---|
| `API_SERVER_KEY` | L2；`openssl rand -hex 32`；**必须**与 `LUCY_AGENT_TOKEN` 不同 |
| `LUCY_PUBLIC_MCP_URL` | 从 Hermes 容器可达的 Lucy MCP URL（本机常见 `http://host.docker.internal:7879/mcp`） |
| `LUCY_AGENT_TOKEN` | L3 Lucy Bearer |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | 按 Hermes model 配置任选 |

检查 `agent-chat/hermes-home/config.yaml`：

- `platform_toolsets.api_server` 仅含 `mcp-lucy`（V-5）
- `mcp_servers.lucy` 使用 `${LUCY_PUBLIC_MCP_URL}` / `${LUCY_AGENT_TOKEN}`

首次启动后若 Hermes 改写了 model 段，用 `docker compose ... exec hermes hermes model` 指向真实模型。

---

## 3. 启动 / 停止

```bash
# Start (profile required)
docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env up -d

# Logs
docker compose -f docker-compose.agent-chat.yml --profile agent-chat logs -f hermes open-webui

# Stop
docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env down
```

浏览器打开 `http://localhost:3000`（或 `AGENT_CHAT_WEBUI_HOST_PORT`）。

**V-1 对照**：在不启动上述 profile 时，原 Lucy `docker compose up` 仍应独立可用。

---

## 4. Open WebUI 连接核对

Compose 已注入：

- `OPENAI_API_BASE_URL=http://hermes:8642/v1`（必须含 `/v1`）
- `OPENAI_API_KEY=<API_SERVER_KEY>`
- `ENABLE_OLLAMA_API=false`

若模型列表为空：

1. 确认 URL 含 `/v1`。
2. 确认 key 与 `API_SERVER_KEY` 一致。
3. Open WebUI 可能把 connection 写进自有 DB——改 `.env` 后仍 401 时，到 Admin → Connections 修正，或删 volume `lucy-agent-chat-open-webui-data` 后重建。

模型下拉应出现 **`lucy-data-agent`**（或你覆盖的 `API_SERVER_MODEL_NAME`）。

---

## 5. 验证清单（Spec §7）

| ID | 操作 | 通过 |
|---|---|---|
| V-1 | 不启 agent-chat profile，Lucy 仍健康 | 既有 P0 / health 通过 |
| V-2 | 在 Open WebUI 对 `lucy-data-agent` 提问 | 可见流式或最终回复 |
| V-3 | 同一次提问查 Lucy audit / trace | 至少一次允许的 `lucy_*`（或兼容面）`tools/call` |
| V-4 | 核对 `.env` | `API_SERVER_KEY` ≠ `LUCY_AGENT_TOKEN`；Chat UI 不展示 L3 |
| V-5 | 读 `hermes-home/config.yaml` 的 `platform_toolsets.api_server` | 仅 `mcp-lucy`（无 terminal/browser） |

可选 API 抽查（在 compose 网络内）：

```bash
docker compose -f docker-compose.agent-chat.yml --profile agent-chat exec hermes \
  python -c "import os,urllib.request; req=urllib.request.Request('http://127.0.0.1:8642/health'); print(urllib.request.urlopen(req).read())"
```

宿主默认**没有** `localhost:8642` 映射属预期。

---

## 6. 排障

| 现象 | 方向 |
|---|---|
| Hermes unhealthy | `logs hermes`；检查 volume 权限与 `API_SERVER_KEY` 长度（≥8） |
| Open WebUI 无模型 | `/v1` 后缀、key、Ollama 干扰、Connections DB 缓存 |
| 有回复但无 Lucy 调用 | MCP URL 从容器不可达；token/role；`mcp_servers.lucy` 未加载 |
| 权限拒绝 | Lucy ACL / role；换只读可访问表范围内的问题 |
| 首包很慢 | 多轮 MCP 正常；以 audit 为准，勿仅用 UI 延迟判失败 |
| 改 env 不生效 | Open WebUI 自有 DB；或需 `compose up -d --force-recreate` |

---

## 7. 安全提醒

- 勿把 `agent-chat/.env` / `agent-chat/hermes-home/` 提交 git（已在 `agent-chat/.gitignore`）。
- 公网暴露 Open WebUI 时自行加 HTTPS、强管理员密码、关闭公开注册。
- 验证结束后轮换演示用 `LUCY_AGENT_TOKEN`。

---

## 8. 仓库烟测（静态 + 可选 live）

```bash
npm run smoke:agent-chat:a3
```

- 默认：校验 compose / 模板 / gitignore 等**包装完整性**（不要求 stack 已启动）。
- `--live`：若 Hermes/Open WebUI 可达则做健康探测；不可达则 **blocked**（exit 2），不充当 headless 硬门禁失败。

本命令**不得**加入 `smoke:p0:headless-config` / SOW trust 必跑集。

---

## Terminology Compliance

This runbook follows `webui/docs/00-product-terminology-standard.md`（§4.9 Agent Chat）。  
主术语：Agent Chat、`lucy-data-agent`、Open WebUI、Hermes、API Server、MCP、SSE。
