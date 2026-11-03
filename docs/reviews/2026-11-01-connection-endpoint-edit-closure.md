# 连接服务器地址编辑 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai；收口落盘 2026-11-02） |
| 授权 | 委托人选定下一步「先做 connection-endpoint-edit 收口」 |
| 对象 | [`lucy-20261101-connection-endpoint-edit-spec.md`](../specs/lucy-20261101-connection-endpoint-edit-spec.md) v0.3；[`lucy-20261101-connection-endpoint-edit-plan.md`](../plans/lucy-20261101-connection-endpoint-edit-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-23 全部关闭，阻塞 0。**本条收口不表示可上线。** 功能编号无 |

## 出口

本条闭口层级声明的出口：服务端单测 + API 测 + Drawer / 概览组件测 + 术语标准登记行 + `npm run lint:terminology` 退出 0。

不在本条出口：浏览器 / Playwright E2E、移动窄屏、命名环境配置档、改 connection id / database / schemas / enabled_tables、读回密码、自动改 ACL、自动 ingest、列级/Manifest 对账、镜像构建与客户交付、修改 `createConnection` 既有回滚行为。

验收断言原文见主 Spec §12；本文件只给结论与证据落点。

## 这次跑过的测试

```bash
cd webui && npx vitest run \
  server/__tests__/project.connection-endpoint-update.test.ts \
  server/__tests__/api.connection-endpoint-update.test.ts \
  server/__tests__/fs-safe.secret-password.test.ts \
  src/__tests__/edit-connection-drawer.test.tsx \
  src/__tests__/connection-overview.test.tsx
cd .. && npm run lint:terminology && npm run lint:spec-docs
```

**5 个文件 / 81 条通过，0 失败。** `lint:terminology` exit 0（1099 files）。`lint:spec-docs` exit 0。

收口轮次补齐：API 专测文件；SC-08／09／16／19／21 服务端断言；SC-13 概览断言；并将 PageHeader「新建连接」恢复为唯一实心 primary（「启动接入向导」改为 secondary），以对齐本 Spec SC-13 与 Spec 124。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `project.connection-endpoint-update.test.ts`「SC-01…」 |
| SC-02 | 通过 | 同上「SC-02…」 |
| SC-03 | 通过 | 同上「SC-03…」 |
| SC-04 | 通过 | 同上「SC-04/05…」＋ `fs-safe.secret-password.test.ts`「safeOverwriteSecretPassword (endpoint edit)」 |
| SC-05 | 通过 | 同上「SC-04/05…」 |
| SC-06 | 通过 | 同上「SC-06/07…」 |
| SC-07 | 通过 | 同上「SC-06/07…」 |
| SC-08 | 通过 | 同上「SC-08…」 |
| SC-09 | 通过 | 同上「SC-09…」（成功审计无密码；审计失败回滚） |
| SC-10 | 通过 | 同上「SC-10…」 |
| SC-11 | 通过 | `edit-connection-drawer.test.tsx`「SC-11…」 |
| SC-12 | 通过 | 同上「SC-12…」（keep 不带 password；无「问数已切」） |
| SC-13 | 通过 | `connection-overview.test.tsx`「SC-13…」 |
| SC-14 | 通过 | `webui/docs/00-product-terminology-standard.md` 已登记 New terms；`npm run lint:terminology` exit 0 |
| SC-15 | 通过 | project「SC-15…」＋ `api.connection-endpoint-update.test.ts`「SC-15…」 |
| SC-16 | 通过 | project「SC-16…」 |
| SC-17 | 通过 | project「SC-17…」 |
| SC-18 | 通过 | project「SC-18/23…」 |
| SC-19 | 通过 | project「SC-19…」＋ API「SC-19…」 |
| SC-20 | 通过 | API「SC-20…」（`ENDPOINT_EDIT_CONFLICT` detail.matches） |
| SC-21 | 通过 | project「SC-21…」＋ API「SC-21…」 |
| SC-22 | 通过 | drawer「SC-22…」 |
| SC-23 | 通过 | project「SC-18/23…」 |

## 残余，不打回本条

- 空态区「新建连接」按钮当前仍为 secondary（向导在空态可为 primary）；SC-13 出口口径是 **PageHeader** 唯一实心 primary＝「新建连接」，已由概览断言覆盖。空态按钮层级若需与 Spec 124 完全对齐，另开呈现修订。
- 浏览器与 Playwright、移动窄屏、镜像构建、部署、客户交付均未执行，按授权范围不在本条出口。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
