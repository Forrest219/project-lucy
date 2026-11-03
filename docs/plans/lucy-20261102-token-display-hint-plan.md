# Token 核对提示 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-02 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P2**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261102-token-display-hint-spec.md`](../specs/lucy-20261102-token-display-hint-spec.md) |
| 状态 | **v0.1 功能合同已收口（2026-11-03）**。收口记录见 [`docs/reviews/2026-11-03-token-display-hint-closure.md`](../reviews/2026-11-03-token-display-hint-closure.md)。本条收口不表示可上线 |
| 授权边界 | 2026-11-02 用户接受 Codex 方案 A（单字段 `token_hint`）并授权落盘与执行；**明确不要求重建 Docker**；不授权 git commit、客户镜像、`--fresh` |
| 验收 | 以主 Spec §3 SC-01–SC-08 为准 |
| 实施主体 | `token-display-hint` 工具、`tokens.ts` 签发／列表、`Tokens.tsx`、类型、术语、SYSTEM_HANDBOOK、相关测试 |

## 1. 目标

新建 Token 落盘固定截断 `token_hint`；`/admin/tokens` 对人展示「Token 核对提示」而非 `sha256:` 哈希前缀；审计深链继续用 `hashPrefix`。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.1 已落盘 | 满足 |
| P2 | 用户接受 Codex A 方案并授权执行（无 Docker 重建） | 满足（2026-11-02） |
| P3 | 术语「Token 核对提示」写入术语标准 | 本 Plan 同步 |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/server/admin/token-display-hint.ts` | `buildTokenDisplayHint` / `isValidTokenDisplayHint` |
| `webui/server/admin/tokens.ts` | 签发写 `token_hint`；列表返回 `tokenHint`；创建响应带 `token_hint` |
| `webui/server/admin/agents.ts` / `access-config.ts` | `YamlToken.token_hint?` |
| `webui/src/lib/types.ts` | `TokenInventoryItem.tokenHint` |
| `webui/src/pages/admin/Tokens.tsx` | 列名与展示 |
| `webui/docs/00-product-terminology-standard.md` | 登记术语 |
| `docs/SYSTEM_HANDBOOK.md` | 落盘允许固定截断提示 |
| `webui/server/__tests__/admin-tokens.test.ts` | SC-01–SC-05 |
| `webui/server/__tests__/token-display-hint.test.ts` | 格式单元 |
| `webui/src/__tests__/tokens-page.test.tsx` | SC-06–SC-08 |

## 4. 分阶段实施

### S1 工具与签发

1. 新增 hint 构建／校验（前 6 + `…` + 后 4）。
2. 签发写入 `token_hint`；响应带回；YAML 仍不含完整明文。
3. 跑服务端测试至 SC-01/02 绿。

### S2 列表 API 与 UI

1. `GET /api/admin/tokens` 增加 `tokenHint`；保留 `hashPrefix`。
2. Tokens 页列改「Token 核对提示」，wrap；审计链不变。
3. 跑组件测试至 SC-06–SC-08 绿。

### S3 文档与门禁

1. 更新术语标准与 SYSTEM_HANDBOOK。
2. 登记 Spec／Plan 索引；跑 `lint:spec-docs` / `lint:terminology`（与本改动相关）。

## 5. 验收

| 项 | 做法 |
|---|---|
| SC-01–SC-05 | `webui` 下 `vitest run server/__tests__/token-display-hint.test.ts server/__tests__/admin-tokens.test.ts` |
| SC-06–SC-08 | `vitest run src/__tests__/tokens-page.test.tsx` |
| 文档门禁 | `npm run lint:spec-docs`（本 Spec／Plan 无新增阻塞）；`npm run lint:terminology` 与本术语登记相关 |

不跑 Docker 重建；不跑浏览器 E2E 作为本 Plan 出口。

## 6. 完成定义

- SC-01–SC-08 自动化通过
- 未要求 Docker 重建
- Spec／Plan／索引／术语已同步

## 7. 风险

| 风险 | 缓解 |
|---|---|
| hint 泄露少量明文熵 | 固定 10 hex；禁止鉴权使用；契约写明 |
| 存量无 hint | UI「无核对提示」；不伪造 |
| 非法 YAML hint | 读路径校验失败则当缺失 |
