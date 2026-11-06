# 访问关系图固定已确认关联 — 功能合同收口

| 项 | 内容 |
|---|---|
| Spec | [`docs/specs/lucy-20261105-access-map-confirmed-only-spec.md`](../specs/lucy-20261105-access-map-confirmed-only-spec.md) **v0.3 → 收口** |
| Plan | [`docs/plans/lucy-20261105-access-map-confirmed-only-plan.md`](../plans/lucy-20261105-access-map-confirmed-only-plan.md) |
| 实施笔记 | [`2026-11-05-access-map-confirmed-only-implementation-notes.md`](2026-11-05-access-map-confirmed-only-implementation-notes.md) |
| 审阅 | [`2026-11-05-codex-review-access-map-confirmed-only.md`](2026-11-05-codex-review-access-map-confirmed-only.md)（上限 3 轮已用尽） |
| 日期 | 2026-11-05 |
| 收口批准 | 用户 2026-11-05「授权开发落地，推进到收口」 |
| 结论 | **功能合同已收口**。SC-01–SC-14 本机自动化通过。本条收口不表示可上线 |

## 证据

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run server/__tests__/p1-access-map.test.ts server/__tests__/p1-access-map-confirmed-only.test.ts server/__tests__/ops-evidence-governance-closure.test.ts src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx src/__tests__/audit-trust-page-integration.test.tsx --maxWorkers=1` | 6 files / 178 tests passed |
| `npm run lint:spec-docs` | passed（400 files） |
| `npm run lint:terminology` | passed（1122 files） |

## SC 落点

| SC | 落点 |
|---|---|
| SC-01–SC-05 | `access-map.test.tsx`／`access-map-layout.test.tsx` 组件断言：无 `access-map-trust` 下拉与 hint、现状行与 legend 字面量「关联口径：已确认关联」、首屏非法 trust 原样请求且 400 后地址栏不被改写、主动改筛选写出 URL 无 `include_candidate` |
| SC-06–SC-10 | `p1-access-map-confirmed-only.test.ts`：无键→200 恒 confirmed、`%20confirmed%20`→200、非法全向量（空串／空白／大小写／`confirmed_only`／重复键两序）→400 且 `data.param==="trust"`、HTTP 注入断言非法请求**未调用** provider |
| SC-11 | `p1-access-map-confirmed-only.test.ts` 服务端测试缝：预写候选 allow／deny、已确认 allow／deny 四夹具，逐桶 id 集与预期精确相等；候选两侧 ∉ E／D／明细；核对 `enteringAllowCallCount`／`deniedCalls` |
| SC-12 | `p1-access-map*.test.ts` 授权骨架不因本条要求为空 |
| SC-13 | 文档 diff：D11 表内对象（hourly-detail／audit-echo／Spec 187／chart-first／术语 §4.8／selector-contract）正文已改写或紧贴标注废止 |
| SC-14 | 语义复扫：D11 文档集无残留「可切／含候选／`include_candidate` 作合法 trust／`access-map-trust` 下拉」现行句（残留命中均为历史决策行或禁止句） |

## 不在本条出口（未做）

浏览器走查、Playwright、窄屏、镜像构建、部署、客户环境；Spec 173 关联写入；审计页 association／trust 三态；`gov.*` trust 枚举未删（仅 access-map 数据面硬锁）。

## 残留说明

- `governance-snapshot.ts` 中 gov 枚举仍接受 `include_candidate`，但已不扩宽 access-map SQL／路径集合（代码注释登记）；治理快照如需同步硬锁另起修订。
- audit-echo §7 触发词「闲置授权」归 idle-grant-copy 条，不与本条互证。
