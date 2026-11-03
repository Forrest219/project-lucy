# Admin API Agent 可发现性与开通人体工程学 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.4** / 2026-11-03 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P0＋P1**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261103-admin-api-agent-discoverability-spec.md`](../specs/lucy-20261103-admin-api-agent-discoverability-spec.md) |
| 状态 | **v0.4 已实施（2026-11-03）**。SC-01–SC-20 自动化已落，尚无逐条收口记录。本条收口不表示可上线 |
| 授权边界 | **v0.4 可定稿后**：用户同会话「能定稿则推进落地」已明示开工。授权实现 Spec SC-01–SC-20 对应代码与测试。**仍不授权** git commit、客户镜像、Docker `--fresh`／重建、浏览器 E2E，除非用户另授 |
| 验收 | 以主 Spec §4 SC-01–SC-20 为准 |
| 实施主体 | `webui/server` Admin／auth／tokens／agents；OpenAPI 模块；endpoint 解析与 `mcpEndpoint` 片段；配套测试 |
| 审阅 | [`docs/reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md`](../reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md) |

## 1. 目标

让运维 Agent／脚本无需反解前端 JS，即可发现 Admin 开通域契约并完成登录会话、单 Agent Token 签发／撤销与角色 PATCH：公开 OpenAPI（按 operation 诚实声明 dryRun）、D3 路由诊断、错误自解释、Agent 确认写入可续写 `after`、`expires_in` 与可选客户端配置片段（先校验 MCP endpoint）。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec 与本 Plan 同编号落盘 | 满足 |
| P2 | Codex CLI 三轮只读审阅完成，阻塞＝0，文档定稿 | 满足（三轮完成，v0.4 可定稿；用户已明示开工） |
| P3 | 用户明示授权改运行代码 | 满足 |
| P4 | 不引入 Admin Bearer；不实现本条外 `lucy_ops_*` 新工具 | 合同已写死 |

## 3. 文件落点（定稿后实施时）

| 路径 | 改动 |
|---|---|
| `webui/server/admin/openapi-document.ts`（新） | D2 枚举 OpenAPI（手写可审合同） |
| `webui/server/index.ts`／`auth/guard.ts`／路由诊断辅助 | 公开 OpenAPI；在 CSRF 之后、会话拒绝之前做 D3；复用 Fastify 路由器（不解析 `printRoutes` 文本） |
| `webui/server/admin/tokens.ts` | `existingToken` detail；`expires_in`；`includeClientConfigs`＋先校验 endpoint |
| `webui/server/admin/token-expiry-policy.ts` | `expires_in`／冲突／非法；固定 t0 |
| `webui/server/admin/agents.ts` | 创建 400 expected／example；POST／PATCH 确认写入 `after.version`＝写入后并发版本 |
| `webui/src/lib/mcpEndpoint.ts` 或 server 薄包装 | 与 NewToken 同源片段 |
| `webui/server/__tests__/admin-openapi-discoverability.test.ts`（新） | SC-01–SC-06、SC-17 相关 |
| tokens／agents 既有与新测 | SC-07–SC-16 |
| Spec／Plan／索引 | SC-18 状态镜像 |

## 4. 分阶段实施（仅 P2＋P3 后）

### S1 路由诊断与 OpenAPI

1. D3：路由器语义查找；405／404／公开／会话顺序。
2. 手写 D2 OpenAPI（含登录字段、Cookie、按 operation 的 dryRun、owner 门禁说明）。
3. 测试 SC-01–SC-06、SC-17。

### S2 错误自解释与 Agent after

1. `TOKEN_LABEL_TAKEN` detail；创建 Agent expected／example。
2. Agent POST／PATCH 确认写入：`after.agent`＋`after.version`（写后重算并发版本）；保留 `agent`／`policyVersion`。
3. 测试 SC-07–SC-10、SC-16。

### S3 Token TTL 与 clientConfigs

1. `expires_in`＋等值双传／冲突／非法。
2. `includeClientConfigs`：先 endpoint 校验再签发。
3. 测试 SC-11–SC-15、SC-19–SC-20（预览与签发共用 resolve_expiry）；SC-18 文档门禁。

## 5. 验收

| 项 | 做法 |
|---|---|
| SC-01–SC-20 | webui vitest：discoverability＋tokens＋agents |
| 文档门禁 | `npm run lint:spec-docs` |
| 不做 | 浏览器 E2E、Docker 重建、实现 `lucy_ops_token_issue` |

## 6. 完成定义

- 文档阶段：三轮 Codex 后阻塞＝0 可定稿；状态镜像逐字一致
- 开工后：SC-01–SC-20 自动化通过；未引入 Admin Bearer／`lucy_admin_*`

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 误以为鉴权早于框架 Routing | Spec D3 已更正：问题在鉴权早于 notFound；用路由器 lookup，不靠改 notFound 单独完成 404 |
| OpenAPI 与实现漂移 | SC-01／02 解析 operation；改契约同步改文档模块 |
| `after.version` 误用 policyVersion | SC-10 连续 PATCH |
| endpoint 无效仍签发 | SC-14 先 503 |
| 范围膨胀 | P4；打回 |

## 8. Codex 审阅节奏

| 轮次 | 入口 | 出口 |
|---|---|---|
| 第 1 轮 | v0.1 | 退回修订 → 本版 v0.2 |
| 第 2 轮 | v0.2 | 退回修订 → 本版 v0.3 |
| 第 3 轮 | v0.3 | 可定稿或可贴句闭合 |

汇总：`docs/reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md`。
