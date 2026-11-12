# 发版性能基线与相对不回退门禁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 WebUI＋MCP 的版本化性能基线与相对不回退门禁，并清掉 Roles 列表 N× fresh source map 债，使发版取证能拦住同类回退。

**Architecture:** 复用 Spec 174 entry-performance runner／夹具文法；扩展 Roles 与 MCP 情景；归档 JSON 基线并做相对 diff；Wave 0 用与 Agent 列表同型的 batch preview 修 Roles／Agent 附带请求。

**Tech Stack:** 既有 `webui/scripts/entry-performance*.mts`、Playwright／fetch 测量、Fastify admin routes、ACL batch helpers、npm scripts、`docs/governance/test-layers-and-release-gates.md`

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Plan / **v0.2** |
| 日期 | 2026-11-13 |
| 状态 | **v0.2；R2-F＋R4；发布取证出口证据齐（SC-01–SC-16；2026-11-13）**。本条通过不表示可上线 |
| 授权边界 | **开发授权已获得（2026-11-13）**。可按本 Plan Wave 0–2 改测量脚本与列表批量化路径；不改 ACL deny 语义；本条通过不表示可上线 |
| 验收 | Spec SC-01–SC-16；本 Plan 完成定义；证据见 [`docs/reviews/2026-11-13-release-perf-baseline-gate-acceptance.md`](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md) |
| Spec | [`docs/specs/lucy-20261113-release-perf-baseline-gate-spec.md`](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) |

## Global Constraints

- 不改 KTX 源码；不改运行时 ACL deny 语义。
- 正式测量用生产 Vite build，禁止用 Vite dev 刷分。
- 不得 mock sources／agents／roles 权限解析或审计 SQL 获取成绩。
- 本地脚本兼容 stock macOS bash 3.2。
- 0.30：未 R4 前禁止改 `webui/server` 运行路径。

---

## 目标

- 发版与 CI 能跑出可对比基线；相对上版按 Spec D6 判定。
- Roles／MCP 进入强制情景；Roles 列表单次请求 source map ≤ 1。
- Agent 冷进页不再强制完整 Roles 预览。

## 开工前置

- [x] Spec 终稿确权（R2-F）
- [x] 委托人开发授权（R4），状态行含「开发授权已获得」
- [x] `npm run lint:spec-docs` 对本 Spec／Plan 无新增阻塞（2026-11-13；他文件基线外违规不计入本条）

## 文件地图

| 文件 | 职责 |
|---|---|
| `webui/scripts/entry-performance.mts`（及夹具／server） | Roles 进 API／浏览器情景；MCP Bearer 夹具 |
| `webui/scripts/release-perf-baseline.mts` + `release-perf-relative.mts` | RPB 绝对／相对闸、`report.json`、ci-small／release-medium |
| `webui/server/admin/roles.ts` | 列表 batch preview，共享 source map |
| `webui/src/pages/admin/AgentList.tsx` | Roles 查询改为弹窗打开后／轻量接口 |
| `package.json` + `docs/governance/test-layers-and-release-gates.md` | 命令登记 |
| `docs/runbooks/release-perf-baseline-fixture-tiers.md` | 夹具分档下限 |
| `docs/runbooks/lucy-release-train-workflow.md`（或对口 checklist） | 发版勾选（Wave 2） |
| `inbox/perf-baselines/**` | 过程产物；正式副本建议 `inbox/perf-baselines/formal/` |

## Wave 0 — 产品债（门禁可绿前置）

### Task W0.1：Roles 列表 batch preview

- [x] 写失败测试：列表一次请求期间 sourceMapBuilds（或测试钩子计数）>1 时失败；修后 =1
- [x] 实现：`GET /api/admin/roles` 一次加载 source map／access，批量 resolve；禁止循环默认 fresh
- [x] 保留详情／dryRun／保存的 fresh 语义（SC-14）
- [x] 跑相关 `admin-roles`／ACL 单测

### Task W0.2：Agent 页 Roles 拉取时机

- [x] 写失败测试或网络断言夹具：冷挂载 AgentList 不请求完整 Roles 预览
- [x] 改为 `showNew` 时再拉，或轻量 `includeTemplates=false` 摘要且服务端不重扫
- [x] 更新 `agent-list` 相关测试

## Wave 1 — Runner 扩面与基线

### Task W1.1：情景

- [x] `PAGE_ROUTES`／API 情景加入 roles
- [x] 加入 MCP RPB-M1–M3（夹具本地 Bearer）
- [x] primary-ready 为 Roles 定义真实列表＋筛选可用

### Task W1.2：相对闸与归档

- [x] 写出 `report.json`（Spec §6 字段）
- [x] 实现 D6 diff；无上版 → `baseline-seed`
- [x] npm script 入口 + Current Commands 登记

### Task W1.3：夹具分档

- [x] 文档化 ci-small vs release-medium 下限
- [x] CI 子集命令与发版全量命令分离

## Wave 2 — 发版挂钩

### Task W2.1

- [x] 发版列车／checklist 增加本门禁
- [x] 种子一条正式基线（授权后首次 pass）供后续相对比

## 验收

- [x] Spec SC-01–SC-16 有证据路径（[`acceptance`](../reviews/2026-11-13-release-perf-baseline-gate-acceptance.md)）
- [x] `lint:spec-docs` 对本 Spec／Plan 无新增阻塞／相关单测绿
- [x] 发版文档可见勾选（P4-9／G7）

## 完成定义

- [x] Runner 可测 Roles＋MCP；相对闸可跑
- [x] Wave 0 债关闭（RPB-S1／W4）
- [x] 命令已登记；未宣称可上线

## 风险

| 风险 | 缓解 |
|---|---|
| 只加门禁不修 Roles | Spec 禁止；Wave 0 前置 |
| PR 过慢 | CI 只跑小夹具 |
| 相对闸抖 | D6 双条件；同机 |

## 浏览器验证

不适用：Spec 已交互合同豁免；本 Plan 不做产品交互浏览器验收。性能测量若用 Playwright，仅作计时 harness，视口沿用 Spec 174（1440×900），不代替发版 UX 走查。
