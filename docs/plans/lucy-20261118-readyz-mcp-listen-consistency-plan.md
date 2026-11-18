# readyz 与 MCP 监听就绪一致性 Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.2。与 Spec 同句：终稿已确权、开发已授权；代码已实现（`markWebuiWarmupComplete` 在 `proxy.listen` 后）；vitest 14/14；测试台 NOT RUN；不入核心分母；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md`](../specs/lucy-20261118-readyz-mcp-listen-consistency-spec.md) |
| 总账 | **P1-46**／REQ-030-067（前方报告 P0-03）；**不入核心分母** |
| 授权边界 | **开发已授权（委托人 2026-11-18「授权定稿」）。** 限 `index.ts`、`runtime/readiness.ts` 及对应 vitest／UAT。默认不改 Helm |
| 验收 | Spec SC-01–SC-06；测试台 `UAT-SUITE-READYZ-MCP-LISTEN` |

## 目标

首次 `readyz` 200 时 MCP 已可 initialize。

## 开工前置

- 已入总账；Spec／本 Plan／测试台已挂。
- 终稿确权／开发授权：已取得（委托人 2026-11-18「授权定稿」）。
- 改前对照：前方 E23；本仓跑次归档。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 改前基线 RML-01／02（≥3 次冷启动） | FAIL 入 `runs/` |
| 1 | 推迟 `markWebuiWarmupComplete` 至 MCP listen 后 | 单测／启动序守卫 |
| 2 | 候选构建跑 UAT 必做 | INDEX |

## 浏览器验证

不适用：不改变用户可见 WebUI 表面。

## 验收

Spec SC + 测试台 `runs/`；不以稍后重试成功关单。

## 完成定义

文档同句；UAT 必做 PASS；**≠ 可上线**。

## 风险

| 风险 | 处理 |
|---|---|
| Ready 推迟拉长启动探针窗口 | 跑次记录就绪耗时；不靠放宽 failureThreshold 关单 |
| 与 P1-39 首轮扫描 after listen 交互 | 保持扫描在 listen 之后；Ready 仍等 MCP |
