# 客户默认系统正式 Role — 功能合同收口

| 项 | 内容 |
|---|---|
| Spec | [`docs/specs/lucy-20261105-customer-default-system-roles-spec.md`](../specs/lucy-20261105-customer-default-system-roles-spec.md) **v0.4 → 收口** |
| Plan | [`docs/plans/lucy-20261105-customer-default-system-roles-plan.md`](../plans/lucy-20261105-customer-default-system-roles-plan.md) |
| 审阅 | [`2026-11-05-codex-review-customer-default-system-roles.md`](2026-11-05-codex-review-customer-default-system-roles.md) |
| 日期 | 2026-11-05 |
| 结论 | **功能合同已收口**。SC-01–SC-12 本机自动化通过。本条收口不表示可上线 |

## 证据

| 命令 | 结果 |
|---|---|
| `cd webui && npx vitest run server/__tests__/ensure-system-formal-roles.test.ts server/__tests__/customer-default-system-roles-contract.test.ts server/__tests__/ops-evidence-connection.test.ts --maxWorkers=1` | 3 files / 26 tests passed |
| `node --test scripts/runtime/docker-entrypoint.test.mjs` | 21 passed |

## SC 落点

| SC | 落点 |
|---|---|
| SC-01／02／06／09／10／11／12 | `ensure-system-formal-roles.test.ts`；entrypoint 相关见 `docker-entrypoint.test.mjs` |
| SC-03／04／05／06 | `ops-evidence-connection.test.ts` + ensure 模块测 |
| SC-07／08／10 | `customer-default-system-roles-contract.test.ts` |

## 不在本条出口（未做）

浏览器 E2E、Docker 重建／`demo:upgrade`、镜像、客户现场、git commit。

## 残留说明

- 成功分支 YAML 整文件重写：非目标内容保证解析后语义相等，不保证空白／键序字节。
- `ensureOpsEvidence` 中途抛错路径无单独故障注入用例（合同上不写 Role）。
- 启动 ensure 不写 `config_change_log`（Spec 允许可选）。
