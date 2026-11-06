# Role 目录绑定连接卡呈现 — 实施与收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-04 |
| 主 Spec | [`docs/specs/lucy-20261104-role-catalog-bound-connection-card-ux-spec.md`](../specs/lucy-20261104-role-catalog-bound-connection-card-ux-spec.md) |
| 主 Plan | [`docs/plans/lucy-20261104-role-catalog-bound-connection-card-ux-plan.md`](../plans/lucy-20261104-role-catalog-bound-connection-card-ux-plan.md) |
| 结论 | **v0.2 功能合同已收口**。本条收口不表示可上线 |

## 交付摘要

- `RoleTableGrants`：连接卡「跟随此连接的启用表」；移除高级设置目录绑定入口；进入跟随种子当前连接；关闭最后一个连接确认退回指定表。
- 行级策略禁用说明对齐新控件文案。
- selector-contract 登记新 test id，标注 `table-grants-advanced` 已移除。

## SC 证据

| SC | 结果 | 落点 |
|---|---|---|
| SC-01–SC-07、SC-09 | 通过 | `webui/src/__tests__/role-table-grants.test.tsx` |
| SC-08、SC-10 | 通过 | `webui/src/__tests__/role-detail.test.tsx`（确认＋`row-policy-catalog-bound-disabled`；摘要既有「目录绑定」） |
| SC-11 | 通过 | `npm --prefix webui run lint:terminology`（pretest，1119 files） |
| SC-12 | 通过 | `docs/qa/selector-contract.md` 已更新 |

命令：

```bash
npm --prefix webui test -- src/__tests__/role-table-grants.test.tsx src/__tests__/role-detail.test.tsx
```

结果：2 files / 39 tests passed（含 pretest terminology + ia-boundary）。

## 不在本条出口

浏览器／Playwright 正式跑绿、帮助手册、镜像、部署、commit／push（未另授权）。e2e 断言已跟进改断言，未在本机强制跑 e2e 作为收口门禁。
