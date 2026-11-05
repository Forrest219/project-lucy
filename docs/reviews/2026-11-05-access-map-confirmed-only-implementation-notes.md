# 访问关系图固定已确认关联 — 实施笔记

| 项 | 内容 |
|---|---|
| Spec／Plan | [`lucy-20261105-access-map-confirmed-only-spec.md`](../specs/lucy-20261105-access-map-confirmed-only-spec.md)／[`…-plan.md`](../plans/lucy-20261105-access-map-confirmed-only-plan.md) v0.3 |
| 开工 | 2026-11-05 用户「开工」 |
| 状态 | S1–S2 已落地；**功能合同已收口（2026-11-05）**，证据见 [收口记录](../reviews/2026-11-05-access-map-confirmed-only-closure.md)。本条收口不表示可上线 |

## 落地摘要

- **解析／路由**：`parseTrustParam` 仅键未出现缺省；键出现 trim 后必须 `confirmed`。路由用原始 `request.url` 查询串构造 `URLSearchParams`。
- **SQL**：`access-map.ts` 两处与 `access-map-echo.ts` 一处删除 `include_candidate` 分支，固定 `association_status = 'confirmed'`。
- **UI**：删除关联口径下拉／hint；现状与 `AccessMapLegendMeta` 字面量「关联口径：已确认关联」；首屏非法 trust 原样请求；主动改其它筛选时省略 trust。
- **gov**：`governance-snapshot` 调用 access-map 时固定 `trust: "confirmed"`（gov 枚举未删）。

## 验证

```text
cd webui && npx vitest run server/__tests__/p1-access-map*.test.ts src/__tests__/access-map*.test.tsx server/__tests__/ops-evidence-governance-closure.test.ts --maxWorkers=1
→ 8 files / 192 passed
npm run lint:spec-docs → passed
```

## 未做

- 浏览器走查／镜像／部署（不在本条出口）
