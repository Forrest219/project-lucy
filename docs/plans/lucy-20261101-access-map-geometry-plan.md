# 访问关系图几何语言修订 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.2** / 2026-11-01 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [访问关系图几何语言修订 Spec](../specs/lucy-20261101-access-map-geometry-spec.md)（**v0.2 已定稿待实施**） |
| 权威语义 | [Spec 187](../../webui/docs/187-access-relation-sankey-spec.md)。不改 API、边状态、URL 值、两档措辞、路径守恒 |
| 前序呈现 | [quiet-reading](../specs/lucy-20261030-access-map-quiet-reading-spec.md)；[chart-first](../specs/lucy-20261101-access-map-chart-first-spec.md) |
| 状态 | **v0.2 已定稿待实施（2026-11-01）**。已吸收交叉审阅并定稿。本条收口不表示可上线 |
| 授权边界 | 本轮文档定稿可改 Spec/Plan/索引。改 `webui/src` 须用户开发授权。不镜像构建、不部署、不 `git commit`/`push`（除非另授） |
| 验收 | Spec SC-01–SC-16；映射见 §5。完整发布走查 / Playwright 套件不在出口；SC-16 为 demo 桌面截图人工验收 |
| 实施主体 | Lucy WebUI `webui/src`。不修改 KTX，不修改 `webui/server/admin/access-map.ts` |
| 审阅 | [`inbox/2026-11-01-access-map-geometry-spec-plan-cross-review.md`](../../inbox/2026-11-01-access-map-geometry-spec-plan-cross-review.md) → v0.2 |

**Goal:** 将访问关系图改为细柱 + `labelBlock` + 刻度封顶 + 四态面积流带；计量与命中解耦；`DEMO_SPARSE_9` 达到约定占比；不改 Spec 187 语义与 quiet-reading 着色 token。

**Architecture:** 重写 `layoutAccessMap` 与 `AccessMapCanvas` 绘制；页壳不动。导出 `PILLAR_WIDTH`、`MAX_PX_PER_PATH`、`NODE_GAP`、`MIN_HIT_PX`。槽位按对端 y 排序。

**Tech Stack:** React、自研 SVG、Vitest（`access-map-layout.test.tsx` / `access-map.test.tsx`）

## Global Constraints

- 不改 API、边状态机、措辞、Token 过滤原文、URL、路径守恒
- 不重开 quiet-reading D3；不取消刻度封顶来撑槽位
- 不新增运行时依赖；不新增裸 hex
- 本条收口不表示可上线

---

## 1. 目标

1. 细柱 + `labelBlock` 外标 + 强制避碰（SC-01/02/09）。
2. `MAX_PX_PER_PATH=24`、`DEMO_SPARSE_9` 高度区间与稀疏居中/缩槽（SC-03/04/10）。
3. 四态面积流带、虚线中线、overflow 夹紧、按 y 分槽、计量/命中解耦（SC-05–SC-08/11–13）。
4. 文档指针 + 术语门禁 + demo 桌面截图（SC-14–SC-16）。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.2 已定稿，D1–D12 已拍板 | **满足**（2026-11-01） |
| P2 | 用户批准按审阅修订意见定稿 | **满足**（「接受你的修订意见，请修正后定稿」） |
| P3 | 开发授权（改 `webui/src`） | **待用户下一句授权** |

S0 仅文档；直至 P3 才改 `webui/src`。

## 3. 文件落点

### 3.1 修改（实施阶段）

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/components/admin/AccessMapCanvas.tsx` | 细柱、labelBlock、封顶、四态面积带、按 y 分槽、命中层、稀疏居中/缩槽 | S1–S2 |
| `webui/src/__tests__/access-map-layout.test.tsx` | SC-01–SC-10（见 §5） | S1–S2 |
| `webui/src/__tests__/access-map.test.tsx` | SC-05（组件侧）、SC-07（着色/线型）、SC-11–SC-14 | S2 |
| `docs/qa/selector-contract.md` | 仅当新增可见流带 test id 时更新 | S2 |
| `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` | §5.4 被本 Spec 取代的指针 | S3 |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | §5.6 卡片沿用句改指本 Spec | S3 |
| `webui/docs/187-access-relation-sankey-spec.md` | **必须**增补本 Spec 几何呈现指针 | S3 |
| `docs/reviews/` 或 `inbox/` | SC-16 截图与简短审阅记录 | S4 |

### 3.2 不改

- `webui/server/admin/access-map.ts` 与服务端测试
- 页壳 KPI/弱入口合同（chart-first）
- KTX / Helm / 术语标准正文

## 4. 分阶段实施

### S0 文档定稿（本轮）

- [x] Spec / Plan 修订为 v0.2
- [x] 索引状态更新
- [x] `npm run lint:spec-docs`（定稿后执行，记入 §8）

**出口**：v0.2 可实施；无 `webui/src` 改动。

### S1 布局几何与避碰

1. 导出常量：`PILLAR_WIDTH=16`、`MAX_PX_PER_PATH=24`、`NODE_GAP=16`、`MIN_HIT_PX=8`。
2. 重写步进与 `labelBlock`（首左/中上/末右）；计量柱高 = `flow*unitPx`。
3. `DEMO_SPARSE_9` 夹具；稀疏居中或缩槽（不抬 `unitPx`）。
4. 槽位按对端 y 分配；计量宽度无地板。
5. 布局测试：SC-01–SC-04、SC-06、SC-08–SC-10。

**出口**：上列 SC 自动化绿。不把「肉眼看一眼」当作本阶段正式出口（正式视觉出口在 S4）。

### S2 四态面积带与交互

1. 面积 fill path；needs_review 虚线中线；overflow 夹紧 + danger 轮廓。
2. 可见 hit：dormant 授权面积、needs_review 独立带、normal/overflow 面积可点。
3. 悬停浮层覆盖 dormant。
4. 组件测试：SC-05、SC-07、SC-11–SC-14。

**出口**：上列 SC 自动化绿。

### S3 交叉引用与门禁

1. **必须**更新 quiet-reading、chart-first、Spec 187 指针。
2. `npm run lint:terminology`、`npm run lint:spec-docs` → SC-15。

**出口**：SC-15；三处指针一致。

### S4 桌面截图（SC-16）

1. 当前 demo（或等价 `DEMO_SPARSE_9` 实页）桌面视口截图。
2. 核对：占比/留白、三列外标、四态（可用测试夹具补异常态截图）、悬停与点击。
3. 记录写入 `docs/reviews/` 或 `inbox/`，收口时引用。

**出口**：SC-16 有据；**本条功能合同可收口**（仍不表示可上线）。

## 5. 验收（唯一 SC 映射）

| SC | 阶段 | 测试文件 / 证据 |
|---|---|---|
| SC-01 | S1 | `access-map-layout.test.tsx` |
| SC-02 | S1 | `access-map-layout.test.tsx` |
| SC-03 | S1 | `access-map-layout.test.tsx` |
| SC-04 | S1 | `access-map-layout.test.tsx`（含 `DEMO_SPARSE_9`） |
| SC-05 | S2 | `access-map-layout.test.tsx` + `access-map.test.tsx`（禁止「仅超粗 stroke」） |
| SC-06 | S1 | `access-map-layout.test.tsx` |
| SC-07 | S2 | `access-map-layout.test.tsx` + `access-map.test.tsx` |
| SC-08 | S1 | `access-map-layout.test.tsx` |
| SC-09 | S1 | `access-map-layout.test.tsx` |
| SC-10 | S1 | `access-map-layout.test.tsx`（+ 必要时组件容器断言） |
| SC-11 | S2 | `access-map.test.tsx` |
| SC-12 | S2 | `access-map.test.tsx`（含 dormant 可见面积悬停） |
| SC-13 | S2 | `access-map.test.tsx`（可见 path 点击，不只隐藏按钮） |
| SC-14 | S2 | `access-map.test.tsx` / 静态扫描 |
| SC-15 | S3 | `npm run lint:terminology` |
| SC-16 | S4 | 桌面截图 + 短记录 |

建议命令（S1–S3）：

```bash
cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
cd .. && npm run lint:terminology && npm run lint:spec-docs
```

## 6. 完成定义

- S0–S4 勾销
- SC-01–SC-16 均有通过记录
- 索引状态可更新为功能合同已收口
- **本条收口不表示可上线**

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 旧测试绑 168 卡片 / 粗 stroke / 卡内 labelBox | S1 先改布局契约 |
| 中间列外标与流带重叠 | 柱上放置 + SC-09 上下缘采样 |
| 计量地板回流 | 禁止 `max(2, w*unit)` 进槽位；命中用 `MIN_HIT_PX` |
| 封顶后迷你顶条 | SC-04 高度窗 + SC-10 居中/缩槽 |
| 虚线只画在 fill 外框 | 强制中线 path + SC-07 |
| 只点隐藏按钮假绿 | SC-13 显式点可见面积 |
| 误改着色 token | SC-11；拒 D3 重开 |
| demo 未重建 | SC-16 可对已运行实例；重建非出口 |

## 8. 落盘与定稿记录

| 项 | 结果 |
|---|---|
| Spec | `docs/specs/lucy-20261101-access-map-geometry-spec.md` **v0.2** |
| Plan | 本文件 **v0.2** |
| 索引 | `docs/README.md`、`docs/plans/README.md` |
| v0.1 `lint:spec-docs` | 通过（2026-11-01） |
| v0.2 `lint:spec-docs` | **通过**（2026-11-01）：exit 0；356 files scanned。WARN 仅他条未跟踪 `*-prompt.md` |
