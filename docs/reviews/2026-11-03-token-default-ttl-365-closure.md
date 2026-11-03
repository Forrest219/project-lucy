# Token 新建默认有效期 365 天 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-03（Asia/Shanghai） |
| 授权 | 同会话用户批准 C 类功能闭口 |
| 对象 | [Spec v0.3](../specs/lucy-20261101-token-default-ttl-365-spec.md)；[Plan v0.3](../plans/lucy-20261101-token-default-ttl-365-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-08 有本机自动化证据。**本条收口不表示可上线。** 功能编号无 |

## 这次跑过的测试

同会话 Batch1：

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/token-expiry-policy.test.ts \
  src/__tests__/new-token.test.tsx
```

SC-08 Step6 短窗回归：`src/__tests__/token-default-ttl-365-step6.test.ts`（同会话父 agent 补口；本条引用其作为 SC-08 证据，本回合未单独复跑）。

SC-08 的术语 lint 与 §4 落盘清单已于 2026-11-02 [拆出](2026-11-02-functional-contract-exit-split.md)，不在本条出口。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `token-expiry-policy.test.ts`（默认／上限 365） |
| SC-02 | 通过 | `new-token.test.tsx`（初载 today+365，365d active） |
| SC-03 | 通过 | `new-token.test.tsx`（预设四档） |
| SC-04 | 通过 | 同上（非预设日四档无 active） |
| SC-05 | 通过 | 同上（无政策提示 DOM） |
| SC-06 | 通过 | Spec 124 §7 / `SYSTEM_HANDBOOK` 镜像（文档现值） |
| SC-07 | 通过 | UX Spec 文首覆盖注记 + 索引（文档现值） |
| SC-08 | 通过 | `token-default-ttl-365-step6.test.ts`（Step6 默认短窗不变） |
