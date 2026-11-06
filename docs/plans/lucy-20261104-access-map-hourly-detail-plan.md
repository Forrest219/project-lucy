# 访问关系图小时明细表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-11-04 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261104-access-map-hourly-detail-spec.md`](../specs/lucy-20261104-access-map-hourly-detail-spec.md)（**v0.3 可定稿**） |
| 权威语义 | [Spec 187](../../webui/docs/187-access-relation-sankey-spec.md) 授权／边状态；[audit-echo](../specs/lucy-20261102-access-map-audit-echo-spec.md) 的 E／D（**取消 Token 条件**）；本 Plan **不改**几何与边状态机 |
| 前序呈现 | chart-first／quiet-reading：本条再修订其弱入口、凭证清单与边级数据表；§7.5 按 Spec D11 能力收缩 |
| 状态 | **功能合同已收口（2026-11-04）**。S1–S3 已落地。本条收口不表示可上线。实施笔记见 [`docs/reviews/2026-11-04-access-map-hourly-detail-implementation-notes.md`](../reviews/2026-11-04-access-map-hourly-detail-implementation-notes.md) |
| 授权边界 | 落盘本身只改 `docs/`。实施阶段可改 access-map 服务端／页面／组件／测试与交叉指针。不涉及镜像、部署、`git push`（除非用户另授） |
| 验收 | Spec SC-01–SC-18（功能出口）；Vitest 服务端＋组件。S3 工程门禁（指针／索引／lint）**不计入**功能出口 |
| 实施主体 | Lucy WebUI。不修改 KTX |

**Goal:** 让 `/admin/access-map` 的「数据表」成为同投影下的小时级可审计明细；去掉凭证清单与 Token 条件；图下口径改为常驻行（含窗口起止与覆盖率压缩披露）。

**Architecture:** provider **一次** `buildBandED`（先判 `result.ok`，`tokenLabel=null`）得到 E／D 与调用行；图与 `detail` 共用。明细先按小时键聚合，再 scope 字段过滤，再按 focus 子图／实体规则投影，最后稳定排序分页。测试缝逐桶 ID 集与预写夹具相等。UI 删除 CredentialList 与折叠弱入口，替换 Table 主内容；SC-15 组件覆盖 §5.5 全分支。

**Tech Stack:** TypeScript、既有 audit SQLite／echo 模块、React、Vitest

## Global Constraints

- 不改边状态机、授权骨架编译、geometry、inquiryKind／accessGrade／trust 缺省与非法 400（audit-echo）
- **取消 Token 条件**；`token` 忽略
- 禁止用 Σ `allowCalls` 冒充 `|E|`；守恒用全局调用 ID＋预写行键→逐桶 ID 集
- 禁止「桑基图」作页标题；§7.5 全边等价主表义务按 D11 收缩
- 本条收口不表示可上线；不做窄屏／浏览器走查出口

---

## 1. 目标交付物

1. **服务端 `detail`**：一次准备（`result.ok`）、小时桶、scope／focus、分页／hasMore、逐桶 ID 测试缝、SC-07–SC-14／SC-17。
2. **页壳**：无凭证清单、无 Token UI、常驻口径行（窗口＋覆盖率＋哈希）、表视图换新表、§5.5 全分支组件断言。
3. **测试**：预写行键→逐桶 ID 集相等（含交换夹具）；分页四态；token 忽略；deny-only／unavailable／越界／partial。
4. **S3 工程**：指针／索引／selector-contract／lint（非功能出口）。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec 设计决策已批准 | **满足**（2026-11-04）；v0.3 可定稿 |
| P2 | Spec＋Plan 已落盘并进索引 | **满足** |
| P3 | 用户授权修改 `webui/server` 与 `webui/src` | **满足**（2026-11-04「按本 plan 开工」） |

## 3. 文件落点

### 3.1 修改／新增

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/server/admin/access-map-hourly-detail.ts`（新建）或 `access-map.ts` 内聚 | `prepareBand`（先 `result.ok`）、`buildHourlyBuckets`（导出测试缝）、project、page | S1 |
| `webui/server/admin/access-map.ts` | `token` 忽略；`detailLimit`／`detailOffset`；一次 band 后挂 `detail`；类型 | S1 |
| `webui/server/admin/access-map-echo.ts` | 调用点强制 `tokenLabel=null`；尽量少改 | S1 |
| `webui/server/__tests__/p1-access-map.test.ts`（± 新 hourly 测文件） | SC-07–SC-14、SC-17；逐桶 ID 相等＋交换夹具 | S1 |
| `webui/src/components/admin/AccessMapTypes.tsx` | `detail`／`hasMore`／`inquiryKind: string \| null` | S2 |
| `webui/src/components/admin/AccessMapTable.tsx` | 小时明细表＋翻页／hasMore | S2 |
| `webui/src/pages/admin/AccessMap.tsx` | 常驻行；删凭证与 details；§5.5 全分支；重置 offset | S2 |
| `AccessMapCredentialList`／`AccessMapSignalNotes` | 停止挂载 | S2 |
| `webui/src/__tests__/access-map.test.tsx`／`access-map-layout.test.tsx` | SC-01–SC-06、SC-15（§5.5 全分支）、SC-16、SC-18 | S2 |
| `docs/qa/selector-contract.md`；chart-first／quiet-reading／187／audit-echo 指针 | S3 工程 | S3 |
| Spec／Plan／两索引状态镜像 | 收口时 | 收口 |

### 3.2 不改

- KTX、Helm、镜像
- 审计页 `Audit.tsx` 主合同
- Spec 189 Default Usage 正文（仅说明凭证清单 UI 已撤）

## 4. 分阶段实施

### S1 服务端小时明细（SC-07–SC-14、SC-17）

- [x] **Step 1:** 失败测试：两小时／两表／allow／deny；预写行键→逐桶 ID 相等＋交换夹具失败；token 忽略；scope／focus；首中末越界页；`buildBandED` `ok:false` → unavailable；deny-only
- [x] **Step 2:** 实现 `prepareBand`（先 `result.ok`）、buckets、project、page；解析 limit／offset
- [x] **Step 3:** `cd webui && npx vitest run server/__tests__/p1-access-map*.test.ts --maxWorkers=1`（含新增 hourly 测）→ **72 passed**

**出口：** 上列 SC 有自动化；map 回归绿。

### S2 页壳与明细表 UI（SC-01–SC-06、SC-15–SC-16、SC-18）

- [x] **Step 1:** 组件测试先红：无 credential-list、无 methodology details、有常驻窗口／覆盖率／哈希与小时列；SC-15 覆盖 grant unavailable／access unavailable／零行／deny-only／越界页／partial
- [x] **Step 2:** 实现页壳与新表；URL 读写 paging；筛选变更重置 offset；§5.5 分支
- [x] **Step 3:** `cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx --maxWorkers=1` → **94 passed**

### S3 工程完成检查（非功能出口）

- [x] 更新 Spec 187／chart-first／quiet-reading／audit-echo 指针（含 Token 取消与 D11）
- [x] selector-contract；`npm run lint:spec-docs && npm run lint:terminology`
- [x] 复跑 S1＋S2；写实施笔记

## 5. 完成定义

- SC-01–SC-18 有证据
- 无凭证清单、无 Token 过滤、无折叠长口径；表为小时明细；常驻行含窗口与覆盖率
- 完整页守恒可打假（含逐桶 ID 集相等）；分页／scope／focus／unavailable／deny-only／越界／partial 有断言
- S3 工程项完成；索引与 Spec／Plan 在用户批准功能合同收口时一次改齐
- 本条收口不表示可上线

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 明细性能 | 仅 table 视图算 detail；limit 上限；hasMore |
| 旧 SC 绑凭证／弱入口 | S2 集中改写 |
| 时区 | +08:00 小时地板；SC-08 |
| 多角色双计 | 全局 ID＋预写键逐桶相等；禁止 Σ 冒充 |
| 分页被误当完整结果 | D10／SC-12 |
| `buildBandED` 失败形态 | D12／SC-17 先判 `ok` |

## 7. 实施授权

落盘 **不**构成 P3。用户明确授权「按本 Plan 改 webui」后再开 S1。
