# 连接服务器地址编辑 — UX Dialog 补口收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-03（Asia/Shanghai） |
| 授权 | 同会话用户批准 C 类功能闭口 |
| 对象 | [Spec v0.4.3](../specs/lucy-20261101-connection-endpoint-edit-spec.md) §12.2；[Plan v0.4.3](../plans/lucy-20261101-connection-endpoint-edit-plan.md) |
| 结论 | **UX 合同收口。** SC-11–SC-14／22／24–27 关闭。服务端 SC-01–SC-10／15–21／23 仍以 [2026-11-01 收口](2026-11-01-connection-endpoint-edit-closure.md) 为准。**整份 Spec 与 Plan 头部现值为功能合同已收口（2026-11-03）。本条收口不表示可上线。** 功能编号无 |

## 这次跑过的测试

同会话 Batch1（含 dialog 与概览）：

```bash
cd webui && npx vitest run --maxWorkers=1 \
  src/__tests__/edit-connection-dialog.test.tsx \
  src/__tests__/connection-overview.test.tsx
```

`edit-connection-dialog.test.tsx` **7/7**；概览 SC-13 primary 计数在 `connection-overview.test.tsx`。

不在本条出口：浏览器 E2E、移动窄屏、镜像、客户交付。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-11 | 通过 | `edit-connection-dialog.test.tsx`（Dialog 打开／预填／步骤） |
| SC-12 | 通过 | 同上（keep 密码、Toast 禁令） |
| SC-13 | 通过 | `connection-overview.test.tsx`（PageHeader 唯一实心 primary） |
| SC-14 | 通过 | 术语标准 New terms + 同会话 `lint:terminology`（过程记录） |
| SC-22 | 通过 | `edit-connection-dialog.test.tsx`（冲突 UI 无新建主按钮文案） |
| SC-24 | 通过 | `edit-connection-dialog.test.tsx`（`pl-modal-backdrop` + 生产 `app.css` 居中规则） |
| SC-25 | 通过 | 同上（`pl-modal-panel`、`aria-modal`、焦点） |
| SC-26 | 通过 | 同上（可编辑字段均在面板内） |
| SC-27 | 通过 | 同上（submitting 禁关） |
