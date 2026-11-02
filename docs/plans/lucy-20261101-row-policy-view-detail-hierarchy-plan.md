# 行权限视图单表详情分层与对齐 Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax. REQUIRED 配套 Spec 增补：主 Spec §5.5 与 SC-24–SC-27。

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-01 |
| 状态 | **功能合同已收口（2026-11-01）**。S1–S4 落地；SC-24–SC-27 组件测试关闭 + `lint:terminology` exit 0。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261030-row-policy-view-presentation-spec.md`](../specs/lucy-20261030-row-policy-view-presentation-spec.md) **§5.5 / SC-24–SC-27**（v0.5 增量；SC-01–SC-23 仍成立） |
| 权威语义 | 父 Spec §6.2、RTV；本 Plan **不改**行授权代数、深链参数名、清单 API、角色编辑页默认预览 |
| 授权边界 | **已授权**按本文 §3 改 `RowPolicyView.tsx`、`RowPolicyDnfPreview.tsx`、对应组件测试，以及本 Plan／主 Spec §7.1 证据行／索引状态。**不授权**改 KTX、Helm、镜像、术语标准正文、系统手册；**不授权**浏览器门禁、窄屏、docker 重建、push／commit（除非另授） |
| 验收 | SC-24–SC-27：**全部通过**（`npx vitest run src/__tests__/row-policy-view.test.tsx src/__tests__/row-policy-dnf-preview.test.tsx` 54/54；`npm run lint:terminology` 退出码 0） |

**Goal:** 右栏「单表详情」分层清楚、同类信息两列对齐：身份／状态与有效行授予并重，角色与 Agent 作溯源。

**Architecture:** 方案 2——右栏分区壳 + 两列行。身份区与角色行在 `RowPolicyView`；结论标题／来源角色拆行与 Agent 两列经 `RowPolicyDnfPreview` 可选 prop（默认保持角色编辑页今日行为）。

**Tech Stack:** React + Vitest（`row-policy-view.test.tsx`、`row-policy-dnf-preview.test.tsx`）

## Global Constraints

- 不改 DNF 语义、边界句原文、`row-policy-view-*`／`row-policy-dnf-*` 既有 test id（可新增 `row-policy-view-detail-identity` 等）
- 角色编辑页不传新 prop → 行为不变（SC-27）
- 不新增颜色 token／卡片壳；不做窄屏重排
- 术语沿用既有表；`npm run lint:terminology` 必过

---

## 1. 目标

落地主 Spec §5.5：

1. **身份与状态区**：表身份为主，复制次要；徽章与目录在次行。
2. **结论区**：标题「有效行授予」单独成行；来源角色为次要行；结论正文强于溯源。
3. **溯源区**：角色与 Agent 统一「左主体｜右结论 + 授权摘要」两列。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 方案 2 与分层／两列拍板 | **满足**（2026-11-01） |
| P2 | 主 Spec §5.5／SC-24–SC-27 已写入 | **满足**（本文配套增补） |
| P3 | 开发授权 | **满足**（2026-11-01「批准执行」） |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/pages/admin/RowPolicyView.tsx` | 身份区壳；角色行两列；传入 `subjectRowLayout="columns"` |
| `webui/src/components/admin/RowPolicyDnfPreview.tsx` | 来源角色拆出标题；可选 `subjectRowLayout`；Agent 行两列 |
| `webui/src/__tests__/row-policy-view.test.tsx` | SC-24–SC-26 |
| `webui/src/__tests__/row-policy-dnf-preview.test.tsx` | SC-25／SC-26／SC-27 默认回归 |
| `docs/qa/selector-contract.md` | 登记新增 test id（若有） |
| 主 Spec §7.1 | SC-24–SC-27 证据行由「待落地」改为具体用例名 |

不改：`row-policy-views.ts`、角色编辑页调用处、KTX、父 Spec 语义。

## 4. 任务

### S1 — RED：身份区契约（SC-24）

- [x] 在 `row-policy-view.test.tsx` 增加 SC-24：存在 `row-policy-view-detail-identity`；身份与徽章／目录不同槽
- [x] 跑该文件相关用例，确认 RED 原因匹配 Spec

### S2 — RED→GREEN：结论拆行与 DNF 默认（SC-25、SC-27）

- [x] DNF／页面测试：标题节点文本不含「来源角色」；有 `roleIds` 时次要行可见来源角色
- [x] DNF 默认（不传新 prop）仍 stack／旧标题／边界在上／不折叠
- [x] 实现：`RowPolicyDnfPreview` 拆行 + 可选 `subjectRowLayout`；本页传 `columns`
- [x] 测试转绿

### S3 — RED→GREEN：角色／Agent 两列（SC-26）

- [x] 页面测试：角色行左列为角色链接、右含行权限文案与「授权摘要」
- [x] DNF 测试：`subjectRowLayout="columns"` 时 Agent 行为两列；默认仍 stack
- [x] 实现：`RowPolicyView` 角色行 grid；DNF Agent 行同构
- [x] 测试转绿

### S4 — 门禁与文档

- [x] `npm run lint:terminology` 退出码 0
- [x] 更新主 Spec §7.1 的 SC-24–SC-27 证据；本 Plan／`docs/README.md`／`docs/plans/README.md` 状态
- [x] 新增 test id 写入 `docs/qa/selector-contract.md`

## 5. 验收

| ID | 怎么验 |
|---|---|
| SC-24 | 页面组件测试 |
| SC-25 | 页面 + DNF 组件测试 |
| SC-26 | 页面 + DNF 组件测试 |
| SC-27 | DNF 默认行为回归 |
| 术语 | `npm run lint:terminology` |

浏览器走查、窄屏、docker 重建**不在**本条出口（用户另要求时再做）。

## 6. 完成定义

- S1–S4 勾销；SC-24–SC-27 有通过记录
- 角色编辑页视觉／行为无回归
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 改 DNF 默认布局波及角色编辑页 | 新 prop 默认 `"stack"`；SC-27 锁默认 |
| 既有 flex-wrap 断言过严 | 只改呈现壳；保留既有 test id 与深链断言 |
| demo 镜像仍是旧 UI | 与出口分离；需要时再 `demo:upgrade` |
