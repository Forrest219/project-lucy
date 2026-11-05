# 访问关系图使用量优先呈现 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.4.2** / 2026-11-05 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1** |
| 主 Spec | [`docs/specs/lucy-20261105-access-map-usage-first-spec.md`](../specs/lucy-20261105-access-map-usage-first-spec.md)（**v0.4.2 可交付开发**） |
| 权威语义 | Spec 187／audit-echo／hourly-detail；scope 路径投影；focus 同 P；折叠使用优先 |
| 状态 | **v0.4.2 可交付开发（2026-11-05）**。故事线合并后 Codex 三轮定稿（F06 附条件已补）。**不 Docker 重建**；收尾 Code Review。收口不表示可上线 |
| 授权边界 | 可改 `webui/src`（含 `AccessMap*`、`Audit.tsx` 深链／inquiryKind 读取）、`webui/server/admin/access-map*.ts`、相关测试与 docs。不做 Docker 重建／`git push`（除非另授） |
| 验收 | Spec SC-01–SC-30；S3 非分母 |
| 审阅记录 | [`docs/reviews/2026-11-05-codex-review-access-map-usage-first.md`](../reviews/2026-11-05-codex-review-access-map-usage-first.md) |

**Goal:** S1–S9；使用优先几何／列序／折叠；`agent=` 重投影；E／P 分账；持久筛选可操作。

**Architecture:** Canvas usage layout；fold 使用优先；scope＝路径字段过滤＋重算（对齐 hourly-detail）；focus＝连通子图且图表同 P；预写期望 ID；审计深链。

**Tech Stack:** React、Vitest、既有 access-map server

## Global Constraints

- 不改边状态机；`enteringAllowCallCount` 语义保持 \|E\|
- 不做 Docker 重建／浏览器 E2E（除非另授）
- 跨页只做深链对照，不做已打开页同步

## 1. 目标

1. SC-01–SC-30 绿。
2. scope 路径投影＋focus 同 P；预写期望集。
3. 持久筛选；使用优先折叠；审计深链。

## 2. 风险

| 风险 | 缓解 |
|---|---|
| \|E\| 对筛选后表 | D22／SC-26 |
| focus 冒充 agent | D21／§5.1.1／SC-22 |
| 折叠藏热表 | D24／§5.8／SC-27 |
| 只比个数错账 | SC-25／26 预写 ID 集 |

## 3. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.4 含 F01–F06 闭合 | **满足** |
| P2 | 索引＋Plan | **进行中** |
| P3 | 故事线合并后 Codex 定稿（≤3 轮） | **满足** |
| P4 | 用户授权改源码 | **满足** |

## 4. 文件落点

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/server/admin/access-map.ts` | fold；scope 路径投影；focus 同 P；\|P\| meta | S1 |
| `access-map-hourly-detail.ts` | 与 scope／focus P 对齐（若有缺口） | S1 |
| `AccessMapCanvas.tsx` | usage 计量、列序、stub、清单 | S1–S2 |
| `AccessMapLegend.tsx` | 图例 | S2 |
| `AccessMap.tsx` | 持久筛选；审计深链；图↔表参数 | S2 |
| `Audit.tsx`（及请求构造） | 读取 inquiryKind／user 等深链参数并打进列表请求（SC-29） | S2 |
| `p1-access-map*.test.ts`／hourly-detail 测试 | SC-22／25–27 | S1–S2 |
| `access-map*.test.tsx` | 其余 SC | S2 |

## 5. 阶段

### S1 服务端：折叠＋重投影＋对账缝

- [x] fold；SC-27
- [x] scope 路径投影（含 table=）；SC-22／26／30
- [x] SC-25／26 预写期望 P（双侧漏数失败）；inquiryKind 变更 ID 集

### S2 前端：几何＋筛选＋图例

- [x] Canvas usage-first；列序／闲置 stub／图例
- [x] 工具条／点击写 agent／focus；SC-23／24／28
- [x] 审计深链 SC-29；|P| UI 披露；闲置清单；降级

### S3

- [x] **不** Docker 重建
- [x] Code Review（High 已补；残留见审阅／实现笔记）
- [ ] 功能合同收口改索引（须另授）

## 6. 完成定义

SC-01–SC-30 有证据；无 Docker 重建；Code Review 通过；收口不表示可上线。

## 7. 验收

以 Spec §1 与 §6 为准。
