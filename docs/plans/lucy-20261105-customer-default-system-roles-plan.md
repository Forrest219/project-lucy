# 客户默认系统正式 Role Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.4** / 2026-11-05 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P0**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261105-customer-default-system-roles-spec.md`](../specs/lucy-20261105-customer-default-system-roles-spec.md) **v0.4** |
| 状态 | **v0.4 功能合同已收口（2026-11-05）**。SC-01–SC-12 通过。证据见 [`docs/reviews/2026-11-05-customer-default-system-roles-closure.md`](../reviews/2026-11-05-customer-default-system-roles-closure.md)。本条收口不表示可上线 |
| 授权边界 | 授权实施本 Plan 与 SC-01–SC-12；可改客户种子、共享 ensure 模块、entrypoint、`ops-evidence` ensure、恢复状态只读探测、相关单测、术语与 149／D22 指针／旧 SC-11 测试。**不含**浏览器 E2E、Docker 重建、镜像、客户现场、git commit／push、运行期热路径写 ACL |
| 验收 | 主 Spec §6 SC-01–SC-12 |
| 实施主体 | `customer-config.example`、`scripts/runtime/**`、`webui/server/ops-evidence/**`、`webui/server/admin/ensure-system-formal-roles.ts`（名可微调）、`webui/server/access-recovery.ts`（只读复用）、相关 Vitest／node:test、术语与文档指针 |
| 审阅 | [`docs/reviews/2026-11-05-codex-review-customer-default-system-roles.md`](../reviews/2026-11-05-codex-review-customer-default-system-roles.md) |
| 修订记录 | v0.1–v0.3 审阅迭代；v0.4 定稿可交付开发（展开落点、恢复 API 准确写法） |

## 1. 目标

客户新装与平滑升级后正式 `lucy_admin` 可绑定；ops-evidence 在 Spec §3.2.1 状态表允许且恢复闸放行时缺则写入 `lucy_ops_reader`；已存在不覆盖；ensure 不碰 Agent／Token（保留既有绑定语义）。

**Architecture:** 共享 TS 模块从 `ROLE_TEMPLATES`／冻结 sourceName 生成规范块；写前 `readAccessRecoveryState(projectRoot)` + `assertAccessWritesAllowed(state)`（**禁止**仅调无参内存闸）；原子 `tmp + rename`；按 §3.3.1 四分支断言。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec／Plan 可交付开发 | **满足（v0.4）** |
| P2 | 不改 ACL 编译代数 | 满足 |
| P3 | `readAccessRecoveryState`／`assertAccessWritesAllowed` 可从 ensure 模块导入 | 实施时核对导出 |

## 3. Global Constraints

- 写前完整恢复准入（marker + 未终结 intent + 内存闸）。
- §3.3.1 允许变更集合；分支 D 字节相等。
- 仅启动／entrypoint 路径；客户种子禁静态 `lucy_ops_reader`。
- SC-06：users 全字段前后语义相等。

## 4. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/server/admin/ensure-system-formal-roles.ts`（新建） | `accessWritesAllowed(projectRoot)`＝`readAccessRecoveryState`→`assertAccessWritesAllowed`；`ensureLucyAdminFormalRole`／`ensureLucyOpsReaderFormalRole`；原子写；四分支纯函数 |
| `customer-config.example/webui/config/access.yaml` | 规范正式 `lucy_admin`；禁止 `lucy_ops_reader`；示例 agent 不绑系统 Role |
| `scripts/runtime/docker-entrypoint.sh` | 启动调用 admin ensure（全模板路径）；去掉仅 demo 限制 |
| `scripts/runtime/docker-entrypoint.test.mjs` | SC-01／02／06／09／11／12（启动侧） |
| `webui/server/ops-evidence/ensure.ts` | 成功路径末按状态表 + 闸调用 reader ensure |
| `webui/server/ops-evidence/connection-block.ts` 等头注释 | 例外指针 |
| `webui/server/__tests__/ops-evidence-*.test.ts` | SC-03／04／05／06／11；改写旧「整文件不变」SC-11 |
| 文档／种子契约测试 | SC-07／08／10 |
| `webui/docs/00-product-terminology-standard.md` | 确认 Lucy Admin／Ops Evidence 备注 |
| Spec 149／可问治理面／自愈 | 指针已改；SC-07 回归 |

## 5. 分阶段实施

### S1 — 共享模块 + `lucy_admin`（SC-01／02／06／08／09／10／11／12）

1. 实现恢复准入包装与规范块生成（对照 `role-templates.ts`）。
2. 种子写入；entrypoint 调用。
3. 单测：分支 A／B、二次幂等、非目标 keys、写失败保留后重试、闸拒绝保留 marker。

### S2 — `lucy_ops_reader`（SC-03／04／05／06／11）

1. `ensureOpsEvidence` 成功返回前按状态表调用。
2. 覆盖 inserted→reload_required、expanded、current、conflict、mirror not_ready、throw、闸拒绝。
3. 改写旧 SC-11 绝对值测试。

### S3 — 文档门禁（SC-07）与收口准备

实施完成后写收口记录；本定稿轮次不改「已收口」。

## 6. 验收命令

| SC | 命令（示意） |
|---|---|
| SC-01／02／06／09／11／12 | `node --test scripts/runtime/docker-entrypoint.test.mjs`（及 ensure 模块单测） |
| SC-03／04／05／06／11 | `cd webui && npx vitest run server/__tests__/ops-evidence-*.test.ts` |
| SC-07／08／10 | 文档／种子／模板漂移契约测试 |
| 形态 | `npm run lint:spec-docs` |

## 7. 完成定义

- SC-01–SC-12 关闭
- Spec／Plan／`docs/README.md`／`docs/plans/README.md` 同一句现值
- 本条收口不表示可上线

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 误用无参 `assertAccessWritesAllowed()` | Plan／代码注释强制 `readAccessRecoveryState` 先行 |
| 启动无 marker 目录 | 不可判定 → 跳过写入 |
| 双源漂移 | SC-10 |
| 旧 SC-11 假绿 | S2 强制改测试 |
