# 访问关系图闲置授权文案与边悬停 — 功能合同收口

| 项 | 内容 |
|---|---|
| Spec | [`docs/specs/lucy-20261105-access-map-idle-grant-copy-spec.md`](../specs/lucy-20261105-access-map-idle-grant-copy-spec.md) **v0.3 → 收口** |
| Plan | [`docs/plans/lucy-20261105-access-map-idle-grant-copy-plan.md`](../plans/lucy-20261105-access-map-idle-grant-copy-plan.md) |
| 审阅 | [`2026-11-05-codex-review-access-map-idle-grant-copy.md`](2026-11-05-codex-review-access-map-idle-grant-copy.md)（三轮，F09–F13 已闭合） |
| 日期 | 2026-11-05 |
| 结论 | **功能合同已收口**。SC-01–SC-15 本机自动化通过。本条收口不表示可上线 |

## 证据

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run server/__tests__/p1-access-map.test.ts server/__tests__/p1-access-map-confirmed-only.test.ts server/__tests__/ops-evidence-governance-closure.test.ts src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx src/__tests__/audit-trust-page-integration.test.tsx --maxWorkers=1` | 6 files / 178 tests passed |
| `npm run lint:spec-docs` | passed（400 files） |
| `npm run lint:terminology` | passed（1122 files） |

## SC 落点

| SC | 落点 |
|---|---|
| SC-01／SC-02 | `access-map.test.tsx`（标签 helper 单测；术语标准读文件断言，L261／L265） |
| SC-03–SC-08 | `access-map.test.tsx` 悬停三段式与降级用例（L524–L622；二次覆盖 L858–L904） |
| SC-09–SC-12 | `access-map.test.tsx` 列头／抽屉／口径前缀／SVG title（L683／L710／L728／L743；二次覆盖 L916–L948） |
| SC-13 | `access-map.test.tsx` 用户可见期望串负向断言（L762）＋两份测试文件自身扫描 |
| SC-14 | `access-map.test.tsx` ops 四路径读文件断言（L289／L775）；第 4 份 demo 模板副本盘上已是新词 |
| SC-15 | `access-map.test.tsx` `accessOk` prop 源码合同（L1539）；页面 `AccessMap.tsx` 传 `meta.access.state === "ok"` |

## 不在本条出口（未做）

浏览器走查、Playwright、窄屏、镜像、部署、改边状态机／API／几何／着色、Agent 名册「闲置」改名。

## 残留说明

- `AccessMapCanvas.tsx` 等源码注释中仍有「僵尸授权」字样：注释不构成运行时可见面，不在 SC-01／SC-13 出口范围；lint:terminology 扫描通过。
- `governance-snapshot.ts` 等 confirmed-only 改动归另条 Spec，不与本条互证。
