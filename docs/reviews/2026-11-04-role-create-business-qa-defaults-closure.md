# 新建角色默认业务问答与工具勾选速查 — 收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-04 |
| Spec | [`docs/specs/lucy-20261104-role-create-business-qa-defaults-spec.md`](../specs/lucy-20261104-role-create-business-qa-defaults-spec.md) v0.1 |
| Plan | [`docs/plans/lucy-20261104-role-create-business-qa-defaults-plan.md`](../plans/lucy-20261104-role-create-business-qa-defaults-plan.md) v0.1 |
| 结论 | **功能合同已收口**。SC-01–SC-12 关闭。**本条收口不表示可上线** |

## 验收证据

| ID | 结果 | 证据 |
|---|---|---|
| SC-01 | 通过 | `webui/src/__tests__/role-permission-draft.test.ts` — `BUSINESS_QA_PRESET` 组成与排除断言 |
| SC-02 | 通过 | `webui/src/__tests__/role-detail.test.tsx` RD-01 |
| SC-03 | 通过 | 同文件 RD-01 / RD-10（「当前与业务问答一致」、引导文案） |
| SC-04 | 通过 | 同文件 RD-02 |
| SC-05 | 通过 | `webui/src/__tests__/role-tool-grants.test.tsx` — 只读问答戳印 |
| SC-06 | 通过 | 同文件 — 业务问答戳印 |
| SC-07 | 通过 | `role-permission-draft.test.ts` — 精确匹配与部分通道 → null |
| SC-08 | 通过 | `role-detail.test.tsx` RD-03 / RD-04 |
| SC-09 | 通过 | 同文件 RD-05（文案含「业务问答」） |
| SC-10 | 通过 | 同文件 RD-07 |
| SC-11 | 通过 | `webui/server/__tests__/help.test.ts` — `role-tool-grant-matrix` 与「新建默认 = 业务问答」 |
| SC-12 | 通过 | `webui/docs/00-product-terminology-standard.md` 已登记业务问答 / 角色工具勾选速查 / 建模配置 |

聚焦命令（2026-11-04）：

```bash
cd webui && npx vitest run \
  src/__tests__/role-permission-draft.test.ts \
  src/__tests__/role-tool-grants.test.tsx \
  src/__tests__/role-detail.test.tsx \
  server/__tests__/help.test.ts --maxWorkers=1
# Test Files  4 passed (4) / Tests  90 passed (90)
```

## 不在本条出口

浏览器 E2E、移动窄屏、Docker 重建、客户环境、存量角色回填、git commit（未授权）。
