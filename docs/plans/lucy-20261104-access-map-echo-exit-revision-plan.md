# 访问关系图口径对齐 — 收口前出口修订 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-04 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261104-access-map-echo-exit-revision-spec.md`](../specs/lucy-20261104-access-map-echo-exit-revision-spec.md)（**v0.1**） |
| 权威语义 | 主 Spec [`lucy-20261102-access-map-audit-echo-spec.md`](../specs/lucy-20261102-access-map-audit-echo-spec.md) D1–D13／§6；本 Plan 只改出口归属与 SC-14 证据 |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-14 逐边断言在仓；SC-12 页序子句已拆出；主 Spec 已按另行批准收口。本条收口不表示可上线 |
| 授权边界 | **已授权**改主 Spec 验收矩阵与状态镜像、`p1-access-map.test.ts` 逐边断言（若缺则补）、实施笔记、本条索引。**不授权**主 Spec C 类收口签字、git commit（除非用户另行要求）、镜像、部署、浏览器走查 |
| 验收 | 以主 Spec 本条 §6 SC-01–SC-06 为准 |
| 实施主体 | Lucy 文档 + `webui/server/__tests__/p1-access-map.test.ts` |
| 待拍板 | D1–D4 以主 Spec 本条 §4 为准（已冻结） |

## 1. 目标

1. 主 Spec SC-14 逐边有自动化证据。
2. 主 Spec SC-12 页序子句拆出；五态 + unavailable 留下。
3. 出口修订期间主 Spec 先保持未收口；2026-11-04 批准 C 类闭口后，主 Spec 与本条一并改为功能合同已收口。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 出口修订 Spec v0.1 已落盘 | **满足** |
| P2 | 用户批准交付开发 | **满足**（2026-11-04） |
| P3 | 主 Spec S1–S3 代码已在仓 | **满足** |

## 3. 文件落点

| 路径 | 改动 | 阶段 |
|---|---|---|
| `docs/specs/lucy-20261102-access-map-audit-echo-spec.md` | SC-12 拆出页序；闭口后状态为功能合同已收口 | S1 |
| `docs/plans/lucy-20261102-access-map-audit-echo-plan.md` | 状态镜像 | S1 |
| `docs/README.md`／`docs/plans/README.md` | 主 Spec／本条索引 | S1 |
| `webui/server/__tests__/p1-access-map.test.ts` | 确认或补齐 SC-14 逐边；页序测可留作过程证据 | S2 |
| `docs/reviews/2026-11-04-access-map-audit-echo-implementation-notes.md` | 缺口／出口修订现状 | S3 |
| 本 Spec／Plan／索引 | SC-05／SC-06 镜像 | S3 |

### 不改

- `access-map-echo.ts` 算法（除非测试证明缺逐边暴露而必须最小导出测试钩子）
- KTX、usage-classification、inquiry-kind 判定

## 4. 分阶段实施

### S1 主 Spec 出口与状态

1. 出口修订落地后，主 Spec 按批准改为功能合同已收口。过渡态「功能合同未收口」已作废，不得当作现值。
2. §7 SC-12：页序子句标 **拆出**；留下五态 + unavailable。
3. §7 SC-14：保留逐边句。
4. 闭口层级「本条出口」与文末定稿句去掉未授权「已收口」。
5. 镜像 Plan／`docs/README.md`／`docs/plans/README.md`。

### S2 SC-14 证据

1. 跑 `p1-access-map.test.ts` 中 SC-14；若缺逐边对照 `accessCallIds`，按 TDD 补。
2. 确认 Σ `accessCalls` 不得等于 `enteringAllowCallCount` 的夹具断言存在。
3. 页序用例若存在：注释标明过程证据，不删。

### S3 笔记与本条验收

1. 更新实施笔记：出口修订结论；主 Spec 功能合同已收口。
2. 本条 Spec／Plan 状态为功能合同已收口。
3. 跑 `npm run lint:spec-docs`（至少）。

## 5. 验收

```bash
cd webui && npx vitest run --maxWorkers=1 server/__tests__/p1-access-map.test.ts -t "SC-14"
cd /Users/forrest/GitHub/project-lucy && npm run lint:spec-docs
```

人工：主 Spec SC-12／SC-14 正文与状态行符合本条 D1–D3。

## 6. 完成定义

- [x] SC-01–SC-06 有证据
- [x] 主 Spec 未宣称未授权的功能合同已收口
- [x] SC-14 逐边测试绿
- [x] 本条收口不表示可上线；主 Spec C 类闭口另批

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 误删页序测试 | D4：可留 |
| 状态镜像漏改 | S1 清单 + lint:spec-docs index |
