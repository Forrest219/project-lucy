# 访问关系图桑基还原 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.2 / 2026-11-17 |
| 状态 | S5｜v0.2；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。D0＝C；终稿由委托人明示确权；已授权并实现 A2／A3 与 Track B 方案 C，已提交。不入核心分母。≠ 可上线 |
| 授权边界 | 委托人 2026-11-17「批准方案 C，授权定稿开发」。授权范围：Spec §9 所列 A2、A3 与 Track B 方案 C。**不授权**线上升级、出包、改 `include_candidate`、提交 git。 |
| 验收 | Spec §7 SC-A2–A7、SC-B1–B6 逐条有证据；测试台 `UAT-SUITE-ACCESS-MAP-SANKEY` 必做用例沙箱全绿；`npx vitest run src/__tests__/access-map server/__tests__/p1-access-map` 只剩既有的术语 lint 失败。**不构成发布取证** |
| 目标 | 让访问关系图在零访问、多 Agent、全未确认、宽授权四种数据下仍是四列带状流的桑基，并披露被排除的未确认调用 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「落盘清单」「强制流程：Plan Mode」 |
| 总账 | P1-41／REQ-030-062（见 [功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md)） |

## 1. 目标

按 Spec v0.2 §5 实现：使用流带刻度设下限、列节点设上限、未确认关联只读披露、闲置授权以幽灵带与聚合节点呈现。不改边状态机、路径主键、`include_candidate`。

## 2. 开工前置

1. D0＝C 已由委托人裁定；终稿确权为委托人明示（无 Codex）。
2. 开发授权已获得，范围见 Spec §9。A1（线上升级）不含在内。
3. 先写失败测试，看它因正确原因失败，再写最小实现。

## 3. 任务

| 步骤 | 做什么 | 验证 |
|---|---|---|
| T1 | 服务端：`unconfirmedCalls` 与 `COLUMN_NODE_CAP` | `p1-access-map-unconfirmed-calls.test.ts`、`p1-access-map-column-cap.test.ts` |
| T2 | 画布：`UNIT_MIN`、幽灵带、幽灵区、聚合节点、图例 | `access-map-sankey-restoration.test.tsx` |
| T3 | 页面：空态披露未确认次数并链接访问日志 | `access-map.test.tsx` 的 SC-A6 |
| T4 | 改写被取代的旧断言 | `access-map-usage-first`、`access-map-layout`、`access-map` 三个测试文件全绿 |
| T5 | 沙箱目视与 DOM 量值，记 UAT run | `runs/2026-11-17-cursor-sankey-restoration-run.md` |
| T6 | 状态镜像：Spec 头、总账、需求池、UAT INDEX、e2e-ledger、术语标准 | `npm run lint:spec-docs`、`node scripts/uat/check-e2e-ledger.mjs` |

## 4. 验收

沿用 Spec §7，不另写一套。

## 5. 完成定义

功能合同验收覆盖 Spec §7 的 SC-A2–A7、SC-B1–B6。产品侧收口以 Docker 种子沙箱必做用例及测试台跑次为证，按 [DEVELOPMENT.md「产品侧修复收口」](../governance/DEVELOPMENT.md#产品侧修复收口) 判定。SANKEY-07 对应 SC-A1，归发布取证。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 线上镜像缺 `f3f88837`、`e2ca2ca7`，前端再好也看不到 | A1 单列为发布动作，须另行授权；07 判定只认 health＋页面 |
| 幽灵带宽度是示意量，被读成真实授权量 | 图例第 2 项写明「示意宽度，封顶，不与实心带同尺度」 |
| 增高画布削弱首屏全貌 | `COLUMN_NODE_CAP` 限最坏高度，容器内部滚动 |
| 既有术语 lint 失败掩盖本条回归 | Spec §9 点名四个既有违规文件，本条不改它们 |

## 浏览器验证

- 路由：/admin/access-map
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9
- 证据：未执行
