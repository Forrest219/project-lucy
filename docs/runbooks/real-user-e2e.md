# 真实用户 E2E 运行手册

| 元数据 | 内容 |
|---|---|
| 文档名称 | 真实用户 E2E 运行手册 |
| 文档类型 | Other（Runbook） |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude（Cursor Builder，T12） |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) §6–§8；[Plan](../plans/2026-10-18-enterprise-security-and-real-e2e-plan.md) T10–T13；[real-e2e-clients.yaml](../qa/real-e2e-clients.yaml) |
| 适用范围 | 在受保护 runner 或开发机上执行 security-integration / 真实浏览器 / 真实客户端三层证据；不替代客户 K8s 上线门禁 |
| 输出位置 | `docs/runbooks/real-user-e2e.md` |

## 1. 三层证据，互不替代

| 层 | 入口 | 产出（`inbox/e2e/<runId>/results/`） | 能证明什么 |
|---|---|---|---|
| security-integration | `npm run e2e:real:security -- --run <run.json>` | `security.json` | 当前 Lucy 进程 + 真实 HTTP/SQLite 上的拒绝/允许对照；缺能力即 BLOCKED |
| 真实浏览器 | `npm run e2e:real:management -- --run <run.json>` | `management.json`、`management-playwright.json` | 真实桌面 Chromium 操作真实实例（customer + 认证 required） |
| 真实客户端 | `npm run e2e:real:agent -- --run <run.json>` | `agent.json`、`server-evidence.json` | Codex CLI、Cursor CLI Agent 自主检索并查数，由服务端账本与 typed gold 判定 |

三类只产出各自的 case 证据；是否可发布只由 `verify-evidence.mjs` / `customer-release-readiness.mjs`（T13）判定。

## 2. 准备

```bash
node scripts/e2e/lib/catalog.mjs --check                # 冻结 case 目录与 lock 一致
npm run e2e:real:prepare -- --run-id local-20261018-0100 --mode local
# release：--mode release --candidate <identity.json> --profile scripts/e2e/profiles/customer-release.yaml
```

- 运行目录只在 `inbox/e2e/<runId>/`；`--project-dir` 一律拒绝（不接受真实私有项目目录）。
- 密钥（Agent Token、管理员口令、引导密钥、数据库口令）只写 `checker/secrets/`（0600，目录 0700），`run.json` 不含任何密钥。
- gold 与 seed 只在 `checker/`，不进入客户端工作目录 `client-work/`。

## 3. 真实客户端（T12）

### 3.1 客户端矩阵（R4/R7）

`docs/qa/real-e2e-clients.yaml`：Codex CLI 与 Cursor CLI Agent 是 required；Cursor IDE GUI 为 optional，不进首发分母；Hermes 两个 profile 只算一个产品，不能替代它们。

### 3.2 凭据与二进制（R8/R10，缺失即 BLOCKED）

| 产品 | 二进制 | 模型凭据环境变量 | adapter |
|---|---|---|---|
| Codex | `codex`（PATH 上的可执行文件；shell 函数/alias 不算） | `OPENAI_API_KEY`（测试专用账号） | `scripts/e2e/adapters/codex.mjs` |
| Cursor | `cursor-agent`，或 `--version` 自报为 Cursor 的 `agent` | `CURSOR_API_KEY`（测试专用账号） | `scripts/e2e/adapters/cursor.mjs` |

探测在任何问答之前执行：二进制不存在、凭据缺失、`--version` 无法运行、`agent` 不是 Cursor，均报 `blocked` 并列出原因，**不会**伪造通过。开发机当前没有这两个二进制，因此本地结果为 BLOCKED（见 `agent.json`）。

### 3.3 约束

1. adapter 把 WebUI 复制出的 MCP endpoint 与每客户端独立测试 Token 写成各自原生配置（`CODEX_HOME/config.toml`、`.cursor/mcp.json`）；配置里只出现环境变量**名称** `LUCY_E2E_TOKEN`，Token 不进 argv、不进配置文件。
2. runner 没有 `--gold`、`--token` 参数；提问只取 gold 登记表里的**问题文本**；Agent 不得读取数据库、测试源码、gold 或测试控制端。
3. **隔离探测**：正式题前用同一客户端尝试读取 gold 文件与连接数据库端口；读到即 `blocked: isolation_not_established`。正式验收必须以独立 OS 身份/VM 运行客户端；`--allow-unisolated-local` 仅限 local 模式，证据标 `not_enforced_local_override`，不可用于 release。
4. 每个 required 产品 × case 独立运行 **3 次**（R9：3/3），首跑与全部重试都保留；任一次失败，该产品该 case 的三条记录均判失败并保留原因；模型波动需 owner 书面豁免一轮重跑，原失败仍留在证据中。
5. 判定（`answer-assertions.mjs`）：金额按分精确、整数精确；平均日比率、另一库计数等已知错误/诱饵若被当作答案即失败；必须陈述口径；空结果/不可计算必须如实说明且不得编造数字；域外 canary 或凭据出现即失败。
6. **没有服务端成功 query 事件就不通过**，即使答案数字碰巧正确。
7. `collect-server-evidence.mjs` 用隔离实例的管理员身份读取本 run 的审计账本，按 Token 指纹、Agent、时间窗绑定；`requestId` 不是 Trace，只有服务端 `trace_*` 才算；窗口外、他人 Token、他人 Agent 的事件一律不计并报告绑定问题；账本读不到即报错，不做兜底造数。

### 3.4 执行

```bash
export OPENAI_API_KEY=...   # 测试专用，来自 protected runner secret
export CURSOR_API_KEY=...
export LUCY_REAL_E2E_CAPABILITIES=ktx-upstream,postgres,agent-client,network-profile   # 仅当环境确已具备
npm run e2e:real:agent -- --run inbox/e2e/<runId>/run.json
```

退出码：0 passed、1 failed、2 blocked（Spec §8.2）。

## 4. 已知限制（据实）

- 本机没有 Codex / Cursor CLI 二进制和模型凭据，真实客户端执行为 BLOCKED；adapter 的命令行标志按产品文档编写，**尚未用真实二进制执行过**。
- 需要编排的 Agent 用例（SEC-07-V12、SEC-21-V06、UX-02-V04～V06、UX-03-V04～V06、UX-03-S01/S03、UX-04-V01、UX-04-S01/S02）尚无 ask 计划，报 `handler_not_implemented` 并计 BLOCKED，不猜测。
- 隔离探测在同一 OS 用户下必然失败（客户端读得到 gold）；这是预期的 BLOCKED，不是缺陷。
