# 访问关系图固定已确认关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-11-05 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261105-access-map-confirmed-only-spec.md`](../specs/lucy-20261105-access-map-confirmed-only-spec.md)（**v0.3 可定稿**） |
| 权威语义 | 本 Spec D1–D15／§7；inquiryKind／accessGrade／守恒以 audit-echo＋Spec 187 为准（trust 可切换面以本 Spec 废止表为准）；小时明细测试缝以 hourly-detail 为准 |
| 状态 | **v0.3 功能合同已收口（2026-11-05）**。SC-01–SC-14 通过；实施笔记与收口记录已入库。本条收口不表示可上线 |
| 授权边界 | **定稿可改 `docs/`、术语、`docs/qa/selector-contract.md`（D11）**。webui 须「按本 Plan 开工」。不授权镜像、部署、`git push`、功能合同收口签字（除非另授） |
| 验收 | Spec SC-01–SC-14。`lint:spec-docs` 为 S3 工程检查 |
| 实施主体 | Lucy WebUI。不修改 KTX |

**Goal:** 取消关联口径筛选；访问面（E／D／明细）硬锁已确认关联；保留静态披露。

**Architecture:** 路由用原始查询串 → `URLSearchParams` 解析 trust；B SQL 删 include 分支；UI 删下拉；HTTP 400 用 `data.param`；明细经测试缝打假；定稿改写 D11。

**Tech Stack:** TypeScript、Fastify、access-map／echo／hourly-detail、React、Vitest

## Global Constraints

- 不改边状态机、授权骨架、geometry、inquiryKind／accessGrade 非法 400
- trust：键未出现才缺省；出现则 trim 后必须 `confirmed`
- 禁止折叠 `request.query` 判断键存在性；禁止静默回落
- 400 信封：`data.param`；文案「关联口径只接受已确认关联」
- D11 在**定稿时**完成，不进 S3
- 未获开工授权前不改 `webui/`（D11 docs 除外）

---

## 1. 目标

1. 路由＋parse 硬锁（含空串／重复键／HTTP inject／未调用 provider）。
2. B／E／D／detail confirmed-only；测试缝逐桶 id 精确相等。
3. UI 无下拉；字面量披露；首屏非法 trust 原样；400 不改地址栏。
4. 定稿完成 D11／SC-13／SC-14。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | ≤3 轮对抗审阅可定稿 | **满足**（第 3 轮可定稿附条件已闭合） |
| P2 | Spec＋Plan 已落盘并进索引 | **满足** |
| P3 | 「按本 Plan 开工」 | **满足**（2026-11-05） |

## 3. 文件落点

| 路径 | 改动 | 阶段 |
|---|---|---|
| D11 文档集（187／audit-echo／hourly-detail／chart-first／术语 §4.8／selector-contract） | 废止表改写＋语义复扫 | **定稿（S0）** |
| `webui/server/admin/routes/access-map.ts` | 原始 search → parse；保持 400 `{data.param}`；非法不调 provider | S1 |
| `webui/server/admin/access-map.ts` | 专用 trust parse；删 **两处** include SQL（≈2155、2191） | S1 |
| `webui/server/admin/access-map-echo.ts` | 删 include 分支（≈199） | S1 |
| `webui/server/__tests__/p1-access-map*.test.ts` | SC-06–SC-12：HTTP inject 全向量；四条夹具＋测试缝；provider 未调用 | S1 |
| `webui/src/pages/admin/AccessMap.tsx` | 删下拉／hint；现状字面量；首屏原样；400 不改 URL；主动改筛选可省略 trust | S2 |
| `AccessMapTypes.tsx`／`AccessMapLegend.tsx` | 删 hint；legend 字面量 | S2 |
| `webui/src/__tests__/access-map*.test.tsx` | SC-01–SC-05 | S2 |
| 本 Spec／Plan／两索引 | 定稿／收口镜像 | 定稿／收口 |

不改：KTX、Audit.tsx、Spec 173、`gov-filters.ts`。

## 4. 分阶段实施

### S0 定稿文档（SC-13／SC-14）— 定稿时，**不**放 S3

- [x] D11 全文改写（hourly-detail／audit-echo／187／chart-first／术语 §4.8／selector-contract）
- [x] 语义复扫
- [x] 索引改为「可定稿／可交付开发」

### S1 服务端（SC-06–SC-12）— 需 P3

- [x] 红：HTTP 空串／空白／大小写／别名／重复键两序／双 confirmed／`%20confirmed%20`；非法未调 provider；四条夹具＋逐桶 id 精确相等
- [x] 绿：路由原始 search＋SQL 删光 include
- [x] `cd webui && npx vitest run server/__tests__/p1-access-map*.test.ts --maxWorkers=1`

### S2 UI（SC-01–SC-05）— 需 P3

- [x] 红：无下拉；字面量；首屏非法原样；400 不改栏；主动改筛选无 include_candidate
- [x] 实现 ResidentLine／Legend／URL
- [x] `cd webui && npx vitest run src/__tests__/access-map*.test.tsx --maxWorkers=1`

### S3 工程检查（非功能出口）

- [x] `npm run lint:spec-docs`（± terminology）
- [x] 实施笔记（收口时）

## 5. 验收

```bash
cd webui && npx vitest run server/__tests__/p1-access-map*.test.ts src/__tests__/access-map*.test.tsx --maxWorkers=1
cd /Users/forrest/GitHub/project-lucy && npm run lint:spec-docs
```

## 6. 完成定义

- [x] SC-01–SC-14 有证据
- [x] 硬锁＋confirmed-only B／E／D／detail＋无下拉
- [x] D11 定稿已改写
- [ ] 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| Fastify 折叠 query | D12 原始 search；SC-08–SC-10 |
| 空表明细通过 | D15／SC-11 逐桶精确相等 |
| 废止表遗漏 | SC-14 复扫；定稿不做 S3 |
| 400 后点筛选抹掉 trust | D13 时间界 |
| `data.param` 误写成 `error.param` | D14／SC-08 |

## 8. 实施授权

定稿 ≠ P3。明示「按本 Plan 开工」后再开 S1／S2。
