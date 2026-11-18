# `lucy_ops_reader` 无头可问治理面 ACL Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.1-draft / 2026-11-18 |
| 状态 | **v0.1-draft。与 Spec 同句：仅登记与起草，不开发；终稿未确权；未获开发授权；未授权不改运行代码；测试台 not_registered；不入核心分母；≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md`](../specs/lucy-20261118-lucy-ops-reader-headless-governance-acl-spec.md) |
| 总账 | **P1-49**／REQ-030-070；**不入核心分母** |
| 授权边界 | **当前不得改运行代码。** 获终稿确权＋开发授权后，仅允许下方「文件白名单」。不授权改 ACL 编译内核、治理投影 builder、概念控制面、KTX |
| 验收 | Spec SC-01–SC-14；不以浏览器 UAT PASS 关单；不以客户现场为功能合同出口 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「强制流程：Plan Mode」「新增 Spec／Plan 的落盘清单」 |

## 目标

按 Spec v0.1 草案（定稿后以定稿为准）：对「规范 W0 指纹」的正式 `lucy_ops_reader` 在 ensure 成功路径上幂等扩 `names` 至冻结全集；更新 demo 种子；修订 D22／§3.2／手册绝对值句；保证 W0 主路径与定制 Role 不被误伤。从而提升无头 MCP 运维问数对可问治理面的可达性。

## 开工前置

1. 已入总账 P1-49／REQ-030-070；Spec／本 Plan 已落盘。
2. **终稿确权**与 **开发授权**均未取得；取得前步骤 1 起不得执行。
3. OQ-1…OQ-5 已由委托人闭合，或明示沿用 Spec 倾向值并写入 Spec 定稿版（尤其 **D0＝B**）。
4. 对照既有 ensure 挂点：[`webui/server/admin/ensure-system-formal-roles.ts`](../../webui/server/admin/ensure-system-formal-roles.ts)、[`webui/server/ops-evidence/ensure.ts`](../../webui/server/ops-evidence/ensure.ts)、客户默认系统 Role Spec §3.2 状态表。

## 文件白名单（获开发授权后）

| 路径 | 职责 |
|---|---|
| `webui/server/admin/ensure-system-formal-roles.ts`（及抽出的指纹／heal 纯函数模块，若拆分） | 指纹谓词、heal 写盘、日志 branch |
| `webui/server/ops-evidence/ensure.ts` | 成功返回前门闸调用 heal |
| `webui/server/admin/role-templates.ts` | 注释修订（模板已是全集；不改语义） |
| `webui/server/__tests__/ensure-system-formal-roles.test.ts` 等既有／新增 vitest | SC-01–SC-14 |
| `examples/docker-demo/project-template/webui/config/access.yaml` | 静态 Role 升全集 |
| `config/skills/lucy-ops/ops-questioning.md`、`wiki/lucy-ops/ops-questioning.md`、镜像副本（若仓库双份） | 扩权路径文案 |
| `docs/SYSTEM_HANDBOOK.md`（运维问数授权段） | 与 Spec §4.3 同句 |
| 指针修订：可问治理面 Spec D22、客户默认系统 Role §3.2、Spec 149 相关句、术语标准 Ops Evidence Role 备注 | 去掉绝对值「永不扩表」 |
| 本 Spec／Plan、总账、需求池、`docs/README.md`、`docs/plans/README.md` | 状态同句 |

**禁止**：`webui/server/proxy` ACL 编译代数无必要改动；`ops-evidence` 物化／builder；概念 registry 写工具；客户 `customer-config.example` 偷加静态 `lucy_ops_reader`。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 文档定稿：闭合 OQ；Spec／Plan 升正式版号；状态句同句；**仍不改代码** | 人工；`lint:spec-docs` |
| 1 | （须开发授权）TDD：先写指纹真／假表与 heal noop／write 失败注入（SC-01–SC-09） | 红→绿 |
| 2 | 实现 `matchesNormativeW0Fingerprint`＋`maybeHealLucyOpsReader`；挂 ops-evidence ensure 与 CLI ensure（OQ-3） | SC-05–SC-08 |
| 3 | 更新 demo `access.yaml` 全集；断言客户 example 仍无该 Role（SC-10／11） | 文件测 |
| 4 | 代理／ACL 夹具：heal 后 W1＋`gov.*` 非表 deny；W0＋`gov.*` 仍拒；概念写仍拒（SC-12–14） | vitest |
| 5 | 修订 D22／§3.2／handbook／Skill／Wiki／术语备注绝对值句 | `rg` 抽检「永不」「故意只列 W0」 |
| 6 | （可选，非收口必要）Docker `demo:upgrade` 后用 `demo_ops`／等价 Token 冒烟一条 W1 查询 | 记录于 inbox／跑次；不冒充 UAT PASS |
| 7 | 若 OQ-4＝建测试台：另开 `UAT-SUITE-OPS-READER-HEADLESS` 并挂 INDEX／e2e-ledger；本 Plan 不假装已 PASS | INDEX |

## 浏览器验证

默认不适用（委托人未要求浏览器测试）。Role 详情页表勾选变化若需肉眼确认，属可选，不进功能合同出口。

## 验收

与 Spec SC-01–SC-14 同一标准。不以「连接启用表已很多」代替 Role ACL 断言。不以 Skill 正文已列 12 源代替 ensure heal。

## 完成定义

- SC 证据可指回 vitest／夹具。
- Spec、Plan、总账、需求池、索引状态句同句收口，并写明本条收口不表示可上线。
- D22／§3.2 等指针文已去掉与本条冲突的绝对值。
- **≠ 客户现场已升；≠ 可上线；≠ 核心分母完成。**

## 风险

| 风险 | 处理 |
|---|---|
| 指纹过宽误扩定制 Role | 集合恰好两表＋单连接＋无 source_scope；SC-02–04 |
| 指纹过窄导致 demo／存量永不 heal | 以当前 demo 字节与 SC-17c 夹具为金样本锁定谓词 |
| 文档绝对值句残留导致评审以为未授权 heal | 步骤 5 `rg` 清单 |
| 把本条当成改 builder／图页 | 白名单写死；越权即未完成 |
| 无投影时 SC-12 误判 | 只断言非表 ACL deny；投影码单列 |
