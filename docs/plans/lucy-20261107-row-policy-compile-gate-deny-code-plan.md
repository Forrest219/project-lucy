# Lucy 行权限编译门禁与各面拒绝码统一 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.2-draft** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 台账号 | 无。`0.30` 台账尚未建立；待 PM 指派后再登记 |
| 状态 | **v0.2-draft，待严格评审／验收；冻结落地；未授权实现**（2026-11-07）。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。S0–S5 全部未开工 |
| 授权边界 | **不授权改代码。** 本 Plan 只定义步骤、验收与完成定义；开工须先取得本条的开工授权（PM 评审 Spec 与本 Plan 后明示） |
| 验收 | S0–S5 各自出口见 §4；本条总出口＝Spec 的 SC-01–SC-11 全部关闭 |
| 对应 Spec | [lucy-20261107-row-policy-compile-gate-deny-code-spec.md](../specs/lucy-20261107-row-policy-compile-gate-deny-code-spec.md) |
| 需求池条目 | REQ-030-013、REQ-030-016 |

---

## 目标

把 2026-11-05 实跑实锤的两条缺口补上，并让两处的判定口径可被自动化打假：

1. **编译门禁（REQ-030-013）**：受行权限保护的 source 上，度量名／派生列作谓词字段的请求在本机被拒绝，且**不产生任何上游执行**。当前缺口是「只有形状门禁、没有字段级门禁」，请求会走到上游。
2. **拒绝码统一（REQ-030-016）**：同一拒绝语义「受保护 source 上调用 unwrapped 工具」在 MCP 工具面与浏览器面返回同一个 reason code。当前缺口是工具级判定先于行策略判定，同一语义落到两个码。

不做：不改 KTX 上游、不改 catalog 可绑定字段集合口径、不改既有专门拒绝码、不新增产品能力。

## 开工前置

开工前必须全部满足，缺一项即停：

1. **开工授权**：PM 评审通过本 Spec 与本 Plan，并明示授权实现。未授权前 S0 之后的任何步骤都不得开始。
2. **术语登记**：`row_policy_predicate_field_not_allowed` 先登记进 `webui/docs/00-product-terminology-standard.md` 的 reason code 表（新增机器码不先登记就实现，属术语违规）。
3. **基线取证**：在本机复跑并保存改动前的 BY-19 证据，作为红基线（现状即红：`deny` 失败、`upstream_exec_zero` 失败）。
4. **目录口径确认**：确认 `row-policy-catalog.ts` 的 `addProvenOverlayFields` 写入 `columns` 的派生列集合与「物理列」可被稳定拆出；拆不出则回到 Spec 评审，不得在实现里猜。
5. **冻结边界确认**：确认本条不改 `docs/access-control/adr-upstream-forced-predicate.md` 与 `webui/docs/99-access-control-p1-row-policy-spec.md` 的合同字面量；如需改动，另行走 ADR 变更流程。

## 实施步骤

| 步骤 | 内容 | 产出 | 关联验收 |
|---|---|---|---|
| S0 | 取红基线：复跑 BY-19，记录现状（拒绝信封不可识别、上游执行 1 次）。同步登记术语新码 | 红基线证据 ＋ 术语标准更新 | 前置项 |
| S1 | 目录可读拆分：`SourceFieldCatalog` 增加 `physicalColumns`／`derivedColumns` 两个只读集合；**既有 `columns`／`measures` 的内容与语义不动** | 目录接口扩展 ＋ 单元 | SC-02、SC-05 |
| S2 | 字段级门禁：在受保护 source 的 `lucy_query` 分支加 `validatePredicateFieldsAgainstCatalog`；对外单一码，内部归因进审计回执 | Proxy 字段级门禁 ＋ 单元 | SC-01、SC-02、SC-03、SC-04、SC-06 |
| S3 | 拒绝码归一：把「受保护 source + unwrapped 工具」判定前移到工具级判定之前，返回 `row_policy_requires_wrapped_tool`；其余分支顺序与码不变 | 授权主流程改序 ＋ 单元 | SC-07、SC-08、SC-09 |
| S4 | harness 与既有测试对齐：**只收紧 BY-19**（现行 `row-policy-cases.mjs:918-925` 接受任意可识别 reason → 改为断言具体新码）；**BY-06／BY-17 的 harness 断言不改**（现行 :627／:629／:839 已断言归一后的码），作为回归锁；实跑分叉的根因在服务端返回 `tool_forbidden`，不在 harness | e2e harness 改写（仅 BY-19）＋ 既有测试回归 | SC-01、SC-07、SC-10 |
| S5 | 复跑取证：BY-19 转为绿（拒绝码正确且上游执行 = 0），BY-18 既有断言不回归；跑 `lint:spec-docs`／`lint:spec`／`lint:terminology`／`lint:ia-boundary`；写收口记录 | 绿证据 ＋ 收口记录 | SC-01–SC-11 |

**步骤依赖**：S1 → S2；S3 独立于 S1／S2；S4 依赖 S3（码定了才能改断言）；S5 依赖 S2＋S3＋S4。S3 与 S1／S2 可并行，但**同一工作区不并行写同一文件**。

## 验收

### 1. 步骤出口

| 步骤 | 出口判定 |
|---|---|
| S0 | 红基线可复现（`deny` 失败、`upstream_exec_zero` 失败），术语新码已登记 |
| S1 | 目录单元通过；既有 `columns`／`measures` 相关测试全绿（无行为变化） |
| S2 | SC-01、SC-02、SC-03、SC-04、SC-06 通过 |
| S3 | SC-07、SC-08、SC-09 通过 |
| S4 | SC-10 通过；harness 与单元对同一场景断言同一码 |
| S5 | SC-01–SC-11 全部通过；BY-19 绿且上游执行 = 0；**四个** lint 门禁（`lint:spec-docs`／`lint:spec`／`lint:terminology`／`lint:ia-boundary`）exit 0 |

### 2. 证据等级

- 本条收口证据以**本机自动化**（单元／组件／真实进程内 Proxy 自动化）＋**CI job** 两级为准。
- 真实客户环境、真实 Agent 客户端、镜像构建与客户交付**不在本条出口**；需要时按 `docs/governance/DEVELOPMENT.md` 归发布取证层处理。
- 不得用 mock 冒充「零上游执行」：该断言必须由 loopback observer 的执行计数给出。

### 3. 门禁

| 命令 | 期望 |
|---|---|
| `npm run lint:spec-docs` | exit 0（本 Spec 与本 Plan 已在 `docs/README.md`／`docs/plans/README.md` 登记） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:terminology` | exit 0（新 reason code 已登记） |
| `npm run lint:ia-boundary` | exit 0 |
| 受影响测试文件 | 全绿 |

## 完成定义

- [ ] Spec 的 SC-01–SC-11 全部关闭，逐条落点写进 Spec §4 与收口记录。
- [ ] BY-19 实跑复跑为绿：拒绝码 = `row_policy_predicate_field_not_allowed`，上游执行 = 0。
- [ ] 合法对照不回归：同角色同 source 的正常查询仍返回正确 Region 集合。
- [ ] 浏览器面与 MCP 工具面在同一场景返回同一 reason code（同一处服务端判定产生）。
- [ ] 新 reason code 已登记进术语标准；无新增用户可见译名。
- [ ] 未改动 KTX 上游、未改动 catalog 可绑定字段集合口径、未改动既有专门拒绝码。
- [ ] 状态镜像改齐：Spec 头部「状态」行（本条事实源）、本 Plan 头部、`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9；需求池条目状态同步为「已开 Spec/Plan，待评审」。
- [ ] 收口记录写入 `docs/reviews/`，并注明「本条收口不表示可上线」。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 字段级门禁误杀合法查询 | 物理列判定口径与目录装载不一致会把合法过滤拦掉 | S1 与 S2 同源实现；SC-03 合法对照为必过项 |
| 判定顺序前移波及其他拒绝码 | 工具级判定前移影响未授予工具的既有码 | 仅「受保护 source + unwrapped 工具」生效；SC-08 锁住其余路径 |
| 目录不可用导致批量拒绝 | 目录装载失败即 fail-closed，可能拦住本来合法的查询 | 属配置故障面，本就该拒绝；SC-04 锁住 fail-closed 方向 |
| 对外码统一削弱可诊断性 | 合并为单一码后看不出具体字段问题 | 内部归因进审计回执（SC-06）；运维读审计而非拒绝信封 |
| harness 改动影响其他 case | BY-06／BY-17／BY-18 共用断言工具 | 改动只在 E 断言段，逐 case 复跑比对；不得顺手改其他 case 的判定 |
| 与 `0.30` 其他批次争同一文件 | 本条改 `acl.ts`／`row-policy.ts`／`row-policy-catalog.ts`，可能与后续批次重叠 | 开工前对照批次地图确认归属；同一文件同一时刻只允许一个写入方 |

## 回滚

- S1／S2／S3 均为服务端判定改动，回滚＝还原对应提交，无数据迁移、无配置写入。
- 术语标准登记项在回滚时同步撤回。
- 本条不产生任何持久化状态，故无数据回滚步骤。
