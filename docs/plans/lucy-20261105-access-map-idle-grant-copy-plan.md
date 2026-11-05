# 访问关系图闲置授权文案与边悬停 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-11-05 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P2**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261105-access-map-idle-grant-copy-spec.md`](../specs/lucy-20261105-access-map-idle-grant-copy-spec.md)（**v0.3 可交付开发**） |
| 权威语义 | Spec 187；本 Plan **不改** API、`dormant`、几何、着色 |
| 状态 | **v0.3 功能合同已收口（2026-11-05）**。SC-01–SC-15 通过。证据见 [closure](../reviews/2026-11-05-access-map-idle-grant-copy-closure.md)。本条收口不表示可上线 |
| 授权边界 | 落盘／审阅只改 docs／inbox。实施可改 `webui/src`、术语、ops 四副本、S3。不涉及镜像／`git push`（除非另授） |
| 验收 | Spec SC-01–SC-15；S3 不计入功能分母 |
| 审阅记录 | [`docs/reviews/2026-11-05-codex-review-access-map-idle-grant-copy.md`](../reviews/2026-11-05-codex-review-access-map-idle-grant-copy.md) |

**Goal:** 「闲置授权」替换「僵尸授权」；访问面可用时边悬停先结论并突出真实调用次数；访问面不可用时明示调用情况暂不可用。

**Architecture:** `accessMapEdgeStateLabel` + `accessMapEdgeHoverConclusion(state)`；`AccessMap.tsx` 传 `accessOk` 给 Canvas；`accessOk===false` 时用 Spec §5.3 降级文案，不调用四态「有／未调用」句。

**Tech Stack:** React、Vitest、术语标准

## Global Constraints

- 不改 API／状态机／着色／几何
- 运行时＋ops 四副本禁「僵尸授权」
- `accessOk`：数字行必须有 `调用 N 次`；禁访问路径；禁「状态：」第四行
- `!accessOk`：禁 `调用 N 次`／「有调用」「未调用」；用「调用情况暂不可用」
- 未授权不改 `webui/src`

## 1. 目标

1. 运行时可见面与 ops 四副本使用「闲置授权」，禁止「僵尸授权」。
2. 访问面可用：边悬停三段式先结论，数字行突出真实 `调用 N 次`。
3. 访问面不可用：悬停降级文案，不以 0／「有调用」「未调用」冒充。
4. 交付物：术语行、两 helper、Canvas 三段式＋降级、`accessOk` prop、SC-01–SC-15、ops 四副本、S3 指针。
5. 不改 API、`dormant` 判定、着色、几何。

## 2. 风险

| 风险 | 缓解 |
|---|---|
| 访问面 unavailable 仍套四态结论 | D9／§5.3／SC-08／SC-15；页面必须传 `accessOk` |
| ops 副本漏改 | 四路径清单＋SC-14 |
| SVG `<title>` 残留旧词或假调用数 | D7／SC-12 |
| 与 Agent「闲置」混淆 | 固定「闲置授权」四字 |
| npm 升级覆盖 codex wrapper | 重跑 `~/.local/share/codex-proxy/install.sh` |

## 3. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | D1–D9 写入 Spec | **满足** |
| P2 | Spec＋Plan＋索引 | **满足** |
| P3 | 用户授权改 `webui/src` | **满足**（2026-11-05「授权开工」） |
| P4 | 设计定稿（Codex 第 3 轮＋F12／F13 补丁） | **满足** |

## 4. 文件落点

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/docs/00-product-terminology-standard.md` | Dormant Grant 行 | S1 |
| `webui/src/components/admin/AccessMapTypes.tsx` | 标签＋结论 helper＋降级常量文案 | S1 |
| `webui/src/pages/admin/AccessMap.tsx` | 向 Canvas 传 `accessOk` | S2 |
| `webui/src/components/admin/AccessMapCanvas.tsx` | 三段式／降级／title／列头 | S2 |
| `AccessMapSignalNotes.tsx` | 口径前缀 | S2 |
| `access-map.test.tsx`／`access-map-layout.test.tsx` | SC-01–SC-13、SC-15 | S1–S2 |
| ops 四路径 | 触发词 | S2 |
| 187／chart-first／quiet-reading／geometry／handbook／selector-contract／TD-187-01 | S3 | S3 |

## 5. 阶段

### S1（SC-01、SC-02、结论 helper）

- [x] 失败测试：标签、四态结论、术语文件断言
- [x] 实现 helper＋术语行
- [x] vitest 相关用例绿

### S2（SC-03–SC-15）

- [x] 测试：四态顺序／禁止项／括注 true·false／`accessOk=false` 降级（含 confirmedUnauthorized 负向）／列头／抽屉／口径／title（含不可用时无调用数字）／ops／`accessOk` prop
- [x] 实现 Canvas＋页面 prop＋ops 四副本
- [x] `vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx --maxWorkers=1` → **101 passed**

### S3（非功能分母）

- [x] 文档指针（chart-first／187／quiet-reading／handbook／selector-contract／TD-187-01／ops-evidence 触发词）
- [x] `lint:spec-docs`／`lint:terminology` → exit 0
- [x] 功能合同收口时改索引状态（2026-11-05 用户授权收口）

## 6. 完成定义

SC-01–SC-15 有证据；降级悬停诚实；API／着色／几何未改；收口不表示可上线。
