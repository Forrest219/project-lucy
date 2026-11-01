# 新建 Token 过期快捷预设 UX Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

| 元数据 | 内容 |
|---|---|
| 状态 | **功能合同已收口（2026-11-01）** |
| 主 Spec | [`docs/specs/lucy-20261101-new-token-expiry-preset-ux-spec.md`](../specs/lucy-20261101-new-token-expiry-preset-ux-spec.md) |
| 授权边界 | 仅改 `NewToken.tsx`、对应组件测试、`docs/qa/selector-contract.md` 中 policy notice 行，以及本 Plan / Spec 状态。不改 Token API、Onboarding Step6、不要求浏览器门禁、不强制本轮 docker 重建 |
| 验收 | Spec SC-01–SC-06：**全部通过**（`npx vitest run src/__tests__/new-token.test.tsx` 16/16；`npm run lint:terminology` 退出码 0） |

**Goal:** 新建 Token 页快捷预设改为 segmented；删除有效期政策提示句。

**Architecture:** 复用既有 `pl-segmented-control` / `--cols-4` / `--active`；预设日期联动逻辑不变。

**Tech Stack:** React + Vitest（`new-token.test.tsx`）

## Global Constraints

- 选中态禁止 `pl-btn--primary`
- 删除「默认有效期为 90 天…」整句与 `new-token-expiry-policy-notice`
- 默认 90 天、`min`/`max`、四档天数不变

---

## 1. 目标

落地 Spec 方案 B：segmented 预设 + 删除政策提示。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec 已批准 | **满足**（2026-11-01） |
| P2 | 开发授权 | **满足**（「批准，请落地执行」） |

## 3. 任务

### Task 1: RED — 测试契约

- [x] 改 `webui/src/__tests__/new-token.test.tsx`：断言 segmented class、`--active`、无 policy notice、自定义日期无选中
- [x] 跑相关测试，确认失败原因匹配 Spec

### Task 2: GREEN — 页面实现

- [x] `NewToken.tsx`：删除 notice；预设容器改为 `pl-segmented-control pl-segmented-control--cols-4`；item 用 `--active`
- [x] 更新 `docs/qa/selector-contract.md`：移除 `new-token-expiry-policy-notice`
- [x] 测试转绿

### Task 3: 门禁与文档状态

- [x] `npm run lint:terminology`（退出码 0）
- [x] Spec / Plan / 索引状态更新为已落地（SC 记录通过）

## 4. 验收

以 Spec SC-01–SC-06 为准；组件测试 + terminology lint。浏览器走查不在出口。

## 5. 完成定义

- Task 1–3 勾销；SC-01–SC-06 有通过记录
- 本条收口不表示可上线

## 6. 风险

| 风险 | 缓解 |
|---|---|
| demo 镜像旧 | 与出口分离；用户自行重建后可见 |
| real-e2e 依赖 button name | 保留「30 天」等可见名 |
