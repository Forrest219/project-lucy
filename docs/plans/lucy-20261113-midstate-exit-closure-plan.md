# 中间态出口收口 Implementation Plan

> **For agentic workers:** Execute Task 1→5 in order. Checkbox tracking. Prefer TDD on Task 1.

**Goal:** 按 [盘点](../reviews/2026-11-13-025-to-030-midstate-inventory.md) 把半成品收口，形成可站立的中间态出口声明。未开工条目（P0-6／7／B 等）一律不碰。

**Architecture:** ① 唯一运行代码半成品＝Edit 连接成功面对齐 create；② 桑基／扫表／Skill 以复验＋文档收口为主；③ 总览一句出口。

**Tech Stack:** React／Vitest；既有 access-map／catalog-scan／skill 测；Markdown 镜像。

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 状态 | **可执行**（委托人批准顺序） |
| 授权 | Task 1 属已授权连接重载 Plan 残留；Task 2–4 文档／复验；不新开 P0-6／7／B |
| 非目标 | UAT-CONN-RELOAD-02；nit 清债；客户可上线 |

---

## Task 1: EditConnectionDialog 执行层三段事实

**Files:**
- Modify: `webui/src/components/connections/EditConnectionDialog.tsx`
- Modify: `webui/src/__tests__/edit-connection-dialog.test.tsx`（或等价）
- Modify: `docs/plans/lucy-20261112-connection-create-execution-runtime-reload-plan.md` Task 3
- Reference: `CreateConnectionDrawer` 成功步 `create-connection-execution-runtime`

- [x] 1.1 读 create 成功面与 edit 现状／endpoint API 返回字段
- [x] 1.2 红测：成功后面板展示「已加载」／「尚未确认加载＋重载引导」／禁止「已全部生效」
- [x] 1.3 最小实现：消费 `executionRuntimeAck`（或等价）并渲染 testid
- [x] 1.4 相关 vitest 绿（edit-dialog + endpoint API **14/14**）
- [x] 1.5 Plan Task 3 勾选；changelog 一行

---

## Task 2: 访问关系图空桑基 — 复验＋功能合同收口

**Files:**
- Modify: Plan／Spec 头部与勾选
- Create: `docs/reviews/2026-11-13-access-map-sankey-empty-fix-closure.md`（或等价名）
- Mirror: overview／plans README 按需

- [x] 2.1 确认 Spec SC 列表与现有自动化入口
- [x] 2.2 复跑相关 vitest／冒烟；记录结果（24/24）
- [x] 2.3 写收口记录（SC 表）；Spec 头「功能合同已收口」
- [x] 2.4 Plan 勾选与 Progress 对齐代码事实
- [x] 2.5 索引镜像一句

---

## Task 3: 库内扫表 — Plan 对齐＋入池口径

- [x] 3.1 Plan Progress／勾选与 Spec「已收口」对齐（不重开实现）
- [x] 3.2 书面裁定：**不入 0.30 产品分母**（事故修复）或入池——默认**不入分母**，盘点／README 一句
- [x] 3.3 plans README／overview 同句

---

## Task 4: MCP Skill 入口 — 镜像核对

- [x] 4.1 对照 closure：overview／README／Spec 头无「仍 OPEN」分叉
- [x] 4.2 有分叉则改一句；无则盘点标 CLOSED

---

## Task 5: 中间态出口声明

- [x] 5.1 盘点 §4／§0 勾选：§1 四项 CLOSED
- [x] 5.2 overview／清单池「中间态已出口」一句；**≠ 可上线；≠ 核心升级完成**
- [x] 5.3 本 Plan 全勾；报告收口摘要（不默认 push／不默认开 finishing 合并，除非委托人要求）

---

## 验收

1. Task 1 vitest 绿；Edit 面有执行层三段事实 testid  
2. 桑基收口记录存在且 Spec 头已收口  
3. 扫表 Plan 不再与 Spec 矛盾；入池口径写死  
4. Skill 无镜像分叉  
5. 盘点文件声明中间态出口  

**Commit：** 各 Task 可单独 commit；委托人未要求则执行中可提交文档＋代码（本 Plan 授权收口提交）。
