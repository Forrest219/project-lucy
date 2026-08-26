# Runbook: Optional Agent Chat（A3）手工联调

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 可选 Agent Chat（A3）联调 Runbook |
| 文档类型 | Runbook |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-26 |
| 适用范围 | 单租户（M0）验证；**非**客户 headless 默认交付 |
| 设计事实源 | [`docs/design-lucy-agent-chat-a3.md`](design-lucy-agent-chat-a3.md) |

---

## 0. 底线（每次联调前确认）

1. **先有 Lucy**：本 Runbook 不替代 Lucy 独立部署。
2. **默认 compose 不含 Chat**：勿把 `docker-compose.agent-chat.yml` 并进客户默认 `docker compose up`。
3. **M0 单账号串行**：一个 Open WebUI 验证账号、一个 Hermes home、一个 Lucy Agent token；禁止并发提问。
4. **Hermes `:8642` 无宿主 ports**；Open WebUI 默认绑定 `127.0.0.1`。
5. **Lucy Admin 凭据独立**：证据链只用 `LUCY_ADMIN_*`，禁止用 `WEBUI_ADMIN_*` 冒充。

---

## 1. 前置

| 项 | 要求 |
|---|---|
| Lucy | MCP 可达；Lucy Admin 可登录 |
| Token | 只读 Agent Bearer（L3） |
| Images | `HERMES_IMAGE` / `OPEN_WEBUI_IMAGE` = `repository:tag@sha256:<64 hex>` |
| LLM | Hermes provider key |
| 数据 | 默认 `A3_DATA_CLASS=nonprod`；真实客户数据须 `A3_DATA_APPROVAL_ID` |

旁证（非阻塞）：`npm run e2e:agent:local-hermes`。

---

## 2. 准备配置

```bash
cp agent-chat/.env.example agent-chat/.env
cp -R agent-chat/hermes-home.example agent-chat/hermes-home
```

编辑 `agent-chat/.env`：填入真实 pin digest（勿用 example 中的占位 0）、`API_SERVER_KEY`、`LUCY_*`、`WEBUI_ADMIN_*`、`LUCY_ADMIN_*`、LLM key。

### `WEBUI_ADMIN_*` 含义

仅在 **fresh volume**（Open WebUI DB 尚无用户）时创建管理员，之后**不会**更新已有账号。这是首次初始化，不是持续账号收敛。existing volume 必须读运行时用户数/注册开关；不合规时 **fail/blocked**，**不得**自动 `down -v`。

检查 `agent-chat/hermes-home/config.yaml`：`memory_enabled: false`、`platform_toolsets.api_server` 仅 `mcp-lucy`。

---

## 3. Pause vs Destroy

### Pause（保留验证数据）

```bash
docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env down
```

保留 Open WebUI volume 与 `agent-chat/hermes-home`。

### Destroy validation data（不可恢复；人工确认）

1. 导出需要保留的 evidence JSON。
2. 确认 compose project 名为 `lucy-agent-chat`。
3. `docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env down -v`
4. 删除明确路径 `agent-chat/hermes-home`（需人工确认）。
5. 轮换 `LUCY_AGENT_TOKEN` / `API_SERVER_KEY` / Provider key / 视需要轮换 Open WebUI 与 Lucy Admin 密码。

Smoke **不得**自动执行 Destroy。

---

## 4. 启动

```bash
docker compose -f docker-compose.agent-chat.yml --profile agent-chat --env-file agent-chat/.env up -d
```

浏览器：`http://127.0.0.1:3000`（或 `AGENT_CHAT_WEBUI_BIND_HOST`/`PORT`）。

启动后设 `A3_VOLUME_MODE=fresh` 或 `existing`，供 live smoke 使用。live smoke 会登录 Open WebUI，读取运行时注册开关和用户列表；该值只记录卷的操作上下文，不代替运行时取证。

---

## 5. 验证清单（与 Design §7 对齐）

| ID | 操作 | 通过 |
|---|---|---|
| V-1 | 不启 A3；跑 `npm run smoke:p0:delivery-isolation` | Lucy 隔离 PASS |
| V-2 | live smoke 经 Open WebUI `/api/chat/completions` 提问（串行） | SSE + completed + ≥1 非空 content delta |
| V-3 | 问题后缀 `A3_CASE:<uuid>`；Lucy Admin 两段式 turns API | `total===1` + accessLogs 允许数据调用 |
| V-4 | 核对 `.env` | L2≠L3；Admin 凭据不混用 |
| V-5 | 模型可调用工具探针（pin 后固化命令） | exact allow-list；不可探测 → blocked |
| V-6 | image inspect | immutable ref + Id + RepoDigests |
| V-7 | fresh/existing volume | 见 §2；不合规不自动清卷 |

### V-3 两段式（冻结）

1. `GET /api/auth/status`；required 模式再 `POST /api/auth/login`（JSON 字段 `adminId`/`password`，取值 `LUCY_ADMIN_ID`/`LUCY_ADMIN_PASSWORD`）
2. `GET /api/admin/audit/turns?source=reported&q=A3_CASE:<uuid>&limit=2` → `total === 1`
3. `GET /api/admin/audit/turns/:turnId` → `accessLogs`

判定：Lucy 不可达 / 缺 Admin 凭据 → `blocked`；登录失败或 401/403 → `fail`。

### V-5 工具探针

live smoke 在 Hermes 容器内认证请求 `GET http://127.0.0.1:8642/v1/toolsets`，从已启用 toolset 的 `tools` 字段提取工具集。只有 pinned 版本能完整返回 MCP 派生工具时，结果才可用于 exact allow-list 判定：缺工具、多余 `lucy_*` 或任何其他工具均 `fail`。已知部分 Hermes 版本会从该端点省略 MCP 派生工具；空结果、容器/端点不可用或无法证明结果完整时必须 `blocked`，不得假 PASS。`API_SERVER_KEY` 只从容器环境读取，不写入命令输出或 evidence。

---

## 6. 传输与数据分级

- `http://` 仅 loopback、`host.docker.internal` 或明确隔离 bridge。
- 其他 `LUCY_PUBLIC_MCP_URL` 必须 `https://`。
- `A3_DATA_CLASS=approved-customer` 时必须提供 `A3_DATA_APPROVAL_ID`（及建议的 Provider 区域）。

---

## 7. 排障

| 现象 | 方向 |
|---|---|
| compose 拒绝启动 | 未设置 pin：`${HERMES_IMAGE:?pinned image required}` |
| Open WebUI 无模型 | `/v1`、key、Connections DB |
| existing volume 多账号 | 人工 Destroy 或清用户；勿只改 env |
| 有回复无 Lucy 调用 | MCP URL/token；begin_question 未带原问题 → 证据链 fail |
| Admin 401 | 检查 `LUCY_ADMIN_*`，勿用 WebUI admin |

---

## 8. 仓库烟测

```bash
npm run smoke:agent-chat:a3          # 静态
npm run smoke:agent-chat:a3 -- --live
```

- 静态：包装完整性。
- live：登录 Open WebUI，核验 `ENABLE_SIGNUP=false` 与唯一管理员账号，经 Open WebUI 发出带自动生成 `A3_CASE:<uuid>` 的问题，校验 SSE，再用 Lucy Admin 审计 API 关联同一 case；缺依赖 → exit 2 `blocked`。
- **不得**加入 headless / SOW 硬门禁。
- Lucy 镜像隔离硬门禁：`npm run smoke:p0:delivery-isolation`。

维护者脚本可保留在仓库根 `package.json`；**客户 source bundle** 不含这些命令入口。
