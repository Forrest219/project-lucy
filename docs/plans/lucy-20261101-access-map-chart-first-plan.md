# 访问关系图图优先呈现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.2** / 2026-11-01 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [访问关系图图优先呈现 Spec](../specs/lucy-20261101-access-map-chart-first-spec.md)（**v0.1 已定稿待实施**） |
| 权威语义 | [Spec 187](../../webui/docs/187-access-relation-sankey-spec.md)。本 Plan 不改其 API、边状态、URL 值、两档措辞。Spec 187 的 SC-01–SC-14 不在本条出口 |
| 前序呈现 | [quiet-reading Spec](../specs/lucy-20261030-access-map-quiet-reading-spec.md) / [Plan](2026-10-30-lucy-access-map-quiet-reading-plan.md)。本条**取代**其页壳三卡+双折叠；**保持**着色、抽屉、表 |
| 状态 | **v0.2 实施完成（2026-11-01）**。用户已批准方案 A′ 与 Spec/Plan 落盘。S1–S3 全部落地，SC-01–SC-14 均有自动化断言并通过。本条收口不表示可上线 |
| 授权边界 | 改访问关系图页呈现与对应组件/布局测试、selector-contract 必要行、quiet-reading / Spec 187 的交叉引用句（若需指向本 Spec）。**不涉及**构建镜像、部署、`git commit` / `git push`（除非用户另授）、浏览器走查 |
| coder 交付提示词 | 由委托方在会话内下发，**不入库**（该文件不是 Plan，入 `docs/plans/` 会被形状门禁判为 7 条阻塞项）。本 Plan 与主 Spec 即其执行契约 |
| 验收 | Spec SC-01–SC-14；组件测试 + 布局测试 + `npm run lint:terminology`。浏览器走查不在本条出口 |
| 实施主体 | Lucy WebUI `webui/src`。不修改 KTX，不修改 `webui/server/admin/access-map.ts` |

**Goal:** 让 `/admin/access-map` 以关系图为主视觉：去掉三 KPI 卡与双折叠墙，图例短行置顶贴图，口径与快照沉底弱入口，并改善图区高度、栏距与悬停可读性。

**Architecture:** 只改页壳与 `AccessMapCanvas`/`AccessMapLegend` 呈现；语义与 API 不动。信号筛选 UI 本轮删除。图例拆成「短行四项」与「信任/窗口元信息」两部分，后者进图下折叠。

**Tech Stack:** React、既有 SVG 布局、Vitest（`access-map.test.tsx` / `access-map-layout.test.tsx`）

## Global Constraints

- 不改 `/api/admin/access-map`、边状态机、两档措辞、Token 过滤原文、URL 参数合法值
- 禁止用「桑基图」作页面标题；需复核文案禁「越权」
- 选中态禁止 `pl-btn--primary`
- 不新增运行时依赖；不新增裸十六进制颜色
- 本条收口不表示可上线；不做窄屏专项

---

## 1. 目标

四个交付物：

1. **页壳**：无三 Metric Card；无双独立 `details`；partial 轻量保留；Tab 后接图例短行与抬高图区。
2. **弱入口**：图下「口径与快照」承载原口径全文、覆盖率、调用数、信任/窗口 ISO、`access-map-snapshot-id`。
3. **图面**：列间距加大、主区 min-height、自定义悬停浮层；着色与抽屉不变。
4. **测试与索引**：改写与三卡/双折叠冲突的断言；SC-01–SC-14 可打假；索引已登记。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.1 已定稿，D1–D8 已拍板 | **满足**（2026-11-01） |
| P2 | 用户批准 Spec + Plan 落盘 | **满足**（「批准按规范落地 spec 和 plan」） |
| P3 | 开发授权（改 `webui/src`） | **待用户下一句授权**；落盘本身不改业务代码 |

S0 不改 `webui/src`，直至 P3 满足。

## 3. 文件落点

### 3.1 修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/pages/admin/AccessMap.tsx` | 移除 SignalBar 三卡与双 details；partial 保留；图下弱入口；关系图分支组装图例短行 | S1 |
| `webui/src/components/admin/AccessMapSignalBar.tsx` | 拆出/收敛：默认页不再挂载三卡；notes 供弱入口复用（可保留 `AccessMapSignalNotes` 导出） | S1 |
| `webui/src/components/admin/AccessMapLegend.tsx` | 短行只渲染四项；trust/window 可拆成副组件或 props 控制，供弱入口使用 | S1 |
| `webui/src/components/admin/AccessMapCanvas.tsx` | 列间距、容器 min-height、悬停浮层 | S2 |
| `webui/src/__tests__/access-map.test.tsx` | 按本 Spec SC 改写：无三卡、弱入口、legend 位置、partial、抽屉与术语相关 | S1–S2 |
| `webui/src/__tests__/access-map-layout.test.tsx` | 栏距/min-height/悬停或色值扫描 | S2 |
| `docs/qa/selector-contract.md` | 必要时更新 signal 卡行说明（移除或标注已删除）；补弱入口 test id | S1 |
| `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` | 文首或关系句：页壳被本 Spec 再修订 | S3 |
| `webui/docs/187-access-relation-sankey-spec.md` | 呈现修订指针可增补本 Spec（信号条 UI 以本条为准） | S3 |

### 3.2 不改

- `webui/server/admin/access-map.ts` 与其服务端测试
- KTX、Helm、镜像、术语标准正文（`New terms: None`）
- 本轮不新增图例点击筛选

## 4. 分阶段实施

### S1 页壳与弱入口（D2–D6）

1. 从 `AccessMap.tsx` 移除 `<AccessMapSignalBar />` 三卡挂载与两个独立 `details`。
2. 删除或停用信号筛选 state（优先删除死代码）。
3. 关系图 Tab 下、Canvas 前渲染图例短行（四项）。
4. Canvas 后渲染单个「口径与快照」`<details>`，迁入 notes / coverage / calls / orphan / trust / window / snapshot-id。
5. Partial notice 保持 `access-map-partial-notice`，确认使用 `pl-notice`。
6. 更新组件测试：SC-01–SC-06、SC-12 中与页壳相关的部分。

**出口**：无三卡、无双宽条；legend 在图前；弱入口可展开验 id；相关单测红转绿。

### S2 图面几何与悬停（D7–D8）

1. 加大 `layoutAccessMap`（或等价）列间距常量。
2. 图区容器加 `min-height`（或计算剩余视口高度的策略），测试可断言。
3. 实现节点/边自定义悬停浮层（非仅 `<title>`）；边含从→到与状态。
4. 确认着色与抽屉回归（SC-09、SC-10）。
5. 布局测试覆盖 SC-07、SC-08、SC-13。

**出口**：SC-07–SC-11、SC-13 有自动化断言。

### S3 文档交叉引用与门禁

1. quiet-reading Spec 增加「页壳被 chart-first 再修订」指针。
2. Spec 187 呈现修订句可并列指向本 Spec（信号条/指标卡 UI）。
3. `npm run lint:terminology`、`npm run lint:spec-docs`。
4. Spec / Plan / 索引状态在收口时更新（本落盘轮次先保持「待实施」）。

**出口**：SC-14；文档指针一致。

## 5. 验收

以主 Spec §7 SC-01–SC-14 为准。

建议命令（实施阶段）：

```bash
cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
cd .. && npm run lint:terminology && npm run lint:spec-docs
```

浏览器走查、demo 重建不在本条出口。

## 6. 完成定义

- S1–S3 任务勾销
- SC-01–SC-14 均有通过记录
- 索引中本 Spec/Plan 状态可更新为功能合同已收口
- **本条收口不表示可上线**

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 旧测试强绑三卡 / `access-map-signal-*` | S1 先改测试契约再改 DOM；selector-contract 同步 |
| 去掉筛选后无法只看「需复核」边 | 接受为方案 A；另开 Spec 再做图例筛选 |
| 悬停浮层挡点击 | 浮层不拦截指针；点击仍走节点/边原回调 |
| min-height 在短视口过大 | 用合理上限或 `min()`；横滚仍可用 |
| demo 镜像未重建 | 与出口分离；用户自行 `demo:upgrade` |

## 8. 落盘记录

| 项 | 结果 |
|---|---|
| Spec | `docs/specs/lucy-20261101-access-map-chart-first-spec.md` v0.1 |
| Plan | 本文件 v0.1 |
| 索引 | `docs/README.md`、`docs/plans/README.md` |
| `lint:spec-docs` | **通过**（2026-11-01）：`npm run lint:spec-docs` exit 0；347 files scanned |

## 9. 实施轮记录（2026-11-01）

S1–S3 实施完成。命令与结果如下，SC-01–SC-14 的逐条落点见
[`docs/reviews/2026-11-01-access-map-chart-first-implementation-notes.md`](../reviews/2026-11-01-access-map-chart-first-implementation-notes.md)
（委托方指定路径的同内容副本在 `inbox/2026-11-01-access-map-chart-first-IMPLEMENTATION_NOTES.md`）。

| 项 | 结果 |
|---|---|
| `cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx` | **通过**：2 files / 46 tests passed，0 failed |
| `npm run lint:terminology` | **通过**：exit 0；1092 files scanned |
| `npm run lint:spec-docs` | **失败，且非本条引入**：exit 1；唯一阻塞项是 `docs/specs/lucy-20261030-audit-context-bar-spec.md` [close-layer]「本条承诺（v1.1）」写法不被形状门禁认作「本条承诺」。该文件属另一条工作线的在途改动，不在本条落点（Plan §3），故本轮**未**代改。本条自身的 Spec / Plan / 两处指针 / `webui/docs/187-access-relation-sankey-spec.md` 均无形态违规 |
| `webui/scripts/check-selector-contract.mjs` | exit 1，但 202 项告警全部落在本条之外的在途工作域（row-policy / workbench-publish / audit / role / skill / table-editor / wiki）；按 `access-map` / `AccessMap` 过滤**零命中**，即本条新增的 `access-map-methodology-snapshot`、`access-map-hover-tip` 与迁移后的 notes 行全部一致 |
| 浏览器走查 / 镜像构建 / 部署 / `git commit` / `git push` | **未执行**（不在本条出口） |
